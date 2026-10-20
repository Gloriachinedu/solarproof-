# Issue #46 — Enforce quorum and proposal expiry in community_governance

## Summary

Governance proposals currently sit open indefinitely. This issue enforces:

1. **`expires_at`** — a `u64` ledger-sequence field on `Proposal` after which
   voting is closed and the proposal cannot be executed.
2. **Quorum enforcement in `execute_proposal`** — execution requires quorum met
   and proposal not expired.
3. **`close_expired_proposal`** — callable by any member to close a proposal
   whose `expires_at` has passed.

## Planned changes

### `apps/contracts/community_governance/src/lib.rs`

- Add `expires_at: u64` field to `Proposal` struct (set at `propose()` time
  based on `VotingPeriod`).
- `vote()`: panic `"proposal expired"` if `env.ledger().sequence() > expires_at`.
- `execute()`: check `expires_at` not passed and quorum met; return error otherwise.
- Add `close_expired_proposal(proposal_id: u32)` — any caller, no auth required;
  sets status to `Expired` if `env.ledger().sequence() > expires_at`.

### `docs/governance_tuning_guide.md`

- Add section on proposal TTL and expiry mechanics.

## Acceptance criteria

- [ ] `Proposal` struct includes `expires_at: u64`
- [ ] `execute_proposal` checks quorum met + not expired
- [ ] Expired proposals cannot receive new votes
- [ ] `close_expired_proposal` callable by any member
- [ ] Governance tuning guide updated

## References

Closes #46
