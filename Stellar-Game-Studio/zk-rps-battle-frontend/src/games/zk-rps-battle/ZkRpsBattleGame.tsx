import { useState, useCallback, useEffect } from "react";
import {
  ZkRpsBattleService,
  Choice,
  GamePhase,
  type LocalGameState,
  type RoundResult,
} from "./zkRpsBattleService";
import { ZK_RPS_BATTLE_CONTRACT } from "@/utils/constants";
import { useWallet } from "@/hooks/useWallet";

const service = new ZkRpsBattleService(ZK_RPS_BATTLE_CONTRACT);

type GameMode = "menu" | "vs-ai" | "pvp-bracket";
type BracketStage = "quarterfinal" | "semifinal" | "final" | "champion";

interface BracketMatch {
  id: number;
  player1: string;
  player2: string;
  winner: string | null;
  game: LocalGameState | null;
}

interface ZkRpsBattleGameProps {
  userAddress: string;
  currentEpoch: number;
  availablePoints: bigint;
  initialXDR?: string | null;
  initialSessionId?: number | null;
  onStandingsRefresh: () => void;
  onGameComplete: () => void;
}

const AI_NAMES = [
  "ZK-Bot Alpha",
  "Neural Nexus",
  "Cipher Core",
  "Quantum Node",
  "Sentinel AI",
  "Prism Engine",
  "Vector Mind",
];

const BRACKET_PLAYERS = [
  "You",
  "ZK-Bot \u03B1",
  "ZK-Bot \u03B2",
  "ZK-Bot \u03B3",
  "ZK-Bot \u03B4",
  "ZK-Bot \u03B5",
  "ZK-Bot \u03B6",
  "ZK-Bot \u03B7",
];

