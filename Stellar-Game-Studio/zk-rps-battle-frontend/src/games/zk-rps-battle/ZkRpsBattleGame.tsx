import { useState, useCallback, useRef } from "react";
import { Keypair } from "@stellar/stellar-sdk";
import {
  OnChainRpsService,
  Choice,
  GamePhase,
  computeCommitment,
  generateNonce,
  type Commitment,
} from "./zkRpsBattleService";
import { networks } from "./bindings";
import type { ContractSigner } from "../../types/signer";
import type { Game } from "./bindings";

const CONTRACT_ID = networks.testnet.contractId;
const service = new OnChainRpsService();

type GameMode = "menu" | "vs-ai";

interface ZkRpsBattleGameProps {
  userAddress: string;
  getContractSigner: () => ContractSigner;
  onStandingsRefresh: () => void;
  onGameComplete: () => void;
}

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function truncateHash(data: Uint8Array | null): string {
  if (!data) return "---";
  const hex = Array.from(data.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}...`;
}

const CSS = `
  @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes fadeInScale { from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: scale(1); } }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
  @keyframes float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-10px); } }
  @keyframes slideInLeft { from { opacity: 0; transform: translateX(-30px); } to { opacity: 1; transform: translateX(0); } }
  @keyframes slideInRight { from { opacity: 0; transform: translateX(30px); } to { opacity: 1; transform: translateX(0); } }
  @keyframes glow { 0%, 100% { box-shadow: 0 0 5px rgba(99, 102, 241, 0.3); } 50% { box-shadow: 0 0 20px rgba(99, 102, 241, 0.6); } }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

  .choice-btn { transition: all 0.2s ease; }
  .choice-btn:hover:not(:disabled) { transform: translateY(-4px); box-shadow: 0 8px 25px rgba(99, 102, 241, 0.3); }
  .choice-btn:active:not(:disabled) { transform: translateY(-1px); }
  .mode-btn { transition: all 0.3s ease; }
  .mode-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2); }
