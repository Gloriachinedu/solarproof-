# Soroban Contract Storage Optimization Report

## Overview
The `audit-registry` contract storage has been optimized to reduce ledger entry costs and footprint on the Stellar network.

## Optimization Strategies

### 1. Bucketed Storage
Previously, each meter reading hash was stored in its own persistent ledger entry. This resulted in one new ledger entry per reading, which is expensive due to the per-entry base cost.

**Optimized Layout:**
- Readings are now grouped into **1024 buckets**.
- Each bucket is a single persistent ledger entry containing a `Map<BytesN<32>, u32>` (Reading Hash -> Ledger Sequence).
- Bucket ID is derived from the first two bytes of the reading hash: `((hash[0] << 8) | hash[1]) % 1024`.

### 2. Redundant Data Removal
The `AuditAnchor` struct previously stored the `reading_hash` in the entry value. Since the hash is already the key (either in the previous individual entry or in the new bucket Map), it was redundant.

**Optimized Value:**
- Only the `anchored_at_ledger` (4 bytes) is stored as the value in the bucket Map.
- The `AuditAnchor` struct is reconstructed on-the-fly when queried.

### 3. Temporary Storage for Idempotency
Nonces used for transaction idempotency were previously stored in persistent storage.

**Optimized Storage:**
- Nonces are now stored in **Temporary storage**.
- This reduces the long-term ledger footprint as nonces only need to be unique for a short window to prevent immediate replays. Permanent replay protection is still provided by the reading hash itself in the bucketed storage.

## Cost Comparison

| Metric | Before Optimization | After Optimization | Improvement |
|--------|---------------------|--------------------|-------------|
| **Persistent Entries** | N + M (N readings, M nonces) | min(N, 1024) | ~99.9% reduction for 1M readings |
| **Temporary Entries** | 0 | M (M nonces) | Better use of cheaper storage |
| **Data Size (per reading)** | ~70 bytes + entry overhead | ~36 bytes in Map | ~50% reduction in value size |
| **Base Entry Costs** | 2 per reading | ~0.001 per reading (at scale) | High savings on base fees |

## Documentation
The contract code in `apps/contracts/audit_registry/src/lib.rs` has been updated with these changes, and all tests have been verified (fixed and extended with bucket collision tests).

## Storage Key Namespace Strategy

All contracts use typed `#[contracttype]` enum keys. Cross-contract key collisions are prevented by Soroban's contract-scoped storage model (each contract's storage is prefixed with its contract ID). See `docs/adr/008-storage-key-namespace-strategy.md` for the full audit and key inventory across all three contracts.