export function ZkRpsBattleGame({
  userAddress,
  onStandingsRefresh,
  onGameComplete,
}: ZkRpsBattleGameProps) {
  const { walletType } = useWallet();
  const [mode, setMode] = useState<GameMode>("menu");
  const [game, setGame] = useState<LocalGameState | null>(null);
  const [selectedChoice, setSelectedChoice] = useState<Choice | null>(null);
  const [lastRound, setLastRound] = useState<RoundResult | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [aiName] = useState(
    () => AI_NAMES[Math.floor(Math.random() * AI_NAMES.length)],
  );
  const [bracketMatches, setBracketMatches] = useState<BracketMatch[]>([]);
  const [bracketStage, setBracketStage] = useState<BracketStage>(
    "quarterfinal",
  );
  const [currentBracketMatch, setCurrentBracketMatch] = useState(0);
  const [stats, setStats] = useState({ wins: 0, losses: 0, draws: 0 });
  const [totalGamesPlayed, setTotalGamesPlayed] = useState(0);

  const startVsAi = useCallback(() => {
    const newGame = service.createLocalGame(true, userAddress, "AI_OPPONENT");
    setGame(newGame);
    setMode("vs-ai");
    setSelectedChoice(null);
    setLastRound(null);
    setShowResult(false);
  }, [userAddress]);

  const startBracket = useCallback(() => {
    const matches: BracketMatch[] = [];
    for (let i = 0; i < 4; i++) {
      matches.push({
        id: i,
        player1: BRACKET_PLAYERS[i * 2],
        player2: BRACKET_PLAYERS[i * 2 + 1],
        winner: null,
        game: null,
      });
    }
    setBracketMatches(matches);
    setBracketStage("quarterfinal");
    setCurrentBracketMatch(0);

    const firstMatch = matches[0];
    if (firstMatch.player1 === "You") {
      const newGame = service.createLocalGame(
        true,
        userAddress,
        "BRACKET_AI_0",
      );
      setGame(newGame);
      firstMatch.game = newGame;
    } else {
      firstMatch.winner =
        Math.random() > 0.5 ? firstMatch.player1 : firstMatch.player2;
    }

    setMode("pvp-bracket");
    setSelectedChoice(null);
    setLastRound(null);
    setShowResult(false);
  }, [userAddress]);

  const handleChoice = useCallback(
    async (choice: Choice) => {
      if (!game || animating || game.phase !== GamePhase.Commit) return;

      setSelectedChoice(choice);
      setAnimating(true);

      await service.commitChoice(game.sessionId, game.player1, choice);
      await service.commitAiChoice(game.sessionId);

      service.revealChoice(game.sessionId, game.player1);
      const result = service.revealChoice(game.sessionId, game.player2);

      if (result) {
        setLastRound(result);
        setShowResult(true);

        if (result.winner === "draw") {
          setStats((s) => ({ ...s, draws: s.draws + 1 }));
        }
      }

      const updated = service.getLocalGame(game.sessionId);
      if (updated) {
        setGame({ ...updated });
      }

      setTimeout(() => {
        setAnimating(false);
        if (updated?.phase === GamePhase.GameEnd) {
          setTotalGamesPlayed((t) => t + 1);
          if (updated.winner === userAddress) {
            setStats((s) => ({ ...s, wins: s.wins + 1 }));
          } else {
            setStats((s) => ({ ...s, losses: s.losses + 1 }));
          }
          onStandingsRefresh();
        }
      }, 1500);
    },
    [game, animating, userAddress, onStandingsRefresh],
  );

  const handleNextRound = useCallback(() => {
    setShowResult(false);
    setSelectedChoice(null);
    setLastRound(null);
  }, []);

  const handleBracketAdvance = useCallback(() => {
    if (!game) return;
    const updated = service.getLocalGame(game.sessionId);
    if (!updated || updated.phase !== GamePhase.GameEnd) return;

    const isUserWin = updated.winner === userAddress;
    const newMatches = [...bracketMatches];
    newMatches[currentBracketMatch].winner = isUserWin
      ? newMatches[currentBracketMatch].player1
      : newMatches[currentBracketMatch].player2;

    for (
      let i = currentBracketMatch + 1;
      i < newMatches.length;
      i++
    ) {
      const m = newMatches[i];
      if (!m.winner && m.player1 !== "You") {
        m.winner = Math.random() > 0.5 ? m.player1 : m.player2;
      }
    }

    setBracketMatches(newMatches);

    if (!isUserWin) {
      setMode("menu");
      return;
    }

    const allDecided = newMatches.every((m) => m.winner !== null);
    if (!allDecided) return;

    if (bracketStage === "quarterfinal") {
      const semis: BracketMatch[] = [];
      for (let i = 0; i < 2; i++) {
        const w1 = newMatches[i * 2].winner!;
        const w2 = newMatches[i * 2 + 1].winner!;
        semis.push({
          id: i,
          player1: w1,
          player2: w2,
          winner: null,
          game: null,
        });
      }
      setBracketMatches(semis);
      setBracketStage("semifinal");
      setCurrentBracketMatch(0);

      const userMatch = semis.findIndex(
        (m) => m.player1 === "You" || m.player2 === "You",
      );
      if (userMatch >= 0) {
        const newGame = service.createLocalGame(
          true,
          userAddress,
          `BRACKET_SEMI_${userMatch}`,
        );
        setGame(newGame);
        semis[userMatch].game = newGame;
        setCurrentBracketMatch(userMatch);
      }

      for (let i = 0; i < semis.length; i++) {
        if (
          i !== userMatch &&
          semis[i].player1 !== "You" &&
          semis[i].player2 !== "You"
        ) {
          semis[i].winner =
            Math.random() > 0.5 ? semis[i].player1 : semis[i].player2;
        }
      }

      setSelectedChoice(null);
      setLastRound(null);
      setShowResult(false);
    } else if (bracketStage === "semifinal") {
      const w1 = newMatches[0].winner!;
      const w2 = newMatches[1].winner!;
      const finalMatch: BracketMatch[] = [
        { id: 0, player1: w1, player2: w2, winner: null, game: null },
      ];
      setBracketMatches(finalMatch);
      setBracketStage("final");
      setCurrentBracketMatch(0);

      const newGame = service.createLocalGame(
        true,
        userAddress,
        "BRACKET_FINAL",
      );
      setGame(newGame);
      finalMatch[0].game = newGame;

      setSelectedChoice(null);
      setLastRound(null);
      setShowResult(false);
    } else if (bracketStage === "final") {
      setBracketStage("champion");
    }
  }, [
    game,
    bracketMatches,
    bracketStage,
    currentBracketMatch,
    userAddress,
  ]);

  const renderChoiceButton = (choice: Choice) => {
    const emoji = service.getChoiceEmoji(choice);
    const name = service.getChoiceName(choice);
    const isSelected = selectedChoice === choice;
    const disabled = animating || game?.phase !== GamePhase.Commit;

    return (
      <button
        key={choice}
        onClick={() => handleChoice(choice)}
        disabled={disabled}
        className={`choice-btn ${isSelected ? "selected" : ""} ${disabled ? "disabled" : ""}`}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "0.5rem",
          padding: "1.5rem 2rem",
          borderRadius: "1rem",
          border: isSelected
            ? "2px solid var(--color-accent)"
            : "2px solid rgba(255,255,255,0.1)",
          background: isSelected
            ? "rgba(99, 102, 241, 0.2)"
            : "rgba(255,255,255,0.05)",
          cursor: disabled ? "not-allowed" : "pointer",
          transition: "all 0.3s ease",
          fontSize: "3rem",
          opacity: disabled ? 0.5 : 1,
          minWidth: "120px",
        }}
      >
        <span style={{ fontSize: "3.5rem" }}>{emoji}</span>
        <span
          style={{
            fontSize: "0.85rem",
            fontWeight: 600,
            color: "var(--color-ink-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {name}
        </span>
      </button>
    );
  };

  const renderRoundResult = () => {
    if (!lastRound || !showResult) return null;

    const p1Emoji = service.getChoiceEmoji(lastRound.player1Choice);
    const p2Emoji = service.getChoiceEmoji(lastRound.player2Choice);
    const resultText =
      lastRound.winner === "player1"
        ? "You Win!"
        : lastRound.winner === "player2"
          ? "AI Wins!"
          : "Draw!";
    const resultColor =
      lastRound.winner === "player1"
        ? "#10b981"
        : lastRound.winner === "player2"
          ? "#ef4444"
          : "#f59e0b";

    return (
      <div
        style={{
          textAlign: "center",
          padding: "2rem",
          background: "rgba(0,0,0,0.3)",
          borderRadius: "1rem",
          marginTop: "1rem",
          animation: "fadeIn 0.5s ease",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "2rem",
            marginBottom: "1rem",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "4rem" }}>{p1Emoji}</div>
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--color-ink-muted)",
                marginTop: "0.25rem",
              }}
            >
              You
            </div>
          </div>
          <div
            style={{
              fontSize: "1.5rem",
              fontWeight: 700,
              color: "var(--color-ink-muted)",
            }}
          >
            VS
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "4rem" }}>{p2Emoji}</div>
            <div
              style={{
                fontSize: "0.75rem",
                color: "var(--color-ink-muted)",
                marginTop: "0.25rem",
              }}
            >
              {mode === "vs-ai" ? aiName : "Opponent"}
            </div>
          </div>
        </div>
        <div
          style={{
            fontSize: "1.5rem",
            fontWeight: 700,
            color: resultColor,
            marginBottom: "1rem",
          }}
        >
          {resultText}
        </div>
        <div
          style={{
            fontSize: "0.85rem",
            color: "var(--color-ink-muted)",
            marginBottom: "1rem",
          }}
        >
          Round {lastRound.round} of {game?.maxRounds || 3}
        </div>
        {game?.phase === GamePhase.GameEnd ? (
          <div>
            <div
              style={{
                fontSize: "1.25rem",
                fontWeight: 700,
                color:
                  game.winner === userAddress ? "#10b981" : "#ef4444",
                marginBottom: "1rem",
              }}
            >
              {game.winner === userAddress
                ? "You Won the Match!"
                : "You Lost the Match!"}
            </div>
            <div
              style={{
                fontSize: "0.85rem",
                color: "var(--color-ink-muted)",
                marginBottom: "1.5rem",
              }}
            >
              Final Score: {game.player1Wins} - {game.player2Wins}
            </div>
            {mode === "pvp-bracket" ? (
              <button
                onClick={handleBracketAdvance}
                className="btn-primary"
                style={{
                  padding: "0.75rem 2rem",
                  borderRadius: "0.75rem",
                  background:
                    "linear-gradient(135deg, var(--color-accent), #7c3aed)",
                  color: "white",
                  border: "none",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: "1rem",
                }}
              >
                {game.winner === userAddress
                  ? "Next Match"
                  : "Back to Menu"}
              </button>
            ) : (
              <div style={{ display: "flex", gap: "1rem", justifyContent: "center" }}>
                <button
                  onClick={startVsAi}
                  className="btn-primary"
                  style={{
                    padding: "0.75rem 2rem",
                    borderRadius: "0.75rem",
                    background:
                      "linear-gradient(135deg, var(--color-accent), #7c3aed)",
                    color: "white",
                    border: "none",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Play Again
                </button>
                <button
                  onClick={() => setMode("menu")}
                  style={{
                    padding: "0.75rem 2rem",
                    borderRadius: "0.75rem",
                    background: "rgba(255,255,255,0.1)",
                    color: "var(--color-ink)",
                    border: "1px solid rgba(255,255,255,0.2)",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Menu
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={handleNextRound}
            className="btn-primary"
            style={{
              padding: "0.75rem 2rem",
              borderRadius: "0.75rem",
              background:
                "linear-gradient(135deg, var(--color-accent), #7c3aed)",
              color: "white",
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Next Round
          </button>
        )}
      </div>
    );
  };

  const renderScoreboard = () => {
    if (!game) return null;
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "space-around",
          alignItems: "center",
          padding: "1rem",
          background: "rgba(0,0,0,0.2)",
          borderRadius: "0.75rem",
          marginBottom: "1rem",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: "0.7rem",
              color: "var(--color-ink-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            You
          </div>
          <div
            style={{
              fontSize: "2rem",
              fontWeight: 700,
              color: "#10b981",
            }}
          >
            {game.player1Wins}
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: "0.7rem",
              color: "var(--color-ink-muted)",
              textTransform: "uppercase",
            }}
          >
            Round
          </div>
          <div
            style={{
              fontSize: "1.5rem",
              fontWeight: 700,
              color: "var(--color-ink)",
            }}
          >
            {game.currentRound}/{game.maxRounds}
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: "0.7rem",
              color: "var(--color-ink-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            {mode === "vs-ai" ? aiName : "Opponent"}
          </div>
          <div
            style={{
              fontSize: "2rem",
              fontWeight: 700,
              color: "#ef4444",
            }}
          >
            {game.player2Wins}
          </div>
        </div>
      </div>
    );
  };

  const renderBracket = () => {
    const stageLabel =
      bracketStage === "quarterfinal"
        ? "Quarterfinals"
        : bracketStage === "semifinal"
          ? "Semifinals"
          : bracketStage === "final"
            ? "Grand Final"
            : "Champion!";

    return (
      <div style={{ marginBottom: "1.5rem" }}>
        <div
          style={{
            textAlign: "center",
            marginBottom: "1rem",
          }}
        >
          <span
            style={{
              display: "inline-block",
              padding: "0.35rem 1rem",
              background:
                "linear-gradient(135deg, var(--color-accent), #7c3aed)",
              borderRadius: "999px",
              fontSize: "0.75rem",
              fontWeight: 600,
              color: "white",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            {stageLabel}
          </span>
        </div>
        {bracketStage === "champion" ? (
          <div
            style={{
              textAlign: "center",
              padding: "2rem",
              background: "rgba(16,185,129,0.1)",
              borderRadius: "1rem",
              border: "1px solid rgba(16,185,129,0.3)",
            }}
          >
            <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>
              {"\uD83C\uDFC6"}
            </div>
            <div
              style={{
                fontSize: "1.5rem",
                fontWeight: 700,
                color: "#10b981",
                marginBottom: "0.5rem",
              }}
            >
              Tournament Champion!
            </div>
            <div
              style={{
                fontSize: "0.85rem",
                color: "var(--color-ink-muted)",
                marginBottom: "1.5rem",
              }}
            >
              You defeated all opponents in the ZK Battle Royale!
            </div>
            <button
              onClick={() => setMode("menu")}
              style={{
                padding: "0.75rem 2rem",
                borderRadius: "0.75rem",
                background:
                  "linear-gradient(135deg, var(--color-accent), #7c3aed)",
                color: "white",
                border: "none",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Back to Menu
            </button>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                bracketMatches.length > 2
                  ? "1fr 1fr"
                  : bracketMatches.length === 2
                    ? "1fr 1fr"
                    : "1fr",
              gap: "0.75rem",
            }}
          >
            {bracketMatches.map((match, idx) => {
              const isCurrentMatch = idx === currentBracketMatch;
              const isUserMatch =
                match.player1 === "You" || match.player2 === "You";
              return (
                <div
                  key={match.id}
                  style={{
                    padding: "0.75rem",
                    background: isCurrentMatch
                      ? "rgba(99,102,241,0.15)"
                      : "rgba(0,0,0,0.2)",
                    borderRadius: "0.75rem",
                    border: isCurrentMatch
                      ? "1px solid rgba(99,102,241,0.4)"
                      : "1px solid rgba(255,255,255,0.05)",
                    opacity: match.winner && !isCurrentMatch ? 0.7 : 1,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: "0.8rem",
                    }}
                  >
                    <span
                      style={{
                        fontWeight:
                          match.winner === match.player1 ? 700 : 400,
                        color:
                          match.winner === match.player1
                            ? "#10b981"
                            : "var(--color-ink)",
                      }}
                    >
                      {match.player1}
                    </span>
                    <span
                      style={{
                        color: "var(--color-ink-muted)",
                        fontSize: "0.7rem",
                      }}
                    >
                      vs
                    </span>
                    <span
                      style={{
                        fontWeight:
                          match.winner === match.player2 ? 700 : 400,
                        color:
                          match.winner === match.player2
                            ? "#10b981"
                            : "var(--color-ink)",
                      }}
                    >
                      {match.player2}
                    </span>
                  </div>
                  {match.winner && (
                    <div
                      style={{
                        textAlign: "center",
                        marginTop: "0.25rem",
                        fontSize: "0.65rem",
                        color: "#10b981",
                      }}
                    >
                      Winner: {match.winner}
                    </div>
                  )}
                  {isCurrentMatch && !match.winner && isUserMatch && (
                    <div
                      style={{
                        textAlign: "center",
                        marginTop: "0.25rem",
                        fontSize: "0.65rem",
                        color: "var(--color-accent)",
                      }}
                    >
                      NOW PLAYING
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderZkProofBadge = () => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.5rem 1rem",
        background: "rgba(99, 102, 241, 0.1)",
        borderRadius: "999px",
        border: "1px solid rgba(99, 102, 241, 0.2)",
        fontSize: "0.7rem",
        color: "var(--color-accent)",
        fontWeight: 600,
        width: "fit-content",
        margin: "0 auto 1rem",
      }}
    >
      <span style={{ fontSize: "0.85rem" }}>{"\uD83D\uDD12"}</span>
      ZK Commit-Reveal Protocol
      <span
        style={{
          display: "inline-block",
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          background: "#10b981",
          animation: "pulse 2s infinite",
        }}
      />
    </div>
  );

  if (mode === "menu") {
    return (
      <div
        style={{
          maxWidth: "600px",
          margin: "0 auto",
        }}
      >
        <style>
          {`
            @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
            @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
            @keyframes float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-10px); } }
          `}
        </style>

        {renderZkProofBadge()}

        <div
          style={{
            textAlign: "center",
            marginBottom: "2rem",
            animation: "fadeIn 0.5s ease",
          }}
        >
          <div
            style={{
              fontSize: "4rem",
              marginBottom: "0.5rem",
              animation: "float 3s ease-in-out infinite",
            }}
          >
            {"\u270A\u270B\u2702\uFE0F"}
          </div>
          <h2
            style={{
              fontSize: "1.5rem",
              fontWeight: 700,
              marginBottom: "0.5rem",
              background: "linear-gradient(135deg, #6366f1, #a855f7)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Choose Your Battle Mode
          </h2>
          <p
            style={{
              color: "var(--color-ink-muted)",
              fontSize: "0.85rem",
            }}
          >
            All moves are cryptographically committed using ZK proofs
            on Stellar
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gap: "1rem",
          }}
        >
          <button
            onClick={startVsAi}
            style={{
              padding: "1.5rem",
              borderRadius: "1rem",
              border: "1px solid rgba(99, 102, 241, 0.3)",
              background:
                "linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(168, 85, 247, 0.1))",
              cursor: "pointer",
              textAlign: "left",
              transition: "all 0.3s ease",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "1rem",
              }}
            >
              <span style={{ fontSize: "2.5rem" }}>{"\uD83E\uDD16"}</span>
              <div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: "1.1rem",
                    color: "var(--color-ink)",
                    marginBottom: "0.25rem",
                  }}
                >
                  VS AI
                </div>
                <div
                  style={{
                    fontSize: "0.8rem",
                    color: "var(--color-ink-muted)",
                  }}
                >
                  Practice against a provably fair AI opponent. Best of
                  3 rounds with ZK commitments.
                </div>
              </div>
            </div>
          </button>

          <button
            onClick={startBracket}
            style={{
              padding: "1.5rem",
              borderRadius: "1rem",
              border: "1px solid rgba(168, 85, 247, 0.3)",
              background:
                "linear-gradient(135deg, rgba(168, 85, 247, 0.1), rgba(236, 72, 153, 0.1))",
              cursor: "pointer",
              textAlign: "left",
              transition: "all 0.3s ease",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "1rem",
              }}
            >
              <span style={{ fontSize: "2.5rem" }}>{"\uD83C\uDFC6"}</span>
              <div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: "1.1rem",
                    color: "var(--color-ink)",
                    marginBottom: "0.25rem",
                  }}
                >
                  Battle Royale Tournament
                </div>
                <div
                  style={{
                    fontSize: "0.8rem",
                    color: "var(--color-ink-muted)",
                  }}
                >
                  8-player elimination bracket. Fight through quarterfinals,
                  semifinals, and the grand final!
                </div>
              </div>
            </div>
          </button>
        </div>

        {totalGamesPlayed > 0 && (
          <div
            style={{
              marginTop: "1.5rem",
              padding: "1rem",
              background: "rgba(0,0,0,0.2)",
              borderRadius: "0.75rem",
              display: "flex",
              justifyContent: "space-around",
              textAlign: "center",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "1.25rem",
                  fontWeight: 700,
                  color: "#10b981",
                }}
              >
                {stats.wins}
              </div>
              <div
                style={{
                  fontSize: "0.65rem",
                  color: "var(--color-ink-muted)",
                  textTransform: "uppercase",
                }}
              >
                Wins
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: "1.25rem",
                  fontWeight: 700,
                  color: "#ef4444",
                }}
              >
                {stats.losses}
              </div>
              <div
                style={{
                  fontSize: "0.65rem",
                  color: "var(--color-ink-muted)",
                  textTransform: "uppercase",
                }}
              >
                Losses
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: "1.25rem",
                  fontWeight: 700,
                  color: "var(--color-ink)",
                }}
              >
                {totalGamesPlayed}
              </div>
              <div
                style={{
                  fontSize: "0.65rem",
                  color: "var(--color-ink-muted)",
                  textTransform: "uppercase",
                }}
              >
                Games
              </div>
            </div>
          </div>
        )}

        <div
          style={{
            marginTop: "1.5rem",
            padding: "1rem",
            background: "rgba(0,0,0,0.15)",
            borderRadius: "0.75rem",
            fontSize: "0.75rem",
            color: "var(--color-ink-muted)",
            lineHeight: 1.6,
          }}
        >
          <strong style={{ color: "var(--color-ink)" }}>
            How ZK Commit-Reveal Works:
          </strong>
          <br />
          1. Each player commits a cryptographic hash of their choice + random
          nonce
          <br />
          2. After both commit, players reveal their actual choice and nonce
          <br />
          3. The contract verifies hash(choice + nonce) matches the commitment
          <br />
          4. This prevents front-running and ensures provable fairness
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "600px", margin: "0 auto" }}>
      <style>
        {`
          @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
          @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
          @keyframes shake { 0%, 100% { transform: rotate(0deg); } 25% { transform: rotate(-15deg); } 75% { transform: rotate(15deg); } }
        `}
      </style>

      {renderZkProofBadge()}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        <button
          onClick={() => setMode("menu")}
          style={{
            padding: "0.35rem 0.75rem",
            borderRadius: "0.5rem",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            cursor: "pointer",
            fontSize: "0.75rem",
            color: "var(--color-ink-muted)",
          }}
        >
          Back
        </button>
        <span
          style={{
            fontSize: "0.8rem",
            fontWeight: 600,
            color: "var(--color-ink)",
          }}
        >
          {mode === "vs-ai"
            ? `VS ${aiName}`
            : `Battle Royale - ${bracketStage === "quarterfinal" ? "QF" : bracketStage === "semifinal" ? "SF" : "Final"}`}
        </span>
      </div>

      {mode === "pvp-bracket" && renderBracket()}

      {game &&
        game.phase !== GamePhase.GameEnd &&
        bracketStage !== "champion" && (
          <>
            {renderScoreboard()}

            {!showResult && game.phase === GamePhase.Commit && (
              <div
                style={{
                  textAlign: "center",
                  animation: "fadeIn 0.3s ease",
                }}
              >
                <div
                  style={{
                    fontSize: "0.85rem",
                    color: "var(--color-ink-muted)",
                    marginBottom: "1rem",
                  }}
                >
                  Choose your move:
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    gap: "1rem",
                  }}
                >
                  {renderChoiceButton(Choice.Rock)}
                  {renderChoiceButton(Choice.Paper)}
                  {renderChoiceButton(Choice.Scissors)}
                </div>
                {animating && (
                  <div
                    style={{
                      marginTop: "1.5rem",
                      fontSize: "0.85rem",
                      color: "var(--color-accent)",
                      animation: "pulse 1s infinite",
                    }}
                  >
                    Committing and revealing...
                  </div>
                )}
              </div>
            )}

            {renderRoundResult()}
          </>
        )}

      {game?.phase === GamePhase.GameEnd &&
        bracketStage !== "champion" &&
        showResult &&
        renderRoundResult()}
    </div>
  );
}
