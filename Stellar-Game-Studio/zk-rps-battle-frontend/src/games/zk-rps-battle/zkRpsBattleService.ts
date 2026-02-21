import { Choice, GamePhase, type Game } from "./bindings";

export interface LocalGameState {
  sessionId: number;
  player1: string;
  player2: string;
  currentRound: number;
  maxRounds: number;
  player1Wins: number;
  player2Wins: number;
  phase: GamePhase;
  player1Choice: Choice;
  player2Choice: Choice;
  player1Committed: boolean;
  player2Committed: boolean;
  player1Revealed: boolean;
  player2Revealed: boolean;
  winner: string | null;
  isVsAi: boolean;
  roundHistory: RoundResult[];
}

export interface RoundResult {
  round: number;
  player1Choice: Choice;
  player2Choice: Choice;
  winner: "player1" | "player2" | "draw";
}

export interface Commitment {
  hash: Uint8Array;
  choice: Choice;
  nonce: Uint8Array;
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

function determineRoundWinner(
  p1: Choice,
  p2: Choice,
): "player1" | "player2" | "draw" {
  if (p1 === p2) return "draw";
  if (
    (p1 === Choice.Rock && p2 === Choice.Scissors) ||
    (p1 === Choice.Paper && p2 === Choice.Rock) ||
    (p1 === Choice.Scissors && p2 === Choice.Paper)
  ) {
    return "player1";
  }
  return "player2";
}

async function hashCommitment(data: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", copy);
  return new Uint8Array(hashBuffer);
}

async function generateCommitment(choice: Choice): Promise<Commitment> {
  const nonce = new Uint8Array(32);
  crypto.getRandomValues(nonce);

  const choiceBytes = new Uint8Array(4);
  const view = new DataView(choiceBytes.buffer);
  view.setUint32(0, choice, false);

  const combined = new Uint8Array(4 + 32);
  combined.set(choiceBytes, 0);
  combined.set(nonce, 4);

  const hash = await hashCommitment(combined);

  return { hash, choice, nonce };
}

function createRandomSessionId(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] || 1;
}

export class ZkRpsBattleService {
  private contractId: string;
  private localGames: Map<number, LocalGameState> = new Map();
  private commitments: Map<string, Commitment> = new Map();

  constructor(contractId: string) {
    this.contractId = contractId;
  }

  createLocalGame(
    isVsAi: boolean,
    player1: string,
    player2: string,
  ): LocalGameState {
    const sessionId = createRandomSessionId();
    const game: LocalGameState = {
      sessionId,
      player1,
      player2,
      currentRound: 1,
      maxRounds: 3,
      player1Wins: 0,
      player2Wins: 0,
      phase: GamePhase.Commit,
      player1Choice: Choice.None,
      player2Choice: Choice.None,
      player1Committed: false,
      player2Committed: false,
      player1Revealed: false,
      player2Revealed: false,
      winner: null,
      isVsAi,
      roundHistory: [],
    };
    this.localGames.set(sessionId, game);
    return game;
  }

  getLocalGame(sessionId: number): LocalGameState | null {
    return this.localGames.get(sessionId) || null;
  }

  async commitChoice(
    sessionId: number,
    player: string,
    choice: Choice,
  ): Promise<Commitment> {
    const game = this.localGames.get(sessionId);
    if (!game) throw new Error("Game not found");
    if (game.phase !== GamePhase.Commit) throw new Error("Not in commit phase");

    const commitment = await generateCommitment(choice);
    const commitKey = `${sessionId}-${player}`;
    this.commitments.set(commitKey, commitment);

    if (player === game.player1) {
      game.player1Committed = true;
    } else if (player === game.player2) {
      game.player2Committed = true;
    }

    if (game.player1Committed && game.player2Committed) {
      game.phase = GamePhase.Reveal;
    }

    return commitment;
  }

  async commitAiChoice(sessionId: number): Promise<Commitment> {
    const game = this.localGames.get(sessionId);
    if (!game || !game.isVsAi) throw new Error("Not an AI game");

    const choices = [Choice.Rock, Choice.Paper, Choice.Scissors];
    const aiChoice = choices[Math.floor(Math.random() * 3)];

    return this.commitChoice(sessionId, game.player2, aiChoice);
  }

  revealChoice(sessionId: number, player: string): RoundResult | null {
    const game = this.localGames.get(sessionId);
    if (!game) throw new Error("Game not found");

    const commitKey = `${sessionId}-${player}`;
    const commitment = this.commitments.get(commitKey);
    if (!commitment) throw new Error("No commitment found");

    if (player === game.player1) {
      game.player1Choice = commitment.choice;
      game.player1Revealed = true;
    } else if (player === game.player2) {
      game.player2Choice = commitment.choice;
      game.player2Revealed = true;
    }

    if (game.player1Revealed && game.player2Revealed) {
      const roundWinner = determineRoundWinner(
        game.player1Choice,
        game.player2Choice,
      );

      const roundResult: RoundResult = {
        round: game.currentRound,
        player1Choice: game.player1Choice,
        player2Choice: game.player2Choice,
        winner: roundWinner,
      };

      game.roundHistory.push(roundResult);

      if (roundWinner === "player1") game.player1Wins++;
      else if (roundWinner === "player2") game.player2Wins++;

      const neededWins = Math.floor(game.maxRounds / 2) + 1;

      if (
        game.player1Wins >= neededWins ||
        game.player2Wins >= neededWins ||
        game.currentRound >= game.maxRounds
      ) {
        game.winner =
          game.player1Wins > game.player2Wins ? game.player1 : game.player2;
        game.phase = GamePhase.GameEnd;
      } else {
        game.currentRound++;
        game.phase = GamePhase.Commit;
        game.player1Choice = Choice.None;
        game.player2Choice = Choice.None;
        game.player1Committed = false;
        game.player2Committed = false;
        game.player1Revealed = false;
        game.player2Revealed = false;
      }

      this.commitments.delete(`${sessionId}-${game.player1}`);
      this.commitments.delete(`${sessionId}-${game.player2}`);

      return roundResult;
    }

    return null;
  }

  getChoiceEmoji(choice: Choice): string {
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

  getChoiceName(choice: Choice): string {
    return choiceToString(choice);
  }
}

export { Choice, GamePhase, choiceToString, determineRoundWinner };
