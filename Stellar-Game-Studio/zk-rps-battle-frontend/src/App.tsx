import { Layout } from './components/Layout';
import { ZkRpsBattleGame } from './games/zk-rps-battle/ZkRpsBattleGame';
import { useWalletStore } from './store/walletSlice';
import { useWalletStandalone } from './hooks/useWalletStandalone';

const GAME_TITLE = 'ZK RPS Battle Royale';
const GAME_TAGLINE = 'Rock-Paper-Scissors with Zero-Knowledge Proofs on Stellar';

export default function App() {
  const { publicKey, isConnected } = useWalletStore();
  const { getContractSigner, connect } = useWalletStandalone();

  return (
    <Layout title={GAME_TITLE} subtitle={GAME_TAGLINE}>
      {isConnected && publicKey ? (
        <ZkRpsBattleGame
          userAddress={publicKey}
          getContractSigner={getContractSigner}
          onStandingsRefresh={() => {}}
          onGameComplete={() => {}}
        />
      ) : (
        <div style={{ maxWidth: '500px', margin: '0 auto', textAlign: 'center', padding: '3rem 1rem' }}>
          <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>{"\u270A\u270B\u2702\uFE0F"}</div>
          <h2 style={{
            fontSize: '1.5rem',
            fontWeight: 700,
            marginBottom: '0.75rem',
            background: 'linear-gradient(135deg, #6366f1, #a855f7)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>
            ZK RPS Battle Royale
          </h2>
          <p style={{ color: 'var(--color-ink-muted)', fontSize: '0.9rem', marginBottom: '2rem', lineHeight: 1.6 }}>
            Connect your Stellar wallet to play Rock-Paper-Scissors with zero-knowledge proofs on the Stellar Testnet. Every move is committed and revealed on-chain.
          </p>
          <button
            onClick={() => connect().catch(() => undefined)}
            style={{
              padding: '0.85rem 2.5rem',
              borderRadius: '0.75rem',
              background: 'linear-gradient(135deg, #6366f1, #7c3aed)',
              color: 'white',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '1rem',
              transition: 'transform 0.2s',
            }}
            onMouseOver={(e) => (e.currentTarget.style.transform = 'translateY(-2px)')}
            onMouseOut={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
          >
            Connect Wallet
          </button>
          <div style={{
            marginTop: '2rem',
            padding: '1rem',
            background: 'rgba(0,0,0,0.1)',
            borderRadius: '0.75rem',
            fontSize: '0.75rem',
            color: 'var(--color-ink-muted)',
            lineHeight: 1.7,
            textAlign: 'left',
          }}>
            <strong style={{ color: 'var(--color-ink)' }}>How it works:</strong><br />
            1. Connect your Freighter or other Stellar wallet<br />
            2. Choose Rock, Paper, or Scissors<br />
            3. Your choice is cryptographically committed on-chain (hash of choice + nonce)<br />
            4. After both players commit, choices are revealed and verified by the smart contract<br />
            5. The contract ensures no one can cheat or front-run
          </div>
        </div>
      )}
    </Layout>
  );
}
