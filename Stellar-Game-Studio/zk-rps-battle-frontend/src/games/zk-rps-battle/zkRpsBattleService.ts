import {
  Keypair,
  TransactionBuilder,
  Contract,
  Address,
  nativeToScVal,
  scValToNative,
  xdr,
  Operation,
  authorizeEntry,
} from "@stellar/stellar-sdk";
import { Server, Api } from "@stellar/stellar-sdk/rpc";
import { keccak256 } from "js-sha3";
import { Choice, GamePhase, type Game, networks } from "./bindings";
import type { ContractSigner } from "../../types/signer";

const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = networks.testnet.networkPassphrase;
const CONTRACT_ID = networks.testnet.contractId;
const FRIENDBOT_URL = "https://friendbot.stellar.org";
const BASE_FEE = "10000000";

export interface Commitment {
  hash: Uint8Array;
  choice: Choice;
  nonce: Uint8Array;
}

export interface RoundResult {
  round: number;
  player1Choice: Choice;
  player2Choice: Choice;
  winner: "player1" | "player2" | "draw";
}

function choiceToString(choice: Choice): string {
  switch (choice) {
    case Choice.Rock:
      return "Rock";
    case Choice.Paper:
      return "Paper";
    case Choice.Scissors:
      return "Scissors";
    default:
      return "None";
  }
}

function getChoiceEmoji(choice: Choice): string {
  switch (choice) {
    case Choice.Rock:
      return "\u270A";
    case Choice.Paper:
      return "\u270B";
    case Choice.Scissors:
      return "\u2702\uFE0F";
    default:
      return "\u2753";
  }
}

export function computeCommitment(
  choice: number,
  nonce: Uint8Array,
): Uint8Array {
  const choiceBytes = new Uint8Array(4);
  new DataView(choiceBytes.buffer).setUint32(0, choice, false);
  const input = new Uint8Array(36);
  input.set(choiceBytes, 0);
  input.set(nonce, 4);
  return new Uint8Array(keccak256.arrayBuffer(input));
}

export function generateNonce(): Uint8Array {
  const nonce = new Uint8Array(32);
  crypto.getRandomValues(nonce);
  return nonce;
}

function generateSessionId(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] & 0x7fffffff;
}


