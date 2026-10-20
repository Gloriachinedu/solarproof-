//! Property-based tests for SolarProof contracts — issue #121.
//!
//! Properties tested:
//!   P1. mint amount is always positive (contract rejects ≤ 0)
//!   P2. balance never goes negative after any sequence of mints/burns
//!   P3. vote count is monotonically non-decreasing (yes + no only increases)
//!
//! Run with:
//!   cargo test --manifest-path apps/contracts/proptest/Cargo.toml
//!
//! Failures produce minimal reproducible examples via proptest's shrinking.

use energy_token::{EnergyToken, EnergyTokenClient};
use community_governance::{CommunityGovernance, CommunityGovernanceClient};
use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

mod energy_token_props;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn setup_token() -> (Env, EnergyTokenClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(EnergyToken, ());
    let client = EnergyTokenClient::new(&env, &id);
    let admin = Address::generate(&env);
    let minter = Address::generate(&env);
    client.initialize(&admin, &minter);
    (env, client)
}

fn setup_governance() -> (Env, CommunityGovernanceClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(CommunityGovernance, ());
    let client = CommunityGovernanceClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &100_u32, &100_u32);
    (env, client)
}

// ---------------------------------------------------------------------------
// P1: mint amount always positive — contract rejects amount ≤ 0
// ---------------------------------------------------------------------------

proptest! {
    /// Any non-positive mint amount must be rejected by the contract.
    #[test]
    fn prop_mint_amount_must_be_positive(amount in i128::MIN..=0_i128) {
        let (env, client) = setup_token();
        let recipient = Address::generate(&env);
        // The contract panics for amount <= 0; catch_unwind is not available
        // in no_std, but the Soroban test harness surfaces panics as Err.
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.mint(&recipient, &amount);
        }));
        prop_assert!(result.is_err(), "mint({amount}) should have panicked");
    }
}

proptest! {
    /// Any positive mint amount must succeed and increase the recipient's balance.
    #[test]
    fn prop_mint_positive_amount_increases_balance(amount in 1_i128..=i128::MAX / 2) {
        let (env, client) = setup_token();
        let recipient = Address::generate(&env);
        let before = client.balance(&recipient);
        client.mint(&recipient, &amount);
        let after = client.balance(&recipient);
        prop_assert_eq!(after, before + amount);
        prop_assert!(after > 0, "balance must be positive after mint");
    }
}

// ---------------------------------------------------------------------------
// P2: balance never negative after mint + partial burn sequence
// ---------------------------------------------------------------------------

proptest! {
    /// After minting `mint_amount` and burning `burn_amount ≤ mint_amount`,
    /// the balance must remain ≥ 0.
    #[test]
    fn prop_balance_never_negative(
        mint_amount in 1_i128..=1_000_000_i128,
        burn_fraction in 0.0_f64..=1.0_f64,
    ) {
        let (env, client) = setup_token();
        let holder = Address::generate(&env);

        client.mint(&holder, &mint_amount);

        // burn at most what was minted
        let burn_amount = ((mint_amount as f64) * burn_fraction) as i128;
        if burn_amount > 0 {
            client.burn(&holder, &burn_amount);
        }

        let balance = client.balance(&holder);
        prop_assert!(balance >= 0, "balance must never be negative, got {balance}");
    }
}

proptest! {
    /// Burning more than the balance must be rejected (balance stays non-negative).
    #[test]
    fn prop_burn_exceeding_balance_rejected(
        mint_amount in 1_i128..=1_000_000_i128,
        excess in 1_i128..=1_000_000_i128,
    ) {
        let (env, client) = setup_token();
        let holder = Address::generate(&env);
        client.mint(&holder, &mint_amount);

        let over_burn = mint_amount + excess;
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.burn(&holder, &over_burn);
        }));
        prop_assert!(result.is_err(), "burning more than balance should panic");

        // Balance must still be non-negative
        let balance = client.balance(&holder);
        prop_assert!(balance >= 0);
    }
}

// ---------------------------------------------------------------------------
// P3: vote count monotonically non-decreasing
// ---------------------------------------------------------------------------

proptest! {
    /// After casting `n` yes votes and `m` no votes, yes+no == n+m and
    /// neither count ever decreases between successive votes.
    #[test]
    fn prop_vote_count_monotonic(
        yes_votes in 0_u32..=20_u32,
        no_votes in 0_u32..=20_u32,
    ) {
        // Need at least one vote to test monotonicity
        prop_assume!(yes_votes + no_votes > 0);

        let (env, client) = setup_governance();
        let proposer = Address::generate(&env);
        let id = client.propose(
            &proposer,
            &soroban_sdk::String::from_str(&env, "P"),
            &soroban_sdk::String::from_str(&env, "D"),
        );

        let mut prev_yes = 0_u32;
        let mut prev_no = 0_u32;

        for _ in 0..yes_votes {
            client.vote(&Address::generate(&env), &id, &true);
            let p = client.get_proposal(&id).unwrap();
            prop_assert!(p.yes_votes >= prev_yes, "yes_votes must not decrease");
            prev_yes = p.yes_votes;
        }

        for _ in 0..no_votes {
            client.vote(&Address::generate(&env), &id, &false);
            let p = client.get_proposal(&id).unwrap();
            prop_assert!(p.no_votes >= prev_no, "no_votes must not decrease");
            prev_no = p.no_votes;
        }

        let final_p = client.get_proposal(&id).unwrap();
        prop_assert_eq!(final_p.yes_votes, yes_votes);
        prop_assert_eq!(final_p.no_votes, no_votes);
        prop_assert_eq!(
            final_p.yes_votes + final_p.no_votes,
            yes_votes + no_votes,
            "total vote count must equal number of votes cast"
        );
    }
}
