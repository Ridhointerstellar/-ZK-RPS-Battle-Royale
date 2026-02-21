# ZK RPS Battle Royale

## Overview
A ZK-powered Rock-Paper-Scissors Battle Royale game built for the Stellar ZK Gaming Hackathon (deadline: Feb 23, 2026). Features commit-reveal protocol with zero-knowledge proofs on Stellar blockchain for provable fairness.

## Game Modes
- **VS AI**: Practice against a provably fair AI opponent (best of 3 rounds)
- **Battle Royale Tournament**: 8-player elimination bracket (quarterfinals -> semifinals -> final)

## Architecture

### Smart Contract (Soroban/Rust)
- Location: `Stellar-Game-Studio/contracts/zk-rps-battle/src/lib.rs`
- Tests: `Stellar-Game-Studio/contracts/zk-rps-battle/src/test.rs`
- Commit-reveal protocol: players commit hash(choice + nonce), then reveal choice + nonce
- Best of 3 rounds per match
- Game Hub integration (start_game/end_game)
- Game Hub Contract ID (testnet): `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG`
- RPS Battle Contract ID (testnet): `CDKC7PIUYAPEDFXIZ27R7EYUA5GJGTSCVO27OBHFSDUA7NFAY4IY3EZ3`
- Deployer Address: `GAOA3ZMFEKTJ2KLD6ARW6Y6UOBGRGPHHSLBTWCYSEEY6NIC2X3AZ4D5F`

### Frontend (React + Vite + TypeScript)
- Location: `Stellar-Game-Studio/zk-rps-battle-frontend/`
- Port: 5000 (bound to 0.0.0.0)
- Game UI: `src/games/zk-rps-battle/ZkRpsBattleGame.tsx`
- Service layer: `src/games/zk-rps-battle/zkRpsBattleService.ts`
- Contract bindings: `src/games/zk-rps-battle/bindings.ts`

### Key Dependencies
- Bun 1.2.16 (frontend runtime)
- Rust 1.93.1 with wasm32v1-none target (contract compilation)
- Soroban SDK (smart contract framework)
- React 19, Vite 7, TailwindCSS 4

## How ZK Commit-Reveal Works
1. Each player commits a cryptographic hash of their choice + random nonce
2. After both commit, players reveal their actual choice and nonce
3. The contract verifies hash(choice + nonce) matches the commitment
4. This prevents front-running and ensures provable fairness

## Development
- Frontend: `cd Stellar-Game-Studio/zk-rps-battle-frontend && bun run dev`
- Contract build: `cargo build --target wasm32v1-none --release -p zk-rps-battle`
- Contract tests: `cd Stellar-Game-Studio && cargo test -p zk-rps-battle`

## Recent Changes
- 2026-02-21: Contract deployed to Stellar Testnet (CDKC7PIUYAPEDFXIZ27R7EYUA5GJGTSCVO27OBHFSDUA7NFAY4IY3EZ3)
- 2026-02-21: Fixed Hash<32> to BytesN<32> conversion in contract and tests
- 2026-02-21: All 7 contract tests passing
- 2026-02-21: Complete contract rewrite from number-guess to commit-reveal RPS
- 2026-02-21: Frontend game component with VS AI and Battle Royale tournament
- 2026-02-21: ZK commitment system using SHA-256 hashing