`;

export function ZkRpsBattleGame({
  userAddress,
  getContractSigner,
  onStandingsRefresh,
  onGameComplete,
}: ZkRpsBattleGameProps) {
  const [mode, setMode] = useState<GameMode>("menu");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [aiKeypair, setAiKeypair] = useState<Keypair | null>(null);
  const [onChainGame, setOnChainGame] = useState<Game | null>(null);
  const [loading, setLoading] = useState(false);
  const [txStatus, setTxStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastCommitment, setLastCommitment] = useState<Commitment | null>(null);
  const [lastRoundResult, setLastRoundResult] = useState<{
    p1Choice: Choice;
    p2Choice: Choice;
    winner: string;
  } | null>(null);
  const [showRoundResult, setShowRoundResult] = useState(false);
  const [previousGameState, setPreviousGameState] = useState<Game | null>(null);

  const aiNonceRef = useRef<Uint8Array | null>(null);
  const aiChoiceRef = useRef<number | null>(null);
  const userNonceRef = useRef<Uint8Array | null>(null);
  const userChoiceRef = useRef<number | null>(null);

  const startVsAi = useCallback(async () => {
    setMode("vs-ai");
    setLoading(true);
    setError(null);
    setLastRoundResult(null);
    setShowRoundResult(false);
    setLastCommitment(null);

    try {
      const kp = Keypair.random();
      setAiKeypair(kp);

      setTxStatus("Funding AI opponent from Stellar Friendbot...");
      await service.ensureAccountFunded(kp.publicKey());

      setTxStatus("Ensuring your account is funded...");
      await service.ensureAccountFunded(userAddress);

      const signer = getContractSigner();
      const sid = await service.startAiGame(
        userAddress,
        kp,
        signer,
        setTxStatus,
      );
      setSessionId(sid);

      setTxStatus("Reading game state from blockchain...");
      const game = await service.getGame(sid, kp.publicKey());
      setOnChainGame(game);

      setTxStatus("");
    } catch (e: any) {
      console.error("startVsAi error:", e);
      setError(e.message || "Failed to start game");
    } finally {
      setLoading(false);
    }
  }, [userAddress, getContractSigner]);

  const handleChoice = useCallback(
    async (choice: Choice) => {
      if (!sessionId || !aiKeypair || loading) return;

      setLoading(true);
      setError(null);
      setShowRoundResult(false);

      try {
        const signer = getContractSigner();

        const userNonce = generateNonce();
        const userCommitHash = computeCommitment(choice, userNonce);
        userNonceRef.current = userNonce;
        userChoiceRef.current = choice;
        setLastCommitment({ hash: userCommitHash, choice, nonce: userNonce });

        setTxStatus("Committing your choice on-chain...");
        await service.commitChoiceUser(
          sessionId,
          userAddress,
          userCommitHash,
          signer,
          setTxStatus,
        );

        const aiChoices = [Choice.Rock, Choice.Paper, Choice.Scissors];
        const aiChoice = aiChoices[Math.floor(Math.random() * 3)];
        const aiNonce = generateNonce();
        const aiCommitHash = computeCommitment(aiChoice, aiNonce);
        aiNonceRef.current = aiNonce;
        aiChoiceRef.current = aiChoice;

        setTxStatus("AI committing choice on-chain...");
        await service.commitChoiceAi(
          sessionId,
          aiKeypair,
          aiCommitHash,
          setTxStatus,
        );

        setTxStatus("Revealing your choice on-chain...");
        await service.revealChoiceUser(
          sessionId,
          userAddress,
          choice,
          userNonce,
          signer,
          setTxStatus,
        );

        setTxStatus("AI revealing choice on-chain...");
        await service.revealChoiceAi(
          sessionId,
          aiKeypair,
          aiChoice,
          aiNonce,
          setTxStatus,
        );

        setTxStatus("Reading game state from blockchain...");
        setPreviousGameState(onChainGame);
        const updatedGame = await service.getGame(
          sessionId,
          aiKeypair.publicKey(),
        );
        setOnChainGame(updatedGame);

        if (updatedGame) {
          const p1Wins = updatedGame.player1_wins;
          const p2Wins = updatedGame.player2_wins;
          const prevP1 = onChainGame?.player1_wins ?? 0;
          const prevP2 = onChainGame?.player2_wins ?? 0;

          let roundWinner = "draw";
          if (p1Wins > prevP1) roundWinner = "player1";
          else if (p2Wins > prevP2) roundWinner = "player2";

          setLastRoundResult({
            p1Choice: choice,
            p2Choice: aiChoice,
            winner: roundWinner,
          });
          setShowRoundResult(true);
        }

        setTxStatus("");
        onStandingsRefresh();
      } catch (e: any) {
        console.error("handleChoice error:", e);
        setError(e.message || "Transaction failed");
      } finally {
        setLoading(false);
      }
    },
    [
      sessionId,
      aiKeypair,
      loading,
      userAddress,
      getContractSigner,
      onChainGame,
      onStandingsRefresh,
    ],
  );

  const handleNextRound = useCallback(() => {
    setShowRoundResult(false);
    setLastCommitment(null);
    setLastRoundResult(null);
  }, []);

  const renderChoiceButton = (choice: Choice) => {
    const emoji = service.getChoiceEmoji(choice);
    const name = service.getChoiceName(choice);
    const disabled = loading;

    return (
      <button
        key={choice}
        onClick={() => handleChoice(choice)}
        disabled={disabled}
        className="choice-btn"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "0.5rem",
          padding: "1.5rem 2rem",
          borderRadius: "1rem",
          border: "2px solid rgba(255,255,255,0.1)",
          background: "rgba(255,255,255,0.05)",
          cursor: disabled ? "not-allowed" : "pointer",
          fontSize: "3rem",
          opacity: disabled ? 0.5 : 1,
          minWidth: "110px",
        }}
      >
        <span style={{ fontSize: "3rem" }}>{emoji}</span>
        <span
          style={{
            fontSize: "0.8rem",
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

  const renderTxStatus = () => {
    if (!loading || !txStatus) return null;
    return (
      <div
        style={{
          padding: "1.25rem",
          background:
            "linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(168, 85, 247, 0.08))",
          borderRadius: "1rem",
          border: "1px solid rgba(99, 102, 241, 0.2)",
          marginTop: "1rem",
          animation: "fadeIn 0.3s ease",
          textAlign: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.75rem",
          }}
        >
          <div
            style={{
              width: "20px",
              height: "20px",
              border: "2px solid var(--color-accent)",
              borderTopColor: "transparent",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <span
            style={{
              fontSize: "0.85rem",
              color: "var(--color-accent)",
              fontWeight: 600,
            }}
          >
            {txStatus}
          </span>
        </div>

        {lastCommitment && (
          <div
            style={{
              marginTop: "0.75rem",
              background: "rgba(0,0,0,0.3)",
              borderRadius: "0.5rem",
              padding: "0.75rem",
              fontFamily: "monospace",
              fontSize: "0.65rem",
              color: "#10b981",
              textAlign: "left",
            }}
          >
            <div style={{ marginBottom: "0.25rem" }}>
              <span style={{ color: "var(--color-ink-muted)" }}>
                commitment:{" "}
              </span>
              <span>{truncateHash(lastCommitment.hash)}</span>
            </div>
            <div>
              <span style={{ color: "var(--color-ink-muted)" }}>nonce: </span>
              <span>{truncateHash(lastCommitment.nonce)}</span>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderRoundResult = () => {
    if (!lastRoundResult || !showRoundResult) return null;

    const p1Emoji = service.getChoiceEmoji(lastRoundResult.p1Choice);
    const p2Emoji = service.getChoiceEmoji(lastRoundResult.p2Choice);
    const resultText =
      lastRoundResult.winner === "player1"
        ? "You Win This Round!"
        : lastRoundResult.winner === "player2"
          ? "AI Wins This Round!"
          : "Draw!";
    const resultColor =
      lastRoundResult.winner === "player1"
        ? "#10b981"
        : lastRoundResult.winner === "player2"
          ? "#ef4444"
          : "#f59e0b";

    const gameEnded = onChainGame?.phase === GamePhase.GameEnd;
    const winnerAddr = onChainGame?.winner;
    const isUserWinner =
      typeof winnerAddr === "string" && winnerAddr === userAddress;

    return (
      <div
        style={{
          textAlign: "center",
          padding: "1.5rem",
          background: "rgba(0,0,0,0.3)",
          borderRadius: "1rem",
          marginTop: "1rem",
          animation: "fadeInScale 0.4s ease",
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
          <div
            style={{
              textAlign: "center",
              animation: "slideInLeft 0.4s ease",
            }}
          >
            <div style={{ fontSize: "3.5rem" }}>{p1Emoji}</div>
            <div
              style={{
                fontSize: "0.7rem",
                color:
                  lastRoundResult.winner === "player1"
                    ? "#10b981"
                    : "var(--color-ink-muted)",
                marginTop: "0.25rem",
                fontWeight: lastRoundResult.winner === "player1" ? 700 : 400,
              }}
            >
              You
            </div>
          </div>
          <div
            style={{
              fontSize: "1.25rem",
              fontWeight: 700,
              color: "var(--color-ink-muted)",
              padding: "0.5rem",
              borderRadius: "50%",
              background: "rgba(255,255,255,0.05)",
            }}
          >
            VS
          </div>
          <div
            style={{
              textAlign: "center",
              animation: "slideInRight 0.4s ease",
            }}
          >
            <div style={{ fontSize: "3.5rem" }}>{p2Emoji}</div>
            <div
              style={{
                fontSize: "0.7rem",
                color:
                  lastRoundResult.winner === "player2"
                    ? "#ef4444"
                    : "var(--color-ink-muted)",
                marginTop: "0.25rem",
                fontWeight: lastRoundResult.winner === "player2" ? 700 : 400,
              }}
            >
              AI
            </div>
          </div>
        </div>

        <div
          style={{
            fontSize: "1.25rem",
            fontWeight: 700,
            color: resultColor,
            marginBottom: "0.5rem",
          }}
        >
          {resultText}
        </div>

        <div
          style={{
            fontSize: "0.7rem",
            color: "var(--color-ink-muted)",
            marginBottom: "0.5rem",
          }}
        >
          Verified on-chain via ZK commit-reveal
        </div>

        {gameEnded ? (
          <div style={{ animation: "fadeIn 0.5s ease", marginTop: "1rem" }}>
            <div
              style={{
                fontSize: "1.5rem",
                fontWeight: 700,
                color: isUserWinner ? "#10b981" : "#ef4444",
                marginBottom: "0.5rem",
              }}
            >
              {isUserWinner
                ? "\uD83C\uDF89 Match Victory!"
                : "Match Defeat"}
            </div>
            <div
              style={{
                fontSize: "0.85rem",
                color: "var(--color-ink-muted)",
                marginBottom: "1.25rem",
              }}
            >
              Final Score: {onChainGame?.player1_wins} -{" "}
              {onChainGame?.player2_wins}
            </div>
            <div
              style={{
                display: "flex",
                gap: "0.75rem",
                justifyContent: "center",
              }}
            >
              <button
                onClick={startVsAi}
                className="mode-btn"
                style={{
                  padding: "0.75rem 1.75rem",
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
                onClick={() => {
                  setMode("menu");
                  setSessionId(null);
                  setOnChainGame(null);
                  onGameComplete();
                }}
                className="mode-btn"
                style={{
                  padding: "0.75rem 1.75rem",
                  borderRadius: "0.75rem",
                  background: "rgba(255,255,255,0.08)",
                  color: "var(--color-ink)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Menu
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={handleNextRound}
            className="mode-btn"
            style={{
              marginTop: "0.75rem",
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
            Next Round \u2192
          </button>
        )}
      </div>
    );
  };

  const renderScoreboard = () => {
    if (!onChainGame) return null;
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "space-around",
          alignItems: "center",
          padding: "1rem 1.5rem",
          background:
            "linear-gradient(135deg, rgba(16, 185, 129, 0.05), rgba(239, 68, 68, 0.05))",
          borderRadius: "0.75rem",
          marginBottom: "1rem",
          border: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: "0.65rem",
              color: "var(--color-ink-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: "0.25rem",
            }}
          >
            You
          </div>
          <div
            style={{
              fontSize: "2rem",
              fontWeight: 700,
              color: "#10b981",
              lineHeight: 1,
            }}
          >
            {onChainGame.player1_wins}
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: "0.65rem",
              color: "var(--color-ink-muted)",
              textTransform: "uppercase",
              marginBottom: "0.25rem",
            }}
          >
            Round
          </div>
          <div
            style={{
              fontSize: "1.5rem",
              fontWeight: 700,
              color: "var(--color-ink)",
              lineHeight: 1,
            }}
          >
            {onChainGame.current_round}
            <span
              style={{
                color: "var(--color-ink-muted)",
                fontWeight: 400,
              }}
            >
              /{onChainGame.max_rounds}
            </span>
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: "0.65rem",
              color: "var(--color-ink-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: "0.25rem",
            }}
          >
            AI
          </div>
          <div
            style={{
              fontSize: "2rem",
              fontWeight: 700,
              color: "#ef4444",
              lineHeight: 1,
            }}
          >
            {onChainGame.player2_wins}
          </div>
        </div>
      </div>
    );
  };

  const renderContractInfo = () => (
    <div
      style={{
        marginTop: "1.25rem",
        padding: "0.75rem 1rem",
        background: "rgba(0,0,0,0.15)",
        borderRadius: "0.75rem",
        border: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      <div
        style={{
          fontSize: "0.65rem",
          fontWeight: 700,
          color: "var(--color-ink-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          marginBottom: "0.5rem",
        }}
      >
        On-Chain Contract
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          marginBottom: "0.35rem",
        }}
      >
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
        <span
          style={{ fontSize: "0.65rem", color: "#10b981", fontWeight: 600 }}
        >
          Deployed on Stellar Testnet
        </span>
      </div>
      <div
        style={{
          fontFamily: "monospace",
          fontSize: "0.6rem",
          color: "var(--color-ink-muted)",
          wordBreak: "break-all",
          marginBottom: "0.5rem",
        }}
      >
        {CONTRACT_ID}
      </div>
      {sessionId && (
        <div
          style={{
            fontFamily: "monospace",
            fontSize: "0.6rem",
            color: "var(--color-ink-muted)",
            marginBottom: "0.5rem",
          }}
        >
          Session ID: {sessionId}
        </div>
      )}
      <a
        href={`https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          fontSize: "0.6rem",
          color: "var(--color-accent)",
          textDecoration: "none",
          fontWeight: 600,
        }}
      >
        View on Stellar Expert \u2197
      </a>
    </div>
  );

  const renderZkBadge = () => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.5rem 1rem",
        background: "rgba(99, 102, 241, 0.08)",
        borderRadius: "999px",
        border: "1px solid rgba(99, 102, 241, 0.15)",
        fontSize: "0.7rem",
        color: "var(--color-accent)",
        fontWeight: 600,
        width: "fit-content",
        margin: "0 auto 1rem",
      }}
    >
      <span style={{ fontSize: "0.85rem" }}>{"\uD83D\uDD12"}</span>
      On-Chain ZK Commit-Reveal
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
      <div style={{ maxWidth: "600px", margin: "0 auto" }}>
        <style>{CSS}</style>

        {renderZkBadge()}

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
          <p style={{ color: "var(--color-ink-muted)", fontSize: "0.85rem" }}>
            All moves are committed and verified on-chain via Stellar Testnet
          </p>
          <p
            style={{
              color: "var(--color-ink-muted)",
              fontSize: "0.7rem",
              marginTop: "0.5rem",
            }}
          >
            Connected: {truncateAddress(userAddress)}
          </p>
        </div>

        <div style={{ display: "grid", gap: "1rem" }}>
          <button
            onClick={startVsAi}
            disabled={loading}
            className="mode-btn"
            style={{
              padding: "1.5rem",
              borderRadius: "1rem",
              border: "1px solid rgba(99, 102, 241, 0.3)",
              background:
                "linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(168, 85, 247, 0.08))",
              cursor: loading ? "not-allowed" : "pointer",
              textAlign: "left",
              opacity: loading ? 0.6 : 1,
            }}
          >
            <div
              style={{ display: "flex", alignItems: "center", gap: "1rem" }}
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
                  VS AI (On-Chain)
                </div>
                <div style={{ fontSize: "0.8rem", color: "var(--color-ink-muted)" }}>
                  Play against AI with every move committed and verified on the
                  Stellar blockchain. Best of 3 rounds.
                </div>
              </div>
            </div>
          </button>
        </div>

        {loading && renderTxStatus()}

        <div
          style={{
            marginTop: "1.5rem",
            padding: "1rem",
            background: "rgba(0,0,0,0.1)",
            borderRadius: "0.75rem",
            fontSize: "0.75rem",
            color: "var(--color-ink-muted)",
            lineHeight: 1.7,
            border: "1px solid rgba(255,255,255,0.03)",
          }}
        >
          <strong style={{ color: "var(--color-ink)" }}>
            How ZK Commit-Reveal Works On-Chain:
          </strong>
          <br />
          1. You choose Rock, Paper, or Scissors
          <br />
          2. Your choice is hashed with a random nonce (keccak256) and committed
          to the contract
          <br />
          3. AI also commits its hashed choice on-chain
          <br />
          4. Both players reveal their choice + nonce — the contract verifies
          the hash matches
          <br />
          5. Winner is determined on-chain — no cheating possible!
        </div>

        {renderContractInfo()}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "600px", margin: "0 auto" }}>
      <style>{CSS}</style>

      {renderZkBadge()}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        <button
          onClick={() => {
            setMode("menu");
            setSessionId(null);
            setOnChainGame(null);
          }}
          className="mode-btn"
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
          \u2190 Back
        </button>
        <span
          style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--color-ink)" }}
        >
          VS AI (On-Chain)
        </span>
      </div>

      {onChainGame && onChainGame.phase !== GamePhase.GameEnd && (
        <>
          {renderScoreboard()}

          {!showRoundResult && !loading && (
            <div style={{ textAlign: "center", animation: "fadeIn 0.3s ease" }}>
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
            </div>
          )}
        </>
      )}

      {renderTxStatus()}

      {error && (
        <div
          style={{
            padding: "1rem",
            background: "rgba(239, 68, 68, 0.1)",
            borderRadius: "0.75rem",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            marginTop: "1rem",
            fontSize: "0.8rem",
            color: "#ef4444",
          }}
        >
          <strong>Error:</strong> {error}
          <div style={{ marginTop: "0.5rem" }}>
            <button
              onClick={() => {
                setError(null);
                setLoading(false);
              }}
              style={{
                padding: "0.35rem 0.75rem",
                borderRadius: "0.5rem",
                background: "rgba(239, 68, 68, 0.2)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "#ef4444",
                cursor: "pointer",
                fontSize: "0.75rem",
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {renderRoundResult()}

      {onChainGame && renderContractInfo()}
    </div>
  );
}
