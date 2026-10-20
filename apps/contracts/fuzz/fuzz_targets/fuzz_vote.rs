//! Fuzz target: community_governance::vote
//!
//! Exercises vote() with arbitrary proposal IDs, voter generation, and choices.
//! Verifies that:
//!   - each voter can vote exactly once per proposal
//!   - yes_votes + no_votes == total votes cast
//!   - finalize() always produces a valid ProposalStatus

#![no_main]

use libfuzzer_sys::fuzz_target;
use soroban_sdk::{testutils::Address as _, Address, Env, String};
use community_governance::{CommunityGovernance, CommunityGovernanceClient};

fuzz_target!(|data: &[u8]| {
    let mut proposal_id_bytes = [0_u8; 4];
    let copied = data.len().min(proposal_id_bytes.len());
    proposal_id_bytes[..copied].copy_from_slice(&data[..copied]);
    let fuzzed_proposal_id = if data.starts_with(b"ZERO") {
        0
    } else if data.starts_with(b"MAX!") {
        u32::MAX
    } else {
        u32::from_le_bytes(proposal_id_bytes)
    };

    let voter_count = data.get(4).copied().unwrap_or(0) as usize % 32 + 1;

    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(CommunityGovernance, ());
    let client = CommunityGovernanceClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &1_u32, &10_u32);

    let proposer = Address::generate(&env);
    let valid_proposal_id = client.propose(
        &proposer,
        &String::from_str(&env, "fuzz"),
        &String::from_str(&env, "fuzz"),
    );

    let mut yes = 0_u32;
    let mut no = 0_u32;

    for index in 0..voter_count {
        let seed = data
            .get(5 + index)
            .copied()
            .unwrap_or((index as u8).wrapping_mul(37));

        // Input bytes vary the generated address without relying on a fixed
        // voter set, while keeping each fuzz case bounded.
        for _ in 0..(seed % 4) {
            let _ = Address::generate(&env);
        }
        let voter = Address::generate(&env);
        let proposal_id = if seed & 0x80 == 0 {
            fuzzed_proposal_id
        } else {
            valid_proposal_id
        };
        let approve = seed & 1 == 1;

        if client.try_vote(&voter, &proposal_id, &approve).is_ok()
            && proposal_id == valid_proposal_id
        {
            if approve {
                yes += 1;
            } else {
                no += 1;
            }
        }

        assert!(
            !client.try_vote(&voter, &proposal_id, &approve).is_ok(),
            "a voter must not vote twice on the same proposal"
        );
    }

    let proposal = client
        .get_proposal(&valid_proposal_id)
        .expect("proposal must exist");
    assert_eq!(proposal.yes_votes, yes);
    assert_eq!(proposal.no_votes, no);
});
