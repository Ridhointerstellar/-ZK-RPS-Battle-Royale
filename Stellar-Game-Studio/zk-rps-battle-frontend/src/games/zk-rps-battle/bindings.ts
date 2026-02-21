import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}

export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CDEHY5HFXD5L776YOVKKX6KG5IGKNE7ZMR46E4KGM2CBPGO6D27BXEJL",
  },
} as const;

export enum Choice {
  None = 0,
  Rock = 1,
  Paper = 2,
  Scissors = 3,
}

export enum GamePhase {
  Commit = 0,
  Reveal = 1,
  RoundEnd = 2,
  GameEnd = 3,
}

export interface Game {
  player1: string;
  player2: string;
  player1_points: i128;
  player2_points: i128;
  current_round: u32;
  max_rounds: u32;
  player1_wins: u32;
  player2_wins: u32;
  phase: GamePhase;
  player1_commitment: Buffer;
  player2_commitment: Buffer;
  player1_choice: Choice;
  player2_choice: Choice;
  player1_committed: boolean;
  player2_committed: boolean;
  player1_revealed: boolean;
  player2_revealed: boolean;
  round_winner: Choice;
  winner: Option<string>;
  is_vs_ai: boolean;
}

export const Errors = {
  1: { message: "GameNotFound" },
  2: { message: "NotPlayer" },
  3: { message: "AlreadyCommitted" },
  4: { message: "NotAllCommitted" },
  5: { message: "GameAlreadyEnded" },
  6: { message: "InvalidChoice" },
  7: { message: "CommitmentMismatch" },
  8: { message: "AlreadyRevealed" },
  9: { message: "NotAllRevealed" },
  10: { message: "RoundNotActive" },
};

export type DataKey =
  | { tag: "Game"; values: readonly [u32] }
  | { tag: "GameHubAddress"; values: void }
  | { tag: "Admin"; values: void }
  | { tag: "Leaderboard"; values: readonly [string] }
  | { tag: "TotalGames"; values: void };

export interface Client {
  get_hub: (options?: MethodOptions) => Promise<AssembledTransaction<string>>;
  set_hub: (
    { new_hub }: { new_hub: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<null>>;
  upgrade: (
    { new_wasm_hash }: { new_wasm_hash: Buffer },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<null>>;
  get_game: (
    { session_id }: { session_id: u32 },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<Game>>>;
  get_admin: (
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<string>>;
  set_admin: (
    { new_admin }: { new_admin: string },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<null>>;
  get_total_games: (
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<u32>>;
  start_game: (
    {
      session_id,
      player1,
      player2,
      player1_points,
      player2_points,
    }: {
      session_id: u32;
      player1: string;
      player2: string;
      player1_points: i128;
      player2_points: i128;
    },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;
  start_ai_game: (
    {
      session_id,
      player1,
      player2,
      player1_points,
      player2_points,
    }: {
      session_id: u32;
      player1: string;
      player2: string;
      player1_points: i128;
      player2_points: i128;
    },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;
  commit_choice: (
    {
      session_id,
      player,
      commitment,
    }: {
      session_id: u32;
      player: string;
      commitment: Buffer;
    },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;
  reveal_choice: (
    {
      session_id,
      player,
      choice,
      nonce,
    }: {
      session_id: u32;
      player: string;
      choice: u32;
      nonce: Buffer;
    },
    options?: MethodOptions,
  ) => Promise<AssembledTransaction<Result<void>>>;
}

export class Client extends ContractClient {
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([]),
      options,
    );
  }
  public readonly fromJSON = {
    get_hub: this.txFromJSON<string>,
    set_hub: this.txFromJSON<null>,
    upgrade: this.txFromJSON<null>,
    get_game: this.txFromJSON<Result<Game>>,
    get_admin: this.txFromJSON<string>,
    set_admin: this.txFromJSON<null>,
    get_total_games: this.txFromJSON<u32>,
    start_game: this.txFromJSON<Result<void>>,
    start_ai_game: this.txFromJSON<Result<void>>,
    commit_choice: this.txFromJSON<Result<void>>,
    reveal_choice: this.txFromJSON<Result<void>>,
  };
}