async function pollTransaction(
  server: Server,
  txHash: string,
  label = "Transaction",
): Promise<Api.GetSuccessfulTransactionResponse> {
  for (let i = 0; i < 30; i++) {
    const resp = await server.getTransaction(txHash);
    if (resp.status === Api.GetTransactionStatus.SUCCESS) {
      return resp as Api.GetSuccessfulTransactionResponse;
    }
    if (resp.status === Api.GetTransactionStatus.FAILED) {
      const failedResp = resp as Api.GetFailedTransactionResponse;
      let detail = "";
      try {
        if (failedResp.resultXdr) {
          const result = typeof failedResp.resultXdr === "string"
            ? xdr.TransactionResult.fromXDR(failedResp.resultXdr, "base64")
            : failedResp.resultXdr;
          const resultCode = result.result().switch().name;
          const opResults = result.result().results();
          const opCodes = opResults?.map((r: any) => {
            try { return r.tr().switch().name; } catch { return "unknown"; }
          }) || [];
          detail = ` | result=${resultCode}, ops=[${opCodes.join(",")}]`;
        }
      } catch (e: any) {
        detail = ` | (could not parse resultXdr: ${e.message})`;
      }
      throw new Error(`${label} failed on-chain (hash=${txHash})${detail}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`${label} polling timed out (hash=${txHash})`);
}

export class OnChainRpsService {
  private server: Server;
  private contract: Contract;

  constructor() {
    this.server = new Server(RPC_URL);
    this.contract = new Contract(CONTRACT_ID);
  }

  private async getAccountWithRetry(address: string, maxRetries = 5) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await this.server.getAccount(address);
      } catch (e: any) {
        if (i < maxRetries - 1 && (e?.message?.includes("not found") || e?.code === 404)) {
          await new Promise((r) => setTimeout(r, 2000));
        } else {
          throw new Error(`Account not found: ${address}. Make sure your wallet is on Stellar Testnet and your account is funded.`);
        }
      }
    }
    throw new Error(`Account not found: ${address}`);
  }

  async ensureAccountFunded(address: string): Promise<void> {
    try {
      await this.server.getAccount(address);
      return;
    } catch {
      // Account doesn't exist, need to fund it
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(
          `${FRIENDBOT_URL}?addr=${encodeURIComponent(address)}`,
        );
        const text = await res.text();

        if (res.ok || text.includes("already funded") || text.includes("already exists") || text.includes("createAccountAlreadyExist")) {
          for (let i = 0; i < 15; i++) {
            try {
              await this.server.getAccount(address);
              return;
            } catch {
              await new Promise((r) => setTimeout(r, 2000));
            }
          }
        }

        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 3000));
        }
      } catch {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    }

    try {
      await this.server.getAccount(address);
      return;
    } catch {
      throw new Error(
        "Could not fund account. The Stellar Testnet Friendbot may be temporarily unavailable. Please try again in a moment.",
      );
    }
  }

  async getGame(
    sessionId: number,
    sourceAddress: string,
  ): Promise<Game | null> {
    try {
      const account = await this.getAccountWithRetry(sourceAddress);
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          this.contract.call(
            "get_game",
            nativeToScVal(sessionId, { type: "u32" }),
          ),
        )
        .setTimeout(30)
        .build();
      const sim = await this.server.simulateTransaction(tx);
      if (Api.isSimulationError(sim)) return null;
      const success = sim as Api.SimulateTransactionSuccessResponse;
      if (!success.result?.retval) return null;
      const raw = scValToNative(success.result.retval);
      return raw as unknown as Game;
    } catch (e) {
      console.error("getGame error:", e);
      return null;
    }
  }

  async startAiGame(
    userAddress: string,
    aiKeypair: Keypair,
    walletSigner: ContractSigner,
    onStatus?: (msg: string) => void,
  ): Promise<number> {
    const sessionId = generateSessionId();
    onStatus?.("Building start_ai_game transaction...");

    const args = [
      nativeToScVal(sessionId, { type: "u32" }),
      new Address(userAddress).toScVal(),
      new Address(aiKeypair.publicKey()).toScVal(),
      nativeToScVal(1000n, { type: "i128" }),
      nativeToScVal(1000n, { type: "i128" }),
    ];

    const userAccount = await this.getAccountWithRetry(userAddress);
    const simTx = new TransactionBuilder(userAccount, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(this.contract.call("start_ai_game", ...args))
      .setTimeout(30)
      .build();

    onStatus?.("Simulating transaction...");
    const sim = await this.server.simulateTransaction(simTx);
    if (Api.isSimulationError(sim)) {
      throw new Error(`Simulation error: ${(sim as any).error}`);
    }
    const simSuccess = sim as Api.SimulateTransactionSuccessResponse;

    const authEntries = simSuccess.result?.auth || [];
    const sorobanData = simSuccess.transactionData;
    const minFee = simSuccess.minResourceFee;

    const hostFn = simTx
      .toEnvelope()
      .v1()
      .tx()
      .operations()[0]
      .body()
      .invokeHostFunctionOp()
      .hostFunction();

    const ledgerInfo = await this.server.getLatestLedger();
    const validUntil = ledgerInfo.sequence + 10000;

    const signedAuth: xdr.SorobanAuthorizationEntry[] = [];
    for (const entry of authEntries) {
      const creds = entry.credentials();
      if (
        creds.switch().value ===
        xdr.SorobanCredentialsType.sorobanCredentialsAddress().value
      ) {
        const entryAddr = Address.fromScAddress(
          creds.address().address(),
        ).toString();

        if (entryAddr === aiKeypair.publicKey()) {
          const signed = await authorizeEntry(
            entry,
            aiKeypair,
            validUntil,
            NETWORK_PASSPHRASE,
          );
          signedAuth.push(signed);
        } else if (entryAddr === userAddress) {
          const sourceAuth = new xdr.SorobanAuthorizationEntry({
            credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
            rootInvocation: entry.rootInvocation(),
          });
          signedAuth.push(sourceAuth);
        } else {
          signedAuth.push(entry);
        }
      } else {
        signedAuth.push(entry);
      }
    }

    onStatus?.("Please approve in your wallet...");

    const userAccount2 = await this.getAccountWithRetry(userAddress);
    const finalTx = new TransactionBuilder(userAccount2, {
      fee: (parseInt(minFee || BASE_FEE) + 100000).toString(),
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.invokeHostFunction({
          func: hostFn,
          auth: signedAuth,
        }),
      )
      .setSorobanData(sorobanData!.build())
      .setTimeout(1800)
      .build();

    const txXdr = finalTx.toXDR();
    const signResult = await walletSigner.signTransaction(txXdr, {
      networkPassphrase: NETWORK_PASSPHRASE,
      address: userAddress,
    });
    if (signResult.error) throw new Error(signResult.error.message);

    const userSignedTx = TransactionBuilder.fromXDR(
      signResult.signedTxXdr,
      NETWORK_PASSPHRASE,
    );

    onStatus?.("Submitting to Stellar Testnet...");
    const sendRes = await this.server.sendTransaction(userSignedTx);
    if (sendRes.status === "ERROR") {
      throw new Error(
        `Send failed: ${JSON.stringify(sendRes.errorResult)}`,
      );
    }

    onStatus?.("Waiting for confirmation...");
    await pollTransaction(this.server, sendRes.hash, "start_ai_game");

    return sessionId;
  }

  async commitChoiceUser(
    sessionId: number,
    userAddress: string,
    commitment: Uint8Array,
    walletSigner: ContractSigner,
    onStatus?: (msg: string) => void,
  ): Promise<void> {
    await this._submitWithWallet(
      userAddress,
      "commit_choice",
      [
        nativeToScVal(sessionId, { type: "u32" }),
        new Address(userAddress).toScVal(),
        xdr.ScVal.scvBytes(Buffer.from(commitment)),
      ],
      walletSigner,
      "commit_choice_user",
      onStatus,
    );
  }

  async commitChoiceAi(
    sessionId: number,
    aiKeypair: Keypair,
    commitment: Uint8Array,
    onStatus?: (msg: string) => void,
  ): Promise<void> {
    onStatus?.("AI committing on-chain...");
    const args = [
      nativeToScVal(sessionId, { type: "u32" }),
      new Address(aiKeypair.publicKey()).toScVal(),
      xdr.ScVal.scvBytes(Buffer.from(commitment)),
    ];
    await this._submitWithKeypair(aiKeypair, "commit_choice", args, onStatus);
  }

  async revealChoiceUser(
    sessionId: number,
    userAddress: string,
    choice: number,
    nonce: Uint8Array,
    walletSigner: ContractSigner,
    onStatus?: (msg: string) => void,
  ): Promise<void> {
    await this._submitWithWallet(
      userAddress,
      "reveal_choice",
      [
        nativeToScVal(sessionId, { type: "u32" }),
        new Address(userAddress).toScVal(),
        nativeToScVal(choice, { type: "u32" }),
        xdr.ScVal.scvBytes(Buffer.from(nonce)),
      ],
      walletSigner,
      "reveal_choice_user",
      onStatus,
    );
  }

  async revealChoiceAi(
    sessionId: number,
    aiKeypair: Keypair,
    choice: number,
    nonce: Uint8Array,
    onStatus?: (msg: string) => void,
  ): Promise<void> {
    onStatus?.("AI revealing on-chain...");
    const args = [
      nativeToScVal(sessionId, { type: "u32" }),
      new Address(aiKeypair.publicKey()).toScVal(),
      nativeToScVal(choice, { type: "u32" }),
      xdr.ScVal.scvBytes(Buffer.from(nonce)),
    ];
    await this._submitWithKeypair(aiKeypair, "reveal_choice", args, onStatus);
  }

  private async _submitWithWallet(
    userAddress: string,
    method: string,
    args: xdr.ScVal[],
    walletSigner: ContractSigner,
    label: string,
    onStatus?: (msg: string) => void,
  ): Promise<void> {
    onStatus?.("Building transaction...");
    const account = await this.getAccountWithRetry(userAddress);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(30)
      .build();

    onStatus?.("Simulating...");
    const sim = await this.server.simulateTransaction(tx);
    if (Api.isSimulationError(sim)) {
      throw new Error(`Simulation error: ${(sim as any).error}`);
    }
    const simSuccess = sim as Api.SimulateTransactionSuccessResponse;

    const sorobanData = simSuccess.transactionData;
    const minFee = simSuccess.minResourceFee;

    const hostFn = tx
      .toEnvelope()
      .v1()
      .tx()
      .operations()[0]
      .body()
      .invokeHostFunctionOp()
      .hostFunction();

    const authEntries = simSuccess.result?.auth || [];
    const sourceAuth = authEntries.map((entry: xdr.SorobanAuthorizationEntry) =>
      new xdr.SorobanAuthorizationEntry({
        credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
        rootInvocation: entry.rootInvocation(),
      }),
    );

    const account2 = await this.getAccountWithRetry(userAddress);
    const finalTx = new TransactionBuilder(account2, {
      fee: (parseInt(minFee || BASE_FEE) + 100000).toString(),
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.invokeHostFunction({
          func: hostFn,
          auth: sourceAuth,
        }),
      )
      .setSorobanData(sorobanData!.build())
      .setTimeout(1800)
      .build();

    onStatus?.("Please approve in your wallet...");
    const txXdr = finalTx.toXDR();
    const signResult = await walletSigner.signTransaction(txXdr, {
      networkPassphrase: NETWORK_PASSPHRASE,
    });
    if (signResult.error) throw new Error(signResult.error.message);

    onStatus?.("Submitting to Stellar Testnet...");
    const signedTx = TransactionBuilder.fromXDR(
      signResult.signedTxXdr,
      NETWORK_PASSPHRASE,
    );
    const sendRes = await this.server.sendTransaction(signedTx);
    if (sendRes.status === "ERROR") {
      throw new Error(`Send failed: ${JSON.stringify(sendRes.errorResult)}`);
    }

    onStatus?.("Waiting for confirmation...");
    await pollTransaction(this.server, sendRes.hash, label);
  }

  private async _submitWithKeypair(
    keypair: Keypair,
    method: string,
    args: xdr.ScVal[],
    onStatus?: (msg: string) => void,
  ): Promise<void> {
    const account = await this.getAccountWithRetry(keypair.publicKey());
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(600)
      .build();

    const sim = await this.server.simulateTransaction(tx);
    if (Api.isSimulationError(sim)) {
      throw new Error(`Simulation error: ${(sim as any).error}`);
    }
    const simSuccess = sim as Api.SimulateTransactionSuccessResponse;

    const authEntries = simSuccess.result?.auth || [];
    const sorobanData = simSuccess.transactionData;
    const minFee = simSuccess.minResourceFee;

    const { sequence } = await this.server.getLatestLedger();
    const validUntil = sequence + 10000;

    const signedAuth = await Promise.all(
      authEntries.map((entry: xdr.SorobanAuthorizationEntry) =>
        authorizeEntry(entry, keypair, validUntil, NETWORK_PASSPHRASE),
      ),
    );

    const hostFn = tx
      .toEnvelope()
      .v1()
      .tx()
      .operations()[0]
      .body()
      .invokeHostFunctionOp()
      .hostFunction();

    const account2 = await this.getAccountWithRetry(keypair.publicKey());
    const finalTx = new TransactionBuilder(account2, {
      fee: (parseInt(minFee || BASE_FEE) + 100000).toString(),
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.invokeHostFunction({
          func: hostFn,
          auth: signedAuth,
        }),
      )
      .setSorobanData(sorobanData!.build())
      .setTimeout(600)
      .build();

    finalTx.sign(keypair);

    onStatus?.("Submitting to Stellar Testnet...");
    const sendRes = await this.server.sendTransaction(finalTx);
    if (sendRes.status === "ERROR") {
      throw new Error(
        `Send failed: ${JSON.stringify(sendRes.errorResult)}`,
      );
    }

    onStatus?.("Waiting for confirmation...");
    await pollTransaction(this.server, sendRes.hash, `${method}_ai`);
  }

  getChoiceEmoji(choice: Choice): string {
    return getChoiceEmoji(choice);
  }

  getChoiceName(choice: Choice): string {
    return choiceToString(choice);
  }
}

export { Choice, GamePhase, choiceToString, getChoiceEmoji };
