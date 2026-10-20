//! Property-based tests for energy_token arithmetic — issue #49.
//!
//! Properties covered:
//!   P-MINT:     mint increases recipient balance by exactly `amount`
//!   P-BURN:     burn decreases balance by exactly `amount`
//!   P-SUPPLY:   transfer conserves total supply
//!   P-OVERFLOW: overflow impossible for valid (non-overflowing) inputs
//!   P-ALLOW:    allowance is reduced exactly by the transferred amount
//!
//! Run with:
//!   cargo test --manifest-path apps/contracts/proptest/Cargo.toml
//!
//! Each property runs a minimum of 500 cases (PROPTEST_CASES env var or
//! ProptestConfig override below).

use energy_token::{EnergyToken, EnergyTokenClient};
use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

fn setup() -> (Env, EnergyTokenClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(EnergyToken, ());
    let client = EnergyTokenClient::new(&env, &id);
    let admin = Address::generate(&env);
    let minter = Address::generate(&env);
    client.initialize(&admin, &minter);
    (env, client)
}

proptest! {
    // Run at least 500 cases per property.
    #![proptest_config(ProptestConfig::with_cases(500))]

    // ── P-MINT: mint increases balance exactly by amount ─────────────────────

    /// mint(to, amount) => balance(to) increases by exactly `amount`.
    #[test]
    fn prop_mint_increases_balance_exactly(amount in 1_i128..=i128::MAX / 2) {
        let (env, client) = setup();
        let recipient = Address::generate(&env);
        let before = client.balance(&recipient);
        client.mint(&recipient, &amount);
        let after = client.balance(&recipient);
        prop_assert_eq!(after - before, amount,
            "balance delta must equal minted amount");
    }

    /// Minting to the same recipient twice accumulates correctly.
    #[test]
    fn prop_mint_twice_accumulates(
        a in 1_i128..=i128::MAX / 4,
        b in 1_i128..=i128::MAX / 4,
    ) {
        let (env, client) = setup();
        let recipient = Address::generate(&env);
        client.mint(&recipient, &a);
        client.mint(&recipient, &b);
        prop_assert_eq!(client.balance(&recipient), a + b);
    }

    // ── P-BURN: burn decreases balance exactly by amount ─────────────────────

    /// burn(from, amount) where amount <= balance => balance decreases by exactly `amount`.
    #[test]
    fn prop_burn_decreases_balance_exactly(
        mint_amount in 1_i128..=1_000_000_i128,
        burn_fraction in 0.01_f64..=1.0_f64,
    ) {
        let (env, client) = setup();
        let holder = Address::generate(&env);
        client.mint(&holder, &mint_amount);

        let burn_amount = ((mint_amount as f64) * burn_fraction).max(1.0) as i128;
        let burn_amount = burn_amount.min(mint_amount);

        let before = client.balance(&holder);
        client.burn(&holder, &burn_amount);
        let after = client.balance(&holder);
        prop_assert_eq!(before - after, burn_amount,
            "balance must decrease by exactly burn_amount");
    }

    /// total_supply decreases by exactly burn_amount.
    #[test]
    fn prop_burn_reduces_total_supply(
        mint_amount in 1_i128..=1_000_000_i128,
        burn_fraction in 0.01_f64..=1.0_f64,
    ) {
        let (env, client) = setup();
        let holder = Address::generate(&env);
        client.mint(&holder, &mint_amount);

        let burn_amount = ((mint_amount as f64) * burn_fraction).max(1.0) as i128;
        let burn_amount = burn_amount.min(mint_amount);

        let supply_before = client.total_supply();
        client.burn(&holder, &burn_amount);
        let supply_after = client.total_supply();
        prop_assert_eq!(supply_before - supply_after, burn_amount,
            "total_supply must decrease by exactly burn_amount");
    }

    // ── P-SUPPLY: transfer conserves total supply ────────────────────────────

    /// transfer(from, to, amount) does not change total_supply.
    #[test]
    fn prop_transfer_conserves_total_supply(amount in 1_i128..=1_000_000_i128) {
        let (env, client) = setup();
        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        client.mint(&sender, &amount);

        let supply_before = client.total_supply();
        client.transfer(&sender, &receiver, &amount);
        let supply_after = client.total_supply();
        prop_assert_eq!(supply_before, supply_after,
            "transfer must not change total_supply");
    }

    /// sum of sender + receiver balances is conserved after transfer.
    #[test]
    fn prop_transfer_conserves_sum_of_balances(
        mint_amount in 1_i128..=1_000_000_i128,
        transfer_fraction in 0.01_f64..=1.0_f64,
    ) {
        let (env, client) = setup();
        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        client.mint(&sender, &mint_amount);

        let transfer_amount = ((mint_amount as f64) * transfer_fraction).max(1.0) as i128;
        let transfer_amount = transfer_amount.min(mint_amount);

        let sum_before = client.balance(&sender) + client.balance(&receiver);
        client.transfer(&sender, &receiver, &transfer_amount);
        let sum_after = client.balance(&sender) + client.balance(&receiver);
        prop_assert_eq!(sum_before, sum_after,
            "sum of sender and receiver balances must be conserved");
    }

    // ── P-OVERFLOW: overflow impossible for valid inputs ─────────────────────

    /// checked_add ensures no silent overflow; amounts up to MAX/2 are safe.
    #[test]
    fn prop_mint_no_overflow_for_valid_amounts(
        a in 1_i128..=i128::MAX / 2,
        b in 1_i128..=i128::MAX / 2,
    ) {
        let (env, client) = setup();
        let recipient = Address::generate(&env);
        // Both mints should succeed without overflow.
        client.mint(&recipient, &a);
        client.mint(&recipient, &b);
        let balance = client.balance(&recipient);
        prop_assert_eq!(balance, a + b,
            "two valid mints must not overflow");
        prop_assert!(balance > 0, "balance must remain positive");
    }

    // ── P-ALLOW: allowance reduced exactly by transfer_from amount ───────────

    /// allowance(from, spender) decreases by exactly `amount` after transfer_from.
    #[test]
    fn prop_transfer_from_reduces_allowance_exactly(
        mint_amount in 1_i128..=1_000_000_i128,
        allowance_extra in 0_i128..=1_000_000_i128,
        transfer_fraction in 0.01_f64..=1.0_f64,
    ) {
        let (env, client) = setup();
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let recipient = Address::generate(&env);

        client.mint(&owner, &mint_amount);

        let transfer_amount = ((mint_amount as f64) * transfer_fraction).max(1.0) as i128;
        let transfer_amount = transfer_amount.min(mint_amount);
        let allowance = transfer_amount + allowance_extra;

        client.approve(&owner, &spender, &allowance, &1_000_000_u32);
        let allow_before = client.allowance(&owner, &spender);
        client.transfer_from(&spender, &owner, &recipient, &transfer_amount);
        let allow_after = client.allowance(&owner, &spender);

        prop_assert_eq!(allow_before - allow_after, transfer_amount,
            "allowance must decrease by exactly transfer_amount");
    }
}
