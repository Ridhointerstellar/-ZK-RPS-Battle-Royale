#![cfg(test)]

use crate::{ZkRpsBattleContract, ZkRpsBattleContractClient, GamePhase};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env};

#[contract]
pub struct MockGameHub;

#[contractimpl]
impl MockGameHub {
    pub fn start_game(
        _env: Env,
        _game_id: Address,
        _session_id: u32,
        _player1: Address,
        _player2: Address,
        _player1_points: i128,
        _player2_points: i128,
    ) {
    }

    pub fn end_game(_env: Env, _session_id: u32, _player1_won: bool) {
    }

    pub fn add_game(_env: Env, _game_address: Address) {
    }
}

fn setup_test() -> (
    Env,
    ZkRpsBattleContractClient<'static>,
    Address,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 1441065600,
        protocol_version: 25,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: u32::MAX / 2,
        min_persistent_entry_ttl: u32::MAX / 2,
        max_entry_ttl: u32::MAX / 2,
    });

    let hub_addr = env.register(MockGameHub, ());
    let admin = Address::generate(&env);
    let contract_id = env.register(ZkRpsBattleContract, (&admin, &hub_addr));
    let client = ZkRpsBattleContractClient::new(&env, &contract_id);

    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);

    (env, client, player1, player2)
}

fn make_commitment(env: &Env, choice: u32, nonce: &[u8; 32]) -> BytesN<32> {
    let mut hash_input = Bytes::new(env);
    hash_input.append(&Bytes::from_array(env, &choice.to_be_bytes()));
    hash_input.append(&Bytes::from_slice(env, nonce));
    env.crypto().keccak256(&hash_input).to_bytes()
}

#[test]
fn test_start_game() {
    let (_env, client, player1, player2) = setup_test();
    let session_id = 1u32;
    let points = 100_0000000i128;

    client.start_game(&session_id, &player1, &player2, &points, &points);

    let game = client.get_game(&session_id);
    assert_eq!(game.player1, player1);
    assert_eq!(game.player2, player2);
    assert_eq!(game.current_round, 1);
    assert_eq!(game.max_rounds, 3);
    assert_eq!(game.player1_wins, 0);
    assert_eq!(game.player2_wins, 0);
    assert_eq!(game.phase, GamePhase::Commit);
    assert!(game.winner.is_none());
}

#[test]
fn test_commit_phase() {
    let (env, client, player1, player2) = setup_test();
    let session_id = 2u32;
    let points = 100_0000000i128;

    client.start_game(&session_id, &player1, &player2, &points, &points);

    let nonce1 = [1u8; 32];
    let nonce2 = [2u8; 32];
    let commit1 = make_commitment(&env, 1, &nonce1);
    let commit2 = make_commitment(&env, 2, &nonce2);

    client.commit_choice(&session_id, &player1, &commit1);

    let game = client.get_game(&session_id);
    assert!(game.player1_committed);
    assert!(!game.player2_committed);
    assert_eq!(game.phase, GamePhase::Commit);

    client.commit_choice(&session_id, &player2, &commit2);

    let game = client.get_game(&session_id);
    assert!(game.player1_committed);
    assert!(game.player2_committed);
    assert_eq!(game.phase, GamePhase::Reveal);
}

#[test]
fn test_reveal_round_rock_beats_scissors() {
    let (env, client, player1, player2) = setup_test();
    let session_id = 3u32;
    let points = 100_0000000i128;

    client.start_game(&session_id, &player1, &player2, &points, &points);

    let nonce1 = [1u8; 32];
    let nonce2 = [2u8; 32];
    let commit1 = make_commitment(&env, 1, &nonce1);
    let commit2 = make_commitment(&env, 3, &nonce2);

    client.commit_choice(&session_id, &player1, &commit1);
    client.commit_choice(&session_id, &player2, &commit2);

    let nonce1_bn = BytesN::from_array(&env, &nonce1);
    let nonce2_bn = BytesN::from_array(&env, &nonce2);

    client.reveal_choice(&session_id, &player1, &1u32, &nonce1_bn);
    client.reveal_choice(&session_id, &player2, &3u32, &nonce2_bn);

    let game = client.get_game(&session_id);
    assert_eq!(game.player1_wins, 1);
    assert_eq!(game.player2_wins, 0);
    assert_eq!(game.current_round, 2);
    assert_eq!(game.phase, GamePhase::Commit);
}

