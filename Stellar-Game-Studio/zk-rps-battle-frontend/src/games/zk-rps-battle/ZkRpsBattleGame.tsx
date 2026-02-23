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
  @keyframes reveal { 0% { transform: rotateY(0deg); opacity: 0; } 100% { transform: rotateY(360deg); opacity: 1; } }

  .choice-btn { transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.03); }
  .choice-btn:hover:not(:disabled) { transform: translateY(-6px) scale(1.05); background: rgba(99, 102, 241, 0.1); border-color: rgba(99, 102, 241, 0.4); box-shadow: 0 10px 30px rgba(99, 102, 241, 0.2); }
  .choice-btn:active:not(:disabled) { transform: translateY(-2px) scale(0.98); }
  .mode-btn { transition: all 0.3s ease; position: relative; overflow: hidden; }
  .mode-btn::after { content: ''; position: absolute; top: 0; left: -100%; width: 100%; height: 100%; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent); transition: 0.5s; }
  .mode-btn:hover::after { left: 100%; }
  .mode-btn:hover { transform: translateY(-3px); box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3); }
  
  .gaming-card { background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 1.5rem; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }
  .stat-badge { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); padding: 0.5rem 1rem; border-radius: 9999px; display: flex; align-items: center; gap: 0.5rem; }
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

      setTxStatus("Funding AI opponent...");
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

        setTxStatus("Committing choice...");
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

        setTxStatus("AI committing...");
        await service.commitChoiceAi(
          sessionId,
          aiKeypair,
          aiCommitHash,
          setTxStatus,
        );

        setTxStatus("Revealing choice...");
        await service.revealChoiceUser(
          sessionId,
          userAddress,
          choice,
          userNonce,
          signer,
          setTxStatus,
        );

        setTxStatus("AI revealing...");
        await service.revealChoiceAi(
          sessionId,
          aiKeypair,
          aiChoice,
          aiNonce,
          setTxStatus,
        );

        const updatedGame = await service.getGame(
          sessionId,
          aiKeypair.publicKey(),
        );
        
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
          setOnChainGame(updatedGame);
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
          gap: "0.75rem",
          padding: "2rem",
          borderRadius: "1.25rem",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          minWidth: "140px",
        }}
      >
        <span style={{ fontSize: "4rem" }}>{emoji}</span>
        <span style={{ fontSize: "0.85rem", fontWeight: 800, color: "rgba(255,255,255,0.7)", textTransform: "uppercase", letterSpacing: "0.1em" }}>{name}</span>
      </button>
    );
  };

  const renderTxStatus = () => {
    if (!loading || !txStatus) return null;
    return (
      <div style={{ padding: "1.5rem", background: "rgba(99, 102, 241, 0.1)", borderRadius: "1rem", border: "1px solid rgba(99, 102, 241, 0.2)", marginTop: "2rem", animation: "fadeIn 0.3s ease", textAlign: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "1rem" }}>
          <div style={{ width: "24px", height: "24px", border: "3px solid var(--color-accent)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          <span style={{ fontSize: "1rem", color: "var(--color-accent)", fontWeight: 700 }}>{txStatus}</span>
        </div>
        {lastCommitment && (
          <div style={{ marginTop: "1rem", background: "rgba(0,0,0,0.4)", borderRadius: "0.75rem", padding: "1rem", fontFamily: "monospace", fontSize: "0.75rem", color: "#10b981", textAlign: "left", border: "1px solid rgba(255,255,255,0.05)" }}>
            <div style={{ marginBottom: "0.5rem" }}><span style={{ opacity: 0.5 }}>commitment:</span> {truncateHash(lastCommitment.hash)}</div>
            <div><span style={{ opacity: 0.5 }}>nonce:</span> {truncateHash(lastCommitment.nonce)}</div>
          </div>
        )}
      </div>
    );
  };

  const renderRoundResult = () => {
    if (!lastRoundResult || !showRoundResult) return null;

    const p1Emoji = service.getChoiceEmoji(lastRoundResult.p1Choice);
    const p2Emoji = service.getChoiceEmoji(lastRoundResult.p2Choice);
    const isWin = lastRoundResult.winner === "player1";
    const isLoss = lastRoundResult.winner === "player2";
    const resultText = isWin ? "VICTORY!" : isLoss ? "DEFEATED" : "DRAW";
    const resultColor = isWin ? "#10b981" : isLoss ? "#ef4444" : "#f59e0b";
    
    const gameEnded = onChainGame?.phase === GamePhase.GameEnd;
    const winnerAddr = onChainGame?.winner;
    const isUserWinner =
      typeof winnerAddr === "string" && winnerAddr === userAddress;
    const isAiWinner =
      typeof winnerAddr === "string" && winnerAddr !== userAddress && winnerAddr !== "0000000000000000000000000000000000000000000000000000000000000000";

    return (
      <div className="gaming-card" style={{ textAlign: "center", padding: "3rem", marginTop: "2rem", animation: "fadeInScale 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)", background: "rgba(0,0,0,0.4)", border: gameEnded ? `2px solid ${isUserWinner ? '#10b981' : '#ef4444'}` : '1px solid rgba(255,255,255,0.1)' }}>
        {gameEnded && (
          <div style={{ position: 'absolute', top: '-20px', left: '50%', transform: 'translateX(-50%)', background: isUserWinner ? '#10b981' : '#ef4444', color: 'white', padding: '0.5rem 2rem', borderRadius: '2rem', fontWeight: 900, fontSize: '1.2rem', boxShadow: '0 0 20px rgba(0,0,0,0.5)' }}>
            {isUserWinner ? 'CHAMPION' : 'ELIMINATED'}
          </div>
        )}
        
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "4rem", marginBottom: "2rem" }}>
          <div style={{ textAlign: "center", animation: "reveal 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
            <div style={{ fontSize: "5rem", filter: `drop-shadow(0 0 20px ${isWin || (gameEnded && isUserWinner) ? 'rgba(16, 185, 129, 0.6)' : 'rgba(255,255,255,0.2)'})` }}>{p1Emoji}</div>
            <div style={{ fontSize: "0.9rem", color: isWin ? "#10b981" : "rgba(255,255,255,0.5)", marginTop: "1rem", fontWeight: 800, letterSpacing: "0.2em" }}>YOU</div>
          </div>
          <div style={{ fontSize: "2rem", fontWeight: 900, color: "rgba(255,255,255,0.1)", fontStyle: "italic" }}>VS</div>
          <div style={{ textAlign: "center", animation: "reveal 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.2s both" }}>
            <div style={{ fontSize: "5rem", filter: `drop-shadow(0 0 20px ${isLoss || (gameEnded && isAiWinner) ? 'rgba(239, 68, 68, 0.6)' : 'rgba(255,255,255,0.2)'})` }}>{p2Emoji}</div>
            <div style={{ fontSize: "0.9rem", color: isLoss ? "#ef4444" : "rgba(255,255,255,0.5)", marginTop: "1rem", fontWeight: 800, letterSpacing: "0.2em" }}>AI</div>
          </div>
        </div>

        {!gameEnded ? (
          <>
            <div style={{ fontSize: "3rem", fontWeight: 900, color: resultColor, marginBottom: "1rem", letterSpacing: "0.1em" }}>{resultText}</div>
            <button onClick={handleNextRound} className="mode-btn" style={{ marginTop: "2rem", padding: "1rem 3rem", borderRadius: "1rem", background: "linear-gradient(135deg, #6366f1, #a855f7)", color: "#fff", border: "none", fontWeight: 800, cursor: "pointer" }}>NEXT ROUND</button>
          </>
        ) : (
          <div style={{ animation: "fadeIn 0.8s ease", marginTop: "1rem" }}>
            <div style={{ fontSize: "4rem", fontWeight: 900, color: isUserWinner ? "#10b981" : "#ef4444", marginBottom: "0.5rem", textShadow: `0 0 30px ${isUserWinner ? 'rgba(16,185,129,0.5)' : 'rgba(239,68,68,0.5)'}` }}>
              {isUserWinner ? "YOU WIN!" : "AI WINS!"}
            </div>
            <div style={{ fontSize: "1.2rem", color: "rgba(255,255,255,0.7)", marginBottom: "2.5rem", fontWeight: 600 }}>
              Final Score: {onChainGame?.player1_wins} - {onChainGame?.player2_wins}
            </div>
            <div style={{ display: "flex", gap: "1.5rem", justifyContent: "center" }}>
              <button onClick={startVsAi} className="mode-btn" style={{ padding: "1.2rem 3rem", borderRadius: "1rem", background: "linear-gradient(135deg, #10b981, #059669)", color: "#fff", border: "none", fontWeight: 900, cursor: "pointer", fontSize: "1.1rem" }}>PLAY AGAIN</button>
              <button onClick={() => setMode("menu")} className="mode-btn" style={{ padding: "1.2rem 3rem", borderRadius: "1rem", background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", fontWeight: 900, cursor: "pointer", fontSize: "1.1rem" }}>QUIT</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderScoreboard = () => {
    if (!onChainGame) return null;
    return (
      <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center", padding: "2rem", background: "rgba(255,255,255,0.03)", borderRadius: "1.25rem", marginBottom: "2rem", border: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.5)", fontWeight: 800, textTransform: "uppercase", marginBottom: "0.5rem" }}>YOU</div>
          <div style={{ fontSize: "3.5rem", fontWeight: 900, color: "#10b981" }}>{onChainGame.player1_wins}</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.5)", fontWeight: 800, textTransform: "uppercase", marginBottom: "0.5rem" }}>ROUND</div>
          <div style={{ fontSize: "2rem", fontWeight: 900 }}>{onChainGame.current_round}<span style={{ opacity: 0.3 }}>/{onChainGame.max_rounds}</span></div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.5)", fontWeight: 800, textTransform: "uppercase", marginBottom: "0.5rem" }}>AI</div>
          <div style={{ fontSize: "3.5rem", fontWeight: 900, color: "#ef4444" }}>{onChainGame.player2_wins}</div>
        </div>
      </div>
    );
  };

  const renderContractInfo = () => (
    <div style={{ marginTop: "2rem", padding: "1.5rem", background: "rgba(0,0,0,0.2)", borderRadius: "1rem", border: "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ fontSize: "0.75rem", fontWeight: 800, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: "1rem" }}>Blockchain Protocol</div>
      <div style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "rgba(255,255,255,0.3)", wordBreak: "break-all", marginBottom: "1rem" }}>{CONTRACT_ID}</div>
      <a href={`https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.75rem", color: "var(--color-accent)", textDecoration: "none", fontWeight: 800 }}>EXPLORER \u2197</a>
    </div>
  );

  const renderZkBadge = () => (
    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.6rem 1.25rem", background: "rgba(99, 102, 241, 0.15)", borderRadius: "999px", border: "1px solid rgba(99, 102, 241, 0.3)", fontSize: "0.75rem", color: "var(--color-accent)", fontWeight: 800 }}>
      <span style={{ fontSize: "1rem" }}>{"\uD83D\uDD12"}</span> ZK-SECURE
    </div>
  );

  if (mode === "menu") {
    return (
      <div className="gaming-card" style={{ maxWidth: "600px", margin: "0 auto", padding: "3rem" }}>
        <style>{CSS}</style>
        {renderZkBadge()}
        <div style={{ textAlign: "center", margin: "3rem 0" }}>
          <div style={{ fontSize: "6rem", marginBottom: "1rem", animation: "float 3s ease-in-out infinite" }}>{"\u270A\u270B\u2702\uFE0F"}</div>
          <h2 style={{ fontSize: "3rem", fontWeight: 900, marginBottom: "1rem", background: "linear-gradient(to bottom, #fff, #6366f1)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>ZK BATTLE</h2>
          <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "1.1rem" }}>Provably fair on-chain RPS</p>
        </div>
        <button onClick={startVsAi} disabled={loading} className="mode-btn" style={{ width: "100%", padding: "2rem", borderRadius: "1.5rem", border: "1px solid rgba(99, 102, 241, 0.4)", background: "linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(168, 85, 247, 0.15))", cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
            <span style={{ fontSize: "3.5rem" }}>{"\uD83E\uDD16"}</span>
            <div style={{ textAlign: "left" }}>
              <div style={{ fontWeight: 900, fontSize: "1.5rem", color: "#fff" }}>START BATTLE</div>
              <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.9rem" }}>Versus AI • Best of 3 • ZK Verified</div>
            </div>
          </div>
        </button>
        {loading && renderTxStatus()}
        {renderContractInfo()}
      </div>
    );
  }

  return (
    <div className="gaming-card" style={{ padding: "3rem", maxWidth: "800px", margin: "0 auto", animation: "fadeIn 0.5s ease" }}>
      <style>{CSS}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "3rem" }}>
        <div>
          <h2 style={{ fontSize: "2rem", fontWeight: 900, color: "#fff", letterSpacing: "-0.02em" }}>ARENA</h2>
          <div className="stat-badge"><span style={{ width: 8, height: 8, background: "#10b981", borderRadius: "50%" }} /> <span style={{ fontSize: "0.75rem", fontWeight: 800, color: "rgba(255,255,255,0.6)" }}>SESSION #{sessionId}</span></div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "1rem" }}>
          <button onClick={() => setMode("menu")} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: "0.8rem", fontWeight: 800 }}>QUIT</button>
          {renderZkBadge()}
        </div>
      </div>

      {renderScoreboard()}

      {!showRoundResult && !loading && (
        <div style={{ textAlign: "center", margin: "4rem 0" }}>
          <div style={{ display: "flex", justifyContent: "center", gap: "2rem" }}>
            {[Choice.Rock, Choice.Paper, Choice.Scissors].map(renderChoiceButton)}
          </div>
        </div>
      )}

      {renderTxStatus()}
      {renderRoundResult()}
      {renderContractInfo()}
    </div>
  );
}
