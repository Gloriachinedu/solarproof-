//! Fuzz target: audit_registry::anchor
//!
//! Exercises anchor() with arbitrary 32-byte hashes and 32-byte nonces.
//! Verifies that:
//!   - any (hash, nonce) pair can be anchored exactly once
//!   - re-anchoring the same hash (different nonce) returns AlreadyAnchored
//!   - re-using the same nonce (different hash) returns AlreadyAnchored
//!   - total_anchors is monotonically increasing
//!   - no panics occur on any valid (hash, nonce) pair

#![no_main]

use libfuzzer_sys::fuzz_target;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};
use audit_registry::{AuditRegistry, AuditRegistryClient, Error};

fuzz_target!(|data: &[u8]| {
    let mut hash_bytes = [0_u8; 32];
    let mut nonce_bytes = [0_u8; 32];
    for (index, byte) in data.iter().enumerate() {
        if index % 2 == 0 {
            hash_bytes[(index / 2) % 32] ^= *byte;
        } else {
            nonce_bytes[(index / 2) % 32] ^= *byte;
        }
    }

    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(AuditRegistry, ());
    let client = AuditRegistryClient::new(&env, &id);
    let admin = Address::generate(&env);
    let api_signer = Address::generate(&env);
    client.initialize(&admin, &api_signer);

    let hash = BytesN::from_array(&env, &hash_bytes);
    let nonce = BytesN::from_array(&env, &nonce_bytes);

    // ── First anchor must succeed ────────────────────────────────────────────
    let result = client.anchor(&api_signer, &hash, &nonce);
    assert_eq!(result, Ok(()), "first anchor should succeed for any valid (hash, nonce)");
    assert!(client.is_anchored(&hash), "hash must be anchored after first anchor");
    assert_eq!(client.total_anchors(), 1, "total_anchors must be 1 after first anchor");

    // Verify stored anchor matches input
    let stored = client.verify(&hash).expect("anchor should be retrievable after first anchor");
    assert_eq!(stored.reading_hash, hash, "stored hash must equal the input hash");

    // ── Duplicate nonce (same nonce, any hash) must return AlreadyAnchored ───
    // Construct a distinct hash by flipping the last byte of the original.
    let mut alt_hash_bytes = hash_bytes;
    alt_hash_bytes[31] = alt_hash_bytes[31].wrapping_add(1);
    let alt_hash = BytesN::from_array(&env, &alt_hash_bytes);

    let dup_nonce = client.anchor(&api_signer, &alt_hash, &nonce);
    assert_eq!(
        dup_nonce,
        Err(Error::AlreadyAnchored),
        "duplicate nonce must return AlreadyAnchored"
    );
    assert_eq!(
        client.total_anchors(), 1,
        "count must not increment when nonce is reused"
    );

    // ── Duplicate hash (same hash, fresh nonce) must return AlreadyAnchored ──
    let mut fresh_nonce_bytes = nonce_bytes;
    fresh_nonce_bytes[31] = fresh_nonce_bytes[31].wrapping_add(1);
    let fresh_nonce = BytesN::from_array(&env, &fresh_nonce_bytes);

    let dup_hash = client.anchor(&api_signer, &hash, &fresh_nonce);
    assert_eq!(
        dup_hash,
        Err(Error::AlreadyAnchored),
        "duplicate hash must return AlreadyAnchored even with a fresh nonce"
    );
    assert_eq!(
        client.total_anchors(), 1,
        "count must not increment when hash is duplicated"
    );

    // ── A completely distinct (hash, nonce) pair must succeed ────────────────
    // Only do this when we have bytes that produce a genuinely different alt hash.
    if alt_hash_bytes != hash_bytes {
        let result2 = client.anchor(&api_signer, &alt_hash, &fresh_nonce);
        assert_eq!(result2, Ok(()), "second anchor with distinct hash and nonce should succeed");
        assert_eq!(client.total_anchors(), 2, "total_anchors must be 2 after second anchor");
    }
});