#[test]
fn test_full_game_player1_wins() {
    let (env, client, player1, player2) = setup_test();
    let session_id = 4u32;
    let points = 100_0000000i128;

    client.start_game(&session_id, &player1, &player2, &points, &points);

    let nonce_a = [10u8; 32];
    let nonce_b = [20u8; 32];
    let commit_a = make_commitment(&env, 1, &nonce_a);
    let commit_b = make_commitment(&env, 3, &nonce_b);

    client.commit_choice(&session_id, &player1, &commit_a);
    client.commit_choice(&session_id, &player2, &commit_b);
    client.reveal_choice(&session_id, &player1, &1u32, &BytesN::from_array(&env, &nonce_a));
    client.reveal_choice(&session_id, &player2, &3u32, &BytesN::from_array(&env, &nonce_b));

    let game = client.get_game(&session_id);
    assert_eq!(game.player1_wins, 1);
    assert_eq!(game.current_round, 2);

    let nonce_c = [30u8; 32];
    let nonce_d = [40u8; 32];
    let commit_c = make_commitment(&env, 2, &nonce_c);
    let commit_d = make_commitment(&env, 1, &nonce_d);

    client.commit_choice(&session_id, &player1, &commit_c);
    client.commit_choice(&session_id, &player2, &commit_d);
    client.reveal_choice(&session_id, &player1, &2u32, &BytesN::from_array(&env, &nonce_c));
    client.reveal_choice(&session_id, &player2, &1u32, &BytesN::from_array(&env, &nonce_d));

    let game = client.get_game(&session_id);
    assert_eq!(game.player1_wins, 2);
    assert_eq!(game.phase, GamePhase::GameEnd);
    assert!(game.winner.is_some());
    assert_eq!(game.winner.unwrap(), player1);
}

#[test]
fn test_commitment_mismatch_fails() {
    let (env, client, player1, player2) = setup_test();
    let session_id = 5u32;
    let points = 100_0000000i128;

    client.start_game(&session_id, &player1, &player2, &points, &points);

    let nonce1 = [1u8; 32];
    let nonce2 = [2u8; 32];
    let commit1 = make_commitment(&env, 1, &nonce1);
    let commit2 = make_commitment(&env, 2, &nonce2);

    client.commit_choice(&session_id, &player1, &commit1);
    client.commit_choice(&session_id, &player2, &commit2);

    let wrong_nonce = BytesN::from_array(&env, &[99u8; 32]);
    let result = client.try_reveal_choice(&session_id, &player1, &1u32, &wrong_nonce);
    assert!(result.is_err());
}

#[test]
fn test_cannot_commit_twice() {
    let (env, client, player1, player2) = setup_test();
    let session_id = 6u32;
    let points = 100_0000000i128;

    client.start_game(&session_id, &player1, &player2, &points, &points);

    let nonce1 = [1u8; 32];
    let commit1 = make_commitment(&env, 1, &nonce1);

    client.commit_choice(&session_id, &player1, &commit1);

    let result = client.try_commit_choice(&session_id, &player1, &commit1);
    assert!(result.is_err());
}

#[test]
fn test_total_games_counter() {
    let (_env, client, player1, player2) = setup_test();
    let points = 100_0000000i128;

    assert_eq!(client.get_total_games(), 0);

    client.start_game(&1u32, &player1, &player2, &points, &points);
    assert_eq!(client.get_total_games(), 1);
}
