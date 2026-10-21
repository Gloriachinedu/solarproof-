# SolarProof — Security Audit Scope

## Overview

SolarProof is an end-to-end cryptographic proof system for renewable energy generation. This document defines the scope for a third-party security audit prior to mainnet deployment.

## Contracts in scope

| Contract | File | Lines |
|---|---|---|
| `energy_token` | `apps/contracts/energy_token/src/lib.rs` | ~280 |
| `audit_registry` | `apps/contracts/audit_registry/src/lib.rs` | ~215 |
| `community_governance` | `apps/contracts/community_governance/src/lib.rs` | ~270 |

All contracts are written in Rust targeting the Soroban SDK 23.1.0 on Stellar.

## Out of scope

- `apps/web/` — Next.js frontend and API routes
- `packages/stellar/` — TypeScript utilities
- `scripts/` — meter simulation scripts
- Third-party dependencies (Soroban SDK, OpenZeppelin Stellar)

## Focus areas

### `energy_token`
- Minting access control: only the designated `minter` address can call `mint()`
- Role rotation: `set_minter()` requires `admin` auth; verify no privilege escalation path
- Supply invariant: `total_supply == total_minted - total_burned` at all times
- Overflow: `i128` arithmetic on `TotalMinted`/`TotalBurned` under extreme values
- Persistent storage TTL: balance entries may expire; assess impact

### `audit_registry`
- Immutability: once anchored, a hash must not be overwritable
- Duplicate prevention: `anchor()` must reject re-anchoring the same hash
- Access control: `anchor()` is currently permissionless — assess whether caller restriction is needed before mainnet
- Counter overflow: `TotalAnchors` is `u32`; assess wrap-around risk at scale

### `community_governance`
- Double-vote prevention: each address must vote at most once per proposal
- Quorum arithmetic: integer division in `yes_votes * 100 / total` — check rounding edge cases
- Proposal map growth: all proposals stored in a single instance-storage `Map`; assess size limits
- Finalization timing: verify `end_ledger` boundary conditions (off-by-one)
- Status immutability: a finalized proposal must not be re-finalized

## Known issues to verify are resolved

| Issue | Contract | Status |
|---|---|---|
| Full payload stored on-chain (cost) | `audit_registry` | Resolved in #59 |
| No env var validation | API | Resolved in #79 |
| Secrets in committed files | CI/repo | Resolved in #85 |

## Internal audit remediation status

The internal audit (`docs/security/SECURITY_AUDIT_REPORT.md`) identified 13 findings. All HIGH-severity findings have been remediated prior to this third-party engagement; the remediation details and verification notes are recorded in the updated `SECURITY_AUDIT_REPORT.md`. Auditors should independently verify each HIGH finding is closed, and may review the remaining Medium/Low/Informational findings at their discretion.

## Audit logistics

| Item | Value |
|---|---|
| Audit firm | _TBD — to be filled upon engagement_ |
| Engagement date | _TBD_ |
| Audit window | _TBD_ (target: 3–4 weeks from kickoff) |
| Re-audit window | _TBD_ (target: 1–2 weeks after fixes) |
| Point of contact | _TBD_ |

### Timeline

1. **Kickoff** — scope walkthrough and access to repository, tests, and internal audit report
2. **Audit period** — review of all three contracts per the focus areas above
3. **Draft findings** — preliminary report shared with the team
4. **Remediation** — team addresses Critical/High findings
5. **Re-audit** — auditor verifies fixes for Critical/High findings
6. **Final report** — published in `docs/audits/`

### Expected deliverables

1. Findings report (Critical / High / Medium / Low / Informational)
2. Recommendations for each finding
3. Re-audit of any Critical/High fixes
4. Final published report committed to `docs/audits/`

## Test coverage

All contracts have unit tests covering:
- Happy path (anchor, mint, vote/pass)
- Duplicate rejection
- Insufficient balance / overdraft
- Double-vote rejection
- Finalization before period ends
- Double-initialize rejection

Run with: `cd apps/contracts && cargo test --all`

## Audit deliverables requested

1. Findings report (Critical / High / Medium / Low / Informational)
2. Recommendations for each finding
3. Re-audit of any Critical/High fixes
