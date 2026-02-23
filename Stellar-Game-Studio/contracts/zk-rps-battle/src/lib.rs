#![no_std]

use soroban_sdk::{
    Address, Bytes, BytesN, Env, IntoVal, contract, contractclient, contracterror, contractimpl,
    contracttype, vec,
};

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

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    GameNotFound = 1,
    NotPlayer = 2,
    AlreadyCommitted = 3,
    NotAllCommitted = 4,
    GameAlreadyEnded = 5,
    InvalidChoice = 6,
    CommitmentMismatch = 7,
    AlreadyRevealed = 8,
    NotAllRevealed = 9,
    RoundNotActive = 10,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Choice {
    None = 0,
    Rock = 1,
    Paper = 2,
    Scissors = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum GamePhase {
    Commit = 0,
    Reveal = 1,
    RoundEnd = 2,
    GameEnd = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Game {
    pub player1: Address,
    pub player2: Address,
    pub player1_points: i128,
    pub player2_points: i128,
    pub current_round: u32,
    pub max_rounds: u32,
    pub player1_wins: u32,
    pub player2_wins: u32,
    pub phase: GamePhase,
    pub player1_commitment: BytesN<32>,
    pub player2_commitment: BytesN<32>,
    pub player1_choice: Choice,
    pub player2_choice: Choice,
    pub player1_committed: bool,
    pub player2_committed: bool,
    pub player1_revealed: bool,
    pub player2_revealed: bool,
    pub round_winner: Choice,
    pub winner: Option<Address>,
    pub is_vs_ai: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Leaderboard {
    pub player: Address,
    pub wins: u32,
    pub losses: u32,
    pub draws: u32,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Game(u32),
    GameHubAddress,
    Admin,
    Leaderboard(Address),
    TotalGames,
}

const GAME_TTL_LEDGERS: u32 = 518_400;
const EMPTY_HASH: [u8; 32] = [0u8; 32];

#[contract]
pub struct ZkRpsBattleContract;

#[contractimpl]
impl ZkRpsBattleContract {
    pub fn __constructor(env: Env, admin: Address, game_hub: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::GameHubAddress, &game_hub);
        env.storage()
            .instance()
            .set(&DataKey::TotalGames, &0u32);
    }

    pub fn start_game(
        env: Env,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    ) -> Result<(), Error> {
        if player1 == player2 {
            panic!("Cannot play against yourself");
        }

        player1.require_auth_for_args(vec![
            &env,
            session_id.into_val(&env),
            player1_points.into_val(&env),
        ]);
        player2.require_auth_for_args(vec![
            &env,
            session_id.into_val(&env),
            player2_points.into_val(&env),
        ]);

        let game_hub_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub address not set");

        let game_hub = GameHubClient::new(&env, &game_hub_addr);

        game_hub.start_game(
            &env.current_contract_address(),
            &session_id,
            &player1,
            &player2,
            &player1_points,
            &player2_points,
        );

        let empty = BytesN::from_array(&env, &EMPTY_HASH);

        let game = Game {
            player1: player1.clone(),
            player2: player2.clone(),
            player1_points,
            player2_points,
            current_round: 1,
            max_rounds: 3,
            player1_wins: 0,
            player2_wins: 0,
            phase: GamePhase::Commit,
            player1_commitment: empty.clone(),
            player2_commitment: empty,
            player1_choice: Choice::None,
            player2_choice: Choice::None,
            player1_committed: false,
            player2_committed: false,
            player1_revealed: false,
            player2_revealed: false,
            round_winner: Choice::None,
            winner: None,
            is_vs_ai: false,
        };

        let game_key = DataKey::Game(session_id);
        env.storage().temporary().set(&game_key, &game);
        env.storage()
            .temporary()
            .extend_ttl(&game_key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);

        let total: u32 = env
            .storage()
            .instance()
            .get(&DataKey::TotalGames)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalGames, &(total + 1));

        Ok(())
    }

    pub fn start_ai_game(
        env: Env,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    ) -> Result<(), Error> {
        if player1 == player2 {
            panic!("Cannot play against yourself");
        }

        player1.require_auth_for_args(vec![
            &env,
            session_id.into_val(&env),
            player1_points.into_val(&env),
        ]);
        player2.require_auth_for_args(vec![
            &env,
            session_id.into_val(&env),
            player2_points.into_val(&env),
        ]);

        let game_hub_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub address not set");

        let game_hub = GameHubClient::new(&env, &game_hub_addr);

        game_hub.start_game(
            &env.current_contract_address(),
            &session_id,
            &player1,
            &player2,
            &player1_points,
            &player2_points,
        );

        let empty = BytesN::from_array(&env, &EMPTY_HASH);

        let game = Game {
            player1: player1.clone(),
            player2: player2.clone(),
            player1_points,
            player2_points,
            current_round: 1,
            max_rounds: 3,
            player1_wins: 0,
            player2_wins: 0,
            phase: GamePhase::Commit,
            player1_commitment: empty.clone(),
            player2_commitment: empty,
            player1_choice: Choice::None,
            player2_choice: Choice::None,
            player1_committed: false,
            player2_committed: false,
            player1_revealed: false,
            player2_revealed: false,
            round_winner: Choice::None,
            winner: None,
            is_vs_ai: true,
        };

        let game_key = DataKey::Game(session_id);
        env.storage().temporary().set(&game_key, &game);
        env.storage()
            .temporary()
            .extend_ttl(&game_key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);

        let total: u32 = env
            .storage()
            .instance()
            .get(&DataKey::TotalGames)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalGames, &(total + 1));

        Ok(())
    }

    pub fn commit_choice(
        env: Env,
        session_id: u32,
        player: Address,
        commitment: BytesN<32>,
    ) -> Result<(), Error> {
        player.require_auth();

        let key = DataKey::Game(session_id);
        let mut game: Game = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        if game.winner.is_some() {
            return Err(Error::GameAlreadyEnded);
        }

        if game.phase != GamePhase::Commit {
            return Err(Error::RoundNotActive);
        }

        if player == game.player1 {
            if game.player1_committed {
                return Err(Error::AlreadyCommitted);
            }
            game.player1_commitment = commitment;
            game.player1_committed = true;
        } else if player == game.player2 {
            if game.player2_committed {
                return Err(Error::AlreadyCommitted);
            }
            game.player2_commitment = commitment;
            game.player2_committed = true;
        } else {
            return Err(Error::NotPlayer);
        }

        if game.player1_committed && game.player2_committed {
            game.phase = GamePhase::Reveal;
        }

        env.storage().temporary().set(&key, &game);
        env.storage()
            .temporary()
            .extend_ttl(&key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);

        Ok(())
    }

    pub fn reveal_choice(
        env: Env,
        session_id: u32,
        player: Address,
        choice: u32,
        nonce: BytesN<32>,
    ) -> Result<(), Error> {
        player.require_auth();

        let key = DataKey::Game(session_id);
        let mut game: Game = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        if game.winner.is_some() {
            return Err(Error::GameAlreadyEnded);
        }

        if game.phase != GamePhase::Reveal {
            return Err(Error::RoundNotActive);
        }

        if choice < 1 || choice > 3 {
            return Err(Error::InvalidChoice);
        }

        let mut hash_input = Bytes::new(&env);
        hash_input.append(&Bytes::from_array(&env, &choice.to_be_bytes()));
        hash_input.append(&Bytes::from_slice(&env, &nonce.to_array()));
        let computed_hash = env.crypto().keccak256(&hash_input);

        let the_choice = match choice {
            1 => Choice::Rock,
            2 => Choice::Paper,
            3 => Choice::Scissors,
            _ => return Err(Error::InvalidChoice),
        };

        if player == game.player1 {
            if game.player1_revealed {
                return Err(Error::AlreadyRevealed);
            }
            if computed_hash.to_bytes() != game.player1_commitment {
                return Err(Error::CommitmentMismatch);
            }
            game.player1_choice = the_choice;
            game.player1_revealed = true;
        } else if player == game.player2 {
            if game.player2_revealed {
                return Err(Error::AlreadyRevealed);
            }
            if computed_hash.to_bytes() != game.player2_commitment {
                return Err(Error::CommitmentMismatch);
            }
            game.player2_choice = the_choice;
            game.player2_revealed = true;
        } else {
            return Err(Error::NotPlayer);
        }

        if game.player1_revealed && game.player2_revealed {
            let round_result = Self::determine_round_winner(&game.player1_choice, &game.player2_choice);

            match round_result {
                1 => game.player1_wins += 1,
                2 => game.player2_wins += 1,
                _ => {
                    game.player1_wins += 1;
                    game.player2_wins += 1;
                }
            }

            let needed_wins = (game.max_rounds / 2) + 1;

            if game.player1_wins >= needed_wins || game.player2_wins >= needed_wins
                || game.current_round >= game.max_rounds
            {
                let p1_won = game.player1_wins > game.player2_wins;
                let winner = if p1_won {
                    game.player1.clone()
                } else {
                    game.player2.clone()
                };
                game.winner = Some(winner);
                game.phase = GamePhase::GameEnd;

                let game_hub_addr: Address = env
                    .storage()
                    .instance()
                    .get(&DataKey::GameHubAddress)
                    .expect("GameHub address not set");
                let game_hub = GameHubClient::new(&env, &game_hub_addr);
                game_hub.end_game(&session_id, &p1_won);
            } else {
                game.current_round += 1;
                game.phase = GamePhase::Commit;
                let empty = BytesN::from_array(&env, &EMPTY_HASH);
                game.player1_commitment = empty.clone();
                game.player2_commitment = empty;
                game.player1_choice = Choice::None;
                game.player2_choice = Choice::None;
                game.player1_committed = false;
                game.player2_committed = false;
                game.player1_revealed = false;
                game.player2_revealed = false;
            }
        }

        env.storage().temporary().set(&key, &game);
        env.storage()
            .temporary()
            .extend_ttl(&key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);

        Ok(())
    }

    fn determine_round_winner(p1: &Choice, p2: &Choice) -> u32 {
        if *p1 == *p2 {
            return 0;
        }
        match (p1, p2) {
            (Choice::Rock, Choice::Scissors)
            | (Choice::Paper, Choice::Rock)
            | (Choice::Scissors, Choice::Paper) => 1,
            _ => 2,
        }
    }

    pub fn get_game(env: Env, session_id: u32) -> Result<Game, Error> {
        let key = DataKey::Game(session_id);
        env.storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)
    }

    pub fn get_total_games(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::TotalGames)
            .unwrap_or(0)
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set")
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    pub fn get_hub(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub address not set")
    }

    pub fn set_hub(env: Env, new_hub: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::GameHubAddress, &new_hub);
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

#[cfg(test)]
mod test;
