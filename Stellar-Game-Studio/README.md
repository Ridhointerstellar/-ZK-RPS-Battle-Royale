# ZK RPS Battle Royale

A **Zero-Knowledge Rock-Paper-Scissors Battle Royale** game built on the **Stellar blockchain** using Soroban smart contracts. Features a cryptographic commit-reveal protocol ensuring provably fair gameplay where neither player can cheat or front-run the other.

**Live Demo:** [stellar-rps.fun](https://stellar-rps.fun)

**Hackathon:** Stellar ZK Gaming Hackathon 2026

---

## How It Works

### ZK Commit-Reveal Protocol

The game uses a **commit-reveal scheme** (a zero-knowledge technique) to ensure fairness:

1. **Commit Phase** - Each player submits a cryptographic hash of their choice + a random nonce: `keccak256(choice || nonce)`. Neither player knows what the other picked.
2. **Reveal Phase** - Both players reveal their actual choice and nonce. The smart contract verifies that `hash(choice + nonce)` matches the original commitment.
3. **Resolution** - The contract determines the round winner based on standard RPS rules.

This prevents:
- **Front-running**: No one can see the opponent's move before committing their own
- **Tampering**: Changing your move after committing is cryptographically impossible
- **Cheating**: The contract verifies all commitments on-chain

### Game Rules

- **Best of 3 rounds** per match
- Standard Rock-Paper-Scissors rules (Rock > Scissors > Paper > Rock)
- First player to reach the winning threshold is declared **CHAMPION**
- All game logic runs **fully on-chain** on Stellar Testnet

---

## Game Modes

### VS AI
Practice against a provably fair AI opponent. The AI uses an ephemeral keypair funded via Stellar Friendbot, making its moves independently verifiable on-chain.

### Battle Royale Tournament (Coming Soon)
8-player elimination bracket: Quarterfinals -> Semifinals -> Final

---

## Architecture

### Smart Contract (Soroban/Rust)

The core game logic is implemented as a Soroban smart contract:

- **Commit-reveal protocol** with keccak256 hashing
- **Game Hub integration** via `start_game` / `end_game` interface
- **Best of 3** round management with automatic winner detection
- **7 comprehensive tests** covering all game scenarios

**Deployed Contracts (Testnet):**
| Contract | Address |
|----------|---------|
| ZK RPS Battle | `CDKC7PIUYAPEDFXIZ27R7EYUA5GJGTSCVO27OBHFSDUA7NFAY4IY3EZ3` |
| Game Hub | `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG` |

### Frontend (React + Vite + TypeScript)

A professional gaming UI with:
- Wallet integration (Freighter, Rabet, xBull) via `stellar-wallets-kit`
- Real-time on-chain game state polling
- 3D flip reveal animations and glassmorphism design
- Live scoreboard and round history
- Champion/Eliminated badges with celebratory effects

---

## Project Structure

```
Stellar-Game-Studio/
├── contracts/
│   ├── zk-rps-battle/              # Main game contract
│   │   ├── src/
│   │   │   ├── lib.rs              # Contract logic (commit-reveal, game flow)
│   │   │   └── test.rs             # 7 unit tests
│   │   ├── Cargo.toml
│   │   └── README.md
│   ├── mock-game-hub/              # Game Hub mock for testing
│   ├── dice-duel/                  # Example game (reference)
│   ├── number-guess/               # Example game (reference)
│   └── twenty-one/                 # Example game (reference)
│
├── zk-rps-battle-frontend/         # Main game frontend
│   ├── src/
│   │   ├── games/zk-rps-battle/
│   │   │   ├── ZkRpsBattleGame.tsx       # Game UI component
│   │   │   ├── zkRpsBattleService.ts     # On-chain transaction service
│   │   │   └── bindings.ts               # Contract bindings
│   │   ├── hooks/
│   │   │   └── useWalletStandalone.ts    # Wallet connection hook
│   │   ├── components/                    # Layout & wallet UI
│   │   ├── utils/                         # Transaction helpers, auth utils
│   │   ├── types/                         # TypeScript interfaces
│   │   ├── App.tsx                        # Main app component
│   │   └── main.tsx                       # Entry point
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
│
├── scripts/                        # Build & deployment automation
│   ├── setup.ts                    # Full setup script
│   ├── build.ts                    # Contract builder
│   ├── deploy.ts                   # Testnet deployer
│   ├── bindings.ts                 # TypeScript binding generator
│   └── create.ts                   # Game scaffolding
│
├── sgs_frontend/                   # Stellar Game Studio docs site
├── template_frontend/              # Game template for scaffolding
├── Cargo.toml                      # Workspace config
└── package.json                    # Root scripts
```

---

## On-Chain Transaction Flow (VS AI)

```
┌─────────────┐                    ┌──────────────┐                    ┌──────────┐
│   Player     │                    │  Smart       │                    │    AI    │
│  (Freighter) │                    │  Contract    │                    │(Ephemeral│
│              │                    │  (Soroban)   │                    │ Keypair) │
└──────┬───────┘                    └──────┬───────┘                    └────┬─────┘
       │                                   │                                 │
       │  1. start_ai_game(user, ai)       │                                 │
       │──────────────────────────────────>│                                 │
       │                                   │  Fund AI via Friendbot          │
       │                                   │────────────────────────────────>│
       │                                   │                                 │
       │  2. commit_choice(hash)           │                                 │
       │──────────────────────────────────>│                                 │
       │                                   │  3. commit_choice(hash)         │
       │                                   │<────────────────────────────────│
       │                                   │                                 │
       │  4. reveal_choice(choice, nonce)  │                                 │
       │──────────────────────────────────>│                                 │
       │                                   │  5. reveal_choice(choice, nonce)│
       │                                   │<────────────────────────────────│
       │                                   │                                 │
       │  Contract verifies commitments    │                                 │
       │  and determines round winner      │                                 │
       │<─────────────────────────────────│                                 │
       │                                   │                                 │
       │  Repeat for best of 3 rounds      │                                 │
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Blockchain | Stellar Testnet (Soroban) |
| Smart Contract | Rust + Soroban SDK |
| Frontend | React 19 + TypeScript + Vite 7 |
| Styling | TailwindCSS 4 |
| Wallet | stellar-wallets-kit (Freighter, Rabet, xBull) |
| Crypto | keccak256 (js-sha3) |
| Runtime | Bun 1.2 |
| State | Zustand |

---

## Auth & Signing

- **User transactions**: Signed via Freighter wallet (`signTransaction` for source account auth, `signAuthEntry` for contract address auth)
- **AI transactions**: Signed programmatically using ephemeral ed25519 keypair with custom `signSorobanAuthEntry` function
- **Dual-auth transactions** (e.g., `start_ai_game`): Auth entries identified by address and signed by respective parties

---

## Development

### Prerequisites
- [Bun](https://bun.sh/) >= 1.2
- [Rust](https://rustup.rs/) with `wasm32v1-none` target
- A Stellar wallet browser extension (Freighter recommended)

### Setup

```bash
git clone https://github.com/Ridhointerstellar/-ZK-RPS-Battle-Royale.git
cd -ZK-RPS-Battle-Royale

# Install dependencies
bun install

# Run the frontend dev server
cd zk-rps-battle-frontend
bun install
bun run dev
```

### Contract Development

```bash
# Build contract
cargo build --target wasm32v1-none --release -p zk-rps-battle

# Run tests (7 tests)
cargo test -p zk-rps-battle
```

### Contract Tests

| Test | Description |
|------|-------------|
| `test_start_game` | Game initialization and state setup |
| `test_commit_phase` | Both players commit hashed choices |
| `test_cannot_commit_twice` | Prevents double-commit attacks |
| `test_commitment_mismatch_fails` | Rejects invalid reveals |
| `test_reveal_round_rock_beats_scissors` | Round resolution logic |
| `test_full_game_player1_wins` | Complete game flow |
| `test_total_games_counter` | Game counter tracking |

---

## Game Hub Integration

Every game in the Stellar Game Studio ecosystem must integrate with the Game Hub contract:

```rust
#[contractclient(name = "GameHubClient")]
pub trait GameHub {
    fn start_game(
        env: Env,
        game_id: Address,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    );

    fn end_game(env: Env, session_id: u32, player1_won: bool);
}
```

**Game Hub Contract (Testnet):** `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG`

---

## Blockchain Explorer

View all game transactions on Stellar Expert:
- [ZK RPS Battle Contract](https://stellar.expert/explorer/testnet/contract/CDKC7PIUYAPEDFXIZ27R7EYUA5GJGTSCVO27OBHFSDUA7NFAY4IY3EZ3)
- [Game Hub Contract](https://stellar.expert/explorer/testnet/contract/CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG)

---

## License

MIT License - see [LICENSE](LICENSE) file

---

**Built for the Stellar ZK Gaming Hackathon 2026**
