import { useMemo } from 'react';
import { Layout } from './components/Layout';
import { ZkRpsBattleGame } from './games/zk-rps-battle/ZkRpsBattleGame';

const GAME_TITLE = 'ZK RPS Battle Royale';
const GAME_TAGLINE = 'Rock-Paper-Scissors with Zero-Knowledge Proofs on Stellar';

export default function App() {
  const userAddress = useMemo(() => 'PLAYER_' + Math.random().toString(36).slice(2, 8).toUpperCase(), []);

  return (
    <Layout title={GAME_TITLE} subtitle={GAME_TAGLINE}>
      <ZkRpsBattleGame
        userAddress={userAddress}
        currentEpoch={1}
        availablePoints={1000000000n}
        onStandingsRefresh={() => {}}
        onGameComplete={() => {}}
      />
    </Layout>
  );
}
