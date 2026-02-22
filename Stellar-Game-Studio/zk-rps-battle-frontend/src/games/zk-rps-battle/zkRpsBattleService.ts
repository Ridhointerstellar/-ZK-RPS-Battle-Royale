import {
  Keypair,
  TransactionBuilder,
  Contract,
  Address,
  nativeToScVal,
  scValToNative,
  xdr,
  Operation,
  hash,
} from "@stellar/stellar-sdk";
import { Server, Api, assembleTransaction } from "@stellar/stellar-sdk/rpc";
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

function signSorobanAuthEntry(
  entry: xdr.SorobanAuthorizationEntry,
  keypair: Keypair,
  validUntilLedgerSeq: number,
  networkPassphrase: string,
): xdr.SorobanAuthorizationEntry {
  const addrCreds = entry.credentials().address();
  addrCreds.signatureExpirationLedger(validUntilLedgerSeq);

  const networkId = hash(Buffer.from(networkPassphrase));

  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: networkId,
      nonce: addrCreds.nonce(),
      signatureExpirationLedger: validUntilLedgerSeq,
      invocation: entry.rootInvocation(),
    }),
  );

  const preimageHash = hash(preimage.toXDR());
  const signature = keypair.sign(preimageHash);

  addrCreds.signature(
    xdr.ScVal.scvVec([
      xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol("public_key"),
          val: xdr.ScVal.scvBytes(keypair.rawPublicKey()),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol("signature"),
          val: xdr.ScVal.scvBytes(signature),
        }),
      ]),
    ]),
  );

  return entry;
}

