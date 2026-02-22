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
- Wallet: `src/hooks/useWalletStandalone.ts` (Freighter via stellar-wallets-kit)
- Types: `src/types/signer.ts` (ContractSigner interface)

### Key Dependencies
- Bun 1.2.16 (frontend runtime)
- Rust 1.93.1 with wasm32v1-none target (contract compilation)
- Soroban SDK (smart contract framework)
- React 19, Vite 7, TailwindCSS 4
- @stellar/stellar-sdk (Soroban RPC, transaction building)
- @creit-tech/stellar-wallets-kit (Freighter wallet integration)
- js-sha3 (keccak256 hashing for commitments)

## How ZK Commit-Reveal Works
1. Each player commits a cryptographic hash of their choice + random nonce (keccak256)
2. After both commit, players reveal their actual choice and nonce
3. The contract verifies hash(choice + nonce) matches the commitment
4. This prevents front-running and ensures provable fairness

## On-Chain Transaction Flow (VS AI)
1. `start_ai_game`: Creates game session, dual-auth (user via Freighter + AI via ephemeral keypair)
2. `commit_choice` (user): User commits keccak256(choice + nonce), signed via Freighter
3. `commit_choice` (AI): AI commits its hashed choice, signed with ephemeral keypair
4. `reveal_choice` (user): User reveals choice + nonce, contract verifies hash
5. `reveal_choice` (AI): AI reveals, contract determines round winner
6. Repeat for best of 3 rounds

## Auth Signing
- User auth entries: signed via Freighter wallet (signTransaction for source account auth, signAuthEntry for address auth)
- AI auth entries: signed manually using custom `signSorobanAuthEntry` function (SHA-256 preimage hash + ed25519 signature)
- Dual-auth transactions (start_ai_game): auth entries identified by address and signed by respective parties

## Development
- Frontend: `cd Stellar-Game-Studio/zk-rps-battle-frontend && bun run dev`
- Contract build: `cargo build --target wasm32v1-none --release -p zk-rps-battle`
- Contract tests: `cd Stellar-Game-Studio && cargo test -p zk-rps-battle`

## Recent Changes
- 2026-02-22: Rewrote zkRpsBattleService with full on-chain transaction flow
- 2026-02-22: Manual Soroban auth entry signing for AI ephemeral keypair
- 2026-02-22: Game component with live on-chain state, scoreboard, round results
- 2026-02-22: Fixed Option<string> winner comparison for game end detection
- 2026-02-22: Removed bindings.ts export * re-exports (Vite warning fix)
- 2026-02-21: Contract deployed to Stellar Testnet (CDKC7PIUYAPEDFXIZ27R7EYUA5GJGTSCVO27OBHFSDUA7NFAY4IY3EZ3)
- 2026-02-21: All 7 contract tests passing
- 2026-02-21: Complete contract rewrite from number-guess to commit-reveal RPS
- 2026-02-21: Frontend game component with VS AI and Battle Royale tournament
- 2026-02-21: ZK commitment system using keccak256 hashing
