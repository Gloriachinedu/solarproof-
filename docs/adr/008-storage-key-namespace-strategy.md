# ADR-008: Storage Key Namespace Strategy

**Status:** Proposed  
**Date:** 2026-10-20  
**Issue:** #48

---

## Context

Three Soroban contracts share the same ledger but each maintain their own
storage keys. If two contracts happen to use the same raw key value, a contract
could theoretically read or overwrite state that belongs to another — a key
collision. This ADR documents the key namespace strategy across all contracts
and confirms no cross-contract collisions are possible given Soroban's storage
isolation model.

## Decision

### Soroban Storage Isolation

Soroban contracts are natively isolated: each contract has its own storage
namespace scoped to its contract ID. A key `DataKey::Admin` in `audit_registry`
and a key `DataKey::Admin` in `energy_token` occupy completely separate ledger
entries — the runtime prefixes every key with the contract ID before writing to
the ledger. Cross-contract key collisions are therefore **impossible by
construction** at the ledger level.

### Per-Contract Key Inventory

#### `audit_registry`

| Key | Storage type | Value type | Notes |
|-----|-------------|------------|-------|
| `DataKey::Admin` | instance | `Address` | Contract administrator |
| `DataKey::ApiSigner` | instance | `Address` | Only address allowed to call `anchor()` |
| `DataKey::TotalAnchors` | instance | `u32` | Monotonically increasing counter |
| `DataKey::Version` | instance | `String` | Contract version string |
| `DataKey::Bucket(u32)` | persistent | `Map<BytesN<32>, u32>` | Bucketed anchor store (0–1023) |
| `DataKey::Nonce(BytesN<32>)` | temporary | `bool` | Replay-prevention nonce |

#### `energy_token`

| Key | Storage type | Value type | Notes |
|-----|-------------|------------|-------|
| `DataKey::Admin` | instance | `Address` | Token administrator |
| `DataKey::Minter` | instance | `Address` | Only address allowed to call `mint()` |
| `DataKey::TotalMinted` | instance | `i128` | Cumulative minted amount |
| `DataKey::TotalBurned` | instance | `i128` | Cumulative burned amount |
| `DataKey::Paused` | instance | `bool` | Global pause flag |
| `DataKey::Allowance(Address, Address)` | persistent | `i128` | Spender allowances |
| `DataKey::Retired(Address)` | persistent | `bool` | Retired address flag |
| `(symbol_short!("balance"), Address)` | persistent | `i128` | Per-address token balance |

#### `community_governance`

| Key | Storage type | Value type | Notes |
|-----|-------------|------------|-------|
| `DataKey::Admin` | instance | `Address` | Contract administrator |
| `DataKey::ProposalCount` | instance | `u32` | Total proposals created |
| `DataKey::Proposals` | instance | `Map<u32, Proposal>` | All proposals |
| `DataKey::Quorum` | instance | *(legacy)* | Superseded by `QuorumBps` |
| `DataKey::VotingPeriod` | instance | `u32` | Voting window in ledgers |
| `DataKey::VoterCount` | instance | `u32` | Total registered voters |
| `DataKey::VoterIndex(Address)` | instance | `u32` | Voter → stable bitmap index |
| `DataKey::VoteLock` | instance | `bool` | Reentrancy guard for `vote()` |
| `DataKey::QuorumBps` | instance | `u32` | Quorum threshold (basis points) |
| `DataKey::ThresholdBps` | instance | `u32` | Approval threshold (basis points) |
| `DataKey::PendingUpgrade` | instance | `UpgradeProposal` | Queued WASM upgrade |
| `DataKey::Version` | instance | `String` | Contract version string |
| `DataKey::ExecuteTimelock` | instance | `u32` | Execution cooldown in ledgers |
| `(symbol_short!("bitmap"), u32, u32)` | persistent | `u128` | Voter bitmap words |

### Key Design Follows Soroban Best Practices

All three contracts use typed `#[contracttype]` enums as storage keys. This:

1. Encodes the variant discriminant into the XDR key, preventing accidental
   overlap between different key *types* within the same contract.
2. Enables the Soroban SDK to generate correct XDR serialisation automatically.
3. Makes the key space self-documenting and easy to audit.

### No Within-Contract Collisions

Each `DataKey` enum uses distinct variant names. The tuple keys in
`energy_token` (`(symbol_short!("balance"), address)`) and
`community_governance` (`(symbol_short!("bitmap"), proposal_id, word_index)`)
use short symbol prefixes that are unique within their contract.

## Consequences

- No action required to prevent collisions — Soroban's contract-scoped storage
  already prevents cross-contract collisions.
- Future contracts should continue to use `#[contracttype]` enum keys.
- The `(symbol, ...)` tuple pattern used in `energy_token` and
  `community_governance` is acceptable but less type-safe than enum variants;
  future refactors may migrate these to proper `DataKey` enum variants.

## References

- [Soroban Storage docs](https://developers.stellar.org/docs/build/smart-contracts/storage)
- `docs/contracts/storage_optimization.md`
- Issue #48