async function pollTransaction(
  server: Server,
  txHash: string,
): Promise<Api.GetSuccessfulTransactionResponse> {
  for (let i = 0; i < 30; i++) {
    const resp = await server.getTransaction(txHash);
    if (resp.status === Api.GetTransactionStatus.SUCCESS) {
      return resp as Api.GetSuccessfulTransactionResponse;
    }
    if (resp.status === Api.GetTransactionStatus.FAILED) {
      throw new Error("Transaction failed on-chain");
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Transaction polling timed out");
}

export class OnChainRpsService {
  private server: Server;
  private contract: Contract;

  constructor() {
    this.server = new Server(RPC_URL);
    this.contract = new Contract(CONTRACT_ID);
  }

  async fundFromFriendbot(address: string): Promise<void> {
    const res = await fetch(
      `${FRIENDBOT_URL}?addr=${encodeURIComponent(address)}`,
    );
    if (!res.ok) {
      const text = await res.text();
      if (!text.includes("createAccountAlreadyExist")) {
        throw new Error(`Friendbot failed: ${text}`);
      }
    }
  }

  async getGame(
    sessionId: number,
    sourceAddress: string,
  ): Promise<Game | null> {
    try {
      const account = await this.server.getAccount(sourceAddress);
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

    const aiAccount = await this.server.getAccount(aiKeypair.publicKey());
    const tx = new TransactionBuilder(aiAccount, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(this.contract.call("start_ai_game", ...args))
      .setTimeout(300)
      .build();

    onStatus?.("Simulating transaction...");
    const sim = await this.server.simulateTransaction(tx);
    if (Api.isSimulationError(sim)) {
      throw new Error(`Simulation error: ${(sim as any).error}`);
    }
    const simSuccess = sim as Api.SimulateTransactionSuccessResponse;

    const authEntries = simSuccess.result?.auth || [];
    const sorobanData = simSuccess.transactionData;
    const minFee = simSuccess.minResourceFee;

    const { sequence } = await this.server.getLatestLedger();
    const validUntil = sequence + 1000;

    onStatus?.("Signing authorization entries...");
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
          signedAuth.push(
            signSorobanAuthEntry(
              entry,
              aiKeypair,
              validUntil,
              NETWORK_PASSPHRASE,
            ),
          );
        } else if (entryAddr === userAddress) {
          onStatus?.("Please approve in your wallet...");
          creds.address().signatureExpirationLedger(validUntil);
          const entryXdr = entry.toXDR("base64");
          const result = await walletSigner.signAuthEntry(entryXdr, {
            networkPassphrase: NETWORK_PASSPHRASE,
            address: userAddress,
          });
          if (result.error) throw new Error(result.error.message);
          signedAuth.push(
            xdr.SorobanAuthorizationEntry.fromXDR(
              result.signedAuthEntry,
              "base64",
            ),
          );
        } else {
          signedAuth.push(entry);
        }
      } else {
        signedAuth.push(entry);
      }
    }

    onStatus?.("Building final transaction...");
    const hostFn = tx
      .toEnvelope()
      .v1()
      .tx()
      .operations()[0]
      .body()
      .invokeHostFunctionOp()
      .hostFunction();

    const aiAccount2 = await this.server.getAccount(aiKeypair.publicKey());
    const finalTx = new TransactionBuilder(aiAccount2, {
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
      .setTimeout(300)
      .build();

    finalTx.sign(aiKeypair);

    onStatus?.("Submitting to Stellar Testnet...");
    const sendRes = await this.server.sendTransaction(finalTx);
    if (sendRes.status === "ERROR") {
      throw new Error(
        `Send failed: ${JSON.stringify(sendRes.errorResult)}`,
      );
    }

    onStatus?.("Waiting for confirmation...");
    await pollTransaction(this.server, sendRes.hash);

    return sessionId;
  }

  async commitChoiceUser(
    sessionId: number,
    userAddress: string,
    commitment: Uint8Array,
    walletSigner: ContractSigner,
    onStatus?: (msg: string) => void,
  ): Promise<void> {
    onStatus?.("Building commit transaction...");

    const args = [
      nativeToScVal(sessionId, { type: "u32" }),
      new Address(userAddress).toScVal(),
      xdr.ScVal.scvBytes(Buffer.from(commitment)),
    ];

    const account = await this.server.getAccount(userAddress);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(this.contract.call("commit_choice", ...args))
      .setTimeout(300)
      .build();

    onStatus?.("Simulating...");
    const sim = await this.server.simulateTransaction(tx);
    if (Api.isSimulationError(sim)) {
      throw new Error(`Simulation error: ${(sim as any).error}`);
    }

    const assembled = assembleTransaction(tx, sim).build();

    onStatus?.("Please approve in your wallet...");
    const txXdr = assembled.toXDR();
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
    await pollTransaction(this.server, sendRes.hash);
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
    onStatus?.("Building reveal transaction...");

    const args = [
      nativeToScVal(sessionId, { type: "u32" }),
      new Address(userAddress).toScVal(),
      nativeToScVal(choice, { type: "u32" }),
      xdr.ScVal.scvBytes(Buffer.from(nonce)),
    ];

    const account = await this.server.getAccount(userAddress);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(this.contract.call("reveal_choice", ...args))
      .setTimeout(300)
      .build();

    onStatus?.("Simulating...");
    const sim = await this.server.simulateTransaction(tx);
    if (Api.isSimulationError(sim)) {
      throw new Error(`Simulation error: ${(sim as any).error}`);
    }

    const assembled = assembleTransaction(tx, sim).build();

    onStatus?.("Please approve in your wallet...");
    const txXdr = assembled.toXDR();
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
    await pollTransaction(this.server, sendRes.hash);
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

  private async _submitWithKeypair(
    keypair: Keypair,
    method: string,
    args: xdr.ScVal[],
    onStatus?: (msg: string) => void,
  ): Promise<void> {
    const account = await this.server.getAccount(keypair.publicKey());
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(300)
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
    const validUntil = sequence + 1000;

    const signedAuth = authEntries.map(
      (entry: xdr.SorobanAuthorizationEntry) =>
        signSorobanAuthEntry(entry, keypair, validUntil, NETWORK_PASSPHRASE),
    );

    const hostFn = tx
      .toEnvelope()
      .v1()
      .tx()
      .operations()[0]
      .body()
      .invokeHostFunctionOp()
      .hostFunction();

    const account2 = await this.server.getAccount(keypair.publicKey());
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
      .setTimeout(300)
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
    await pollTransaction(this.server, sendRes.hash);
  }

  getChoiceEmoji(choice: Choice): string {
    return getChoiceEmoji(choice);
  }

  getChoiceName(choice: Choice): string {
    return choiceToString(choice);
  }
}

export { Choice, GamePhase, choiceToString, getChoiceEmoji };
