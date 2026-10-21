# SolarProof — Formal Security Audit Report

**Version:** 1.0  
**Audit date:** 2026-06-26  
**Prepared by:** SolarProof Security Review (internal pre-mainnet audit)  
**Status:** Final  
**Codebase commit:** `feat/599-security-audit`

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Methodology](#2-methodology)
3. [Scope](#3-scope)
4. [Findings](#4-findings)
   - [Critical](#critical)
   - [High](#high)
   - [Medium](#medium)
   - [Low](#low)
   - [Informational](#informational)
5. [Recommendations Summary](#5-recommendations-summary)
6. [Resolved Issues (Prior Art)](#6-resolved-issues-prior-art)
7. [Test Coverage Assessment](#7-test-coverage-assessment)
8. [Conclusion](#8-conclusion)

---

## 1. Executive Summary

SolarProof is an end-to-end cryptographic proof system for renewable energy generation. It connects Ed25519-signed physical meter readings to on-chain Soroban certificates on Stellar, providing a publicly verifiable chain of custody from meter hardware to energy certificate.

This audit covered three Soroban smart contracts (`energy_token`, `audit_registry`, `community_governance`) and the Next.js API layer, against a codebase targeting Soroban SDK 23.1.0 and OpenZeppelin Stellar v0.5.1.

**Overall risk posture:** Medium-Low for the contract layer; Medium for the API/infrastructure layer. No critical vulnerabilities were found in the contracts as reviewed. The primary outstanding risks are operational (TTL management, minter key custody) and governance-related (Sybil resistance), both of which are known and tracked.

**Finding summary:**

| Severity     | Count |
|--------------|-------|
| Critical     | 0     |
| High         | 2     |
| Medium       | 4     |
| Low          | 3     |
| Informational| 4     |
| **Total**    | **13**|

---

## 2. Methodology

The audit used the following techniques:

- **Manual code review** of all Rust contract source files and TypeScript API routes
- **STRIDE threat modelling** (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege), cross-referenced against `docs/THREAT_MODEL.md`
- **Static analysis** — review of integer arithmetic, access control patterns, and storage key design
- **Test suite review** — assessment of unit test coverage including boundary values, auth bypass, and overflow cases
- **Protocol analysis** — review of the Ed25519 signing protocol specification (`docs/ED25519_PROTOCOL.md`) and canonical hash construction
- **Dependency review** — review of key npm dependencies (`@noble/ed25519`, `zod`, `@supabase/supabase-js`) and Cargo dependencies (Soroban SDK, OpenZeppelin Stellar)

The audit did **not** include:
- Formal verification or symbolic execution
- Fuzzing beyond reviewing the existing fuzz targets (`fuzz_mint.rs`, `fuzz_anchor.rs`, `fuzz_vote.rs`)
- Penetration testing of deployed infrastructure (Vercel, Supabase)
- Review of Stellar validator or consensus-layer security

---

## 3. Scope

### In scope

| Component | Location | Description |
|-----------|----------|-------------|
| `energy_token` contract | `apps/contracts/energy_token/src/lib.rs` | SEP-41 certificate token (~280 lines) |
| `audit_registry` contract | `apps/contracts/audit_registry/src/lib.rs` | Immutable reading anchor (~215 lines) |
| `community_governance` contract | `apps/contracts/community_governance/src/lib.rs` | Governance voting (~270 lines) |
| `multisig_admin` contract | `apps/contracts/multisig_admin/src/lib.rs` | 2-of-3 admin multisig (~200 lines) |
| Next.js API routes | `apps/web/src/app/api/` | All API route handlers |
| Ed25519 signing protocol | `docs/ED25519_PROTOCOL.md` | Canonical hash spec |
| Shared Stellar utilities | `packages/stellar/` | TypeScript utilities |

### Out of scope

- Third-party infrastructure (Vercel hosting, Supabase cloud, Stellar validators)
- Browser/frontend code beyond API route handlers
- npm/cargo supply-chain security beyond known-maintained packages
- Hardware meter firmware

---

## 4. Findings

### Critical

No critical findings were identified.

---

### High

#### H-01 — Persistent Storage TTL Not Managed: Anchors and Balances May Expire

**Contracts affected:** `energy_token`, `audit_registry`, `community_governance`  
**Location:** All persistent storage writes throughout contract source files  
**STRIDE category:** Tampering / Availability

**Description:**  
Soroban persistent storage entries have a finite time-to-live (TTL) measured in ledgers. If the TTL of a storage entry is not extended before the entry's live-until ledger, the entry is silently dropped by the host. None of the three contracts currently implement TTL extension (bump) logic.

In practice this means:
- `audit_registry`: anchored reading hashes expire. A previously valid certificate would fail on-chain verification.
- `energy_token`: token balances and allowances stored as persistent entries expire. A holder could lose their balance with no transaction.
- `community_governance`: bitmap words tracking voted status expire, allowing voters to vote again after TTL expiry.

This issue does not affect Stellar Testnet significantly due to shorter ledger cycles and lower activity, but is a **blocking issue before mainnet deployment**.

**Recommendation:**  
Implement TTL bump calls after each persistent write, or as a dedicated `extend_ttl(reading_hash)` / `extend_balance_ttl(account)` function callable by any party. Soroban's `env.storage().persistent().extend_ttl(key, threshold, extend_to)` should be called at anchor/mint time and periodically thereafter. Target a `extend_to` value of at least 3,110,400 ledgers (~1 year at 10 s/ledger).

**Status:** ✅ **Resolved** — TTL bump logic implemented in all three contracts. Each persistent write is followed by `extend_ttl` targeting ≥3,110,400 ledgers (~1 year). Public `extend_ttl` entrypoints added to `energy_token` (`extend_balance_ttl`), `audit_registry` (`extend_ttl`), and `community_governance` (`extend_ttl`) so any party can refresh entries. See PR #118 (HIGH remediation).

---

#### H-02 — `MINTER_SECRET_KEY` Is a Single-Point-of-Failure Held by API Process

**Component:** API (`apps/web/`), `energy_token` contract  
**Location:** `apps/web/.env.example`, deployment guide  
**STRIDE category:** Information Disclosure / Elevation of Privilege

**Description:**  
The `MINTER_SECRET_KEY` environment variable is the Stellar private key used by the API to sign all `mint()` calls. This key is stored in a Vercel environment variable (not in an HSM or multi-party custody). If the Vercel environment is compromised, an attacker gains the ability to mint unlimited energy certificates, bypassing all physical verification.

The `multisig_admin` contract exists and provides 2-of-3 signer governance over admin operations, but the minter role itself (the hottest key in the system) is a single secret held by the API.

**Recommendation:**
1. **Short term:** Rotate the minter key via `set_minter()` immediately if there is any suspicion of exposure. Ensure the key is stored only in Vercel's encrypted environment, never in `.env` files committed to git (gitleaks CI already enforces this).
2. **Medium term:** Move the minting signer to a dedicated server-side KMS (AWS KMS, GCP Cloud KMS, or HashiCorp Vault) so the raw key bytes are never loaded into application memory. Sign Stellar transactions via the KMS signing API.
3. **Long term:** Consider threshold signing (e.g. 2-of-3 Stellar multi-sig on the minter account) so no single compromised environment can mint unilaterally.

**Status:** ✅ **Resolved** — Minter signing migrated to a KMS-backed signer abstraction (`apps/web/src/lib/minter-signer.ts`). Raw key bytes are no longer loaded into application memory in production; transactions are signed via the KMS signing API. `set_minter()` rotation procedure documented in the deployment guide, and the minter account is configured for 2-of-3 Stellar multi-sig as defense in depth. See PR #118 (HIGH remediation).

---

### Medium

#### M-01 — `audit_registry.anchor()` Lacks Timestamp Freshness Verification On-Chain

**Contract:** `audit_registry`  
**Location:** `apps/contracts/audit_registry/src/lib.rs`, `anchor()` function  
**STRIDE category:** Tampering / Repudiation

**Description:**  
The `anchor()` function accepts and stores a `reading_hash` but does not verify that the hash was recently produced. The API performs a 5-minute timestamp window check before calling `anchor()`, but this check is off-chain and not enforced by the contract. A caller with direct contract access (i.e., the `api_signer` key) could anchor an arbitrarily old reading hash, backdating a certificate.

**Recommendation:**  
Add an optional `timestamp` parameter to `anchor()` and compare it against `env.ledger().timestamp()`. Reject anchors where `|ledger_timestamp - reading_timestamp| > MAX_ANCHOR_DELAY` (e.g., 10 minutes). This makes freshness enforcement contract-level and independent of the API.

**Status:** Open.

---

#### M-02 — Governance Is Sybil-Vulnerable (1-Address-1-Vote)

**Contract:** `community_governance`  
**Location:** `vote()` function  
**STRIDE category:** Elevation of Privilege

**Description:**  
The governance contract grants each Stellar address exactly one vote per proposal. Creating a Stellar address costs a small amount of XLM (the minimum balance reserve) but is otherwise unrestricted. An attacker or well-funded cooperative member can create many addresses and vote multiple times to manipulate proposal outcomes, since there is no token-stake or identity requirement.

The current design is documented as an intermediate state pending token-weighted voting.

**Recommendation:**  
Implement token-weighted voting: weight each vote by the voter's `energy_token` balance (SPEC tokens) at the time of proposal creation (snapshot). This requires either a balance-snapshot mechanism or a governance token distinct from the certificate token. Until then, ensure quorum thresholds are set conservatively (≥51% in basis points) and proposals with material on-chain consequences are socialized off-chain before on-chain execution.

**Status:** Open — tracked as Level 2 / governance roadmap item.

---

#### M-03 — No Application-Level Rate Limiting on API Endpoints Beyond `POST /api/readings`

**Component:** API  
**Location:** `apps/web/src/app/api/`  
**STRIDE category:** Denial of Service

**Description:**  
The `POST /api/readings` route has per-meter-key rate limiting (60 req/min) enforced via `checkRateLimit()`. However, other endpoints — including `GET /api/verify/[id]`, `POST /api/meters`, `POST /api/auth/login` — rely solely on Vercel's edge-level rate limiting, which is infrastructure-level and not configurable per-endpoint.

In particular:
- `POST /api/auth/login` has no explicit brute-force protection (account lockout or exponential backoff).
- `GET /api/verify/[id]` performs on-chain RPC calls for each request; a burst could exhaust Stellar RPC rate limits and degrade availability for legitimate users.

**Recommendation:**
1. Apply rate limiting middleware to all API routes, not just readings. A token-bucket or sliding-window limiter keyed on IP+route is appropriate.
2. Add exponential backoff or lockout after N failed login attempts for `POST /api/auth/login`.
3. Cache `GET /api/verify/[id]` responses for short periods (e.g., 30 seconds) to absorb burst reads without repeated RPC calls.

**Status:** Partially addressed (readings route has rate limiting). Other routes are open.

---

#### M-04 — Batch Readings Endpoint May Partially Succeed Without Atomic Rollback

**Component:** API  
**Location:** `apps/web/src/app/api/readings/batch/route.ts`  
**STRIDE category:** Tampering / Repudiation

**Description:**  
The batch readings endpoint (`POST /api/readings/batch`) processes multiple readings sequentially. If anchoring or minting succeeds for the first N readings but fails for reading N+1, the partial success is not rolled back. The caller receives a mixed response, but reading records may be persisted in Supabase in `anchored: false` or `minted: false` states. Depending on retry logic, this can lead to orphaned database records and inconsistency between the on-chain state and the off-chain store.

**Recommendation:**  
For batch operations, either:
1. Process all-or-nothing by wrapping the Supabase insert in a transaction and rolling back on any Stellar failure; or
2. Accept partial success explicitly in the API contract, and expose a reconciliation endpoint so operators can re-process failed readings by ID.

**Status:** Open.

---

### Low

#### L-01 — `TotalAnchors` Counter May Overflow at Scale (`u32`)

**Contract:** `audit_registry`  
**Location:** `apps/contracts/audit_registry/src/lib.rs`, `anchor()` function  
**STRIDE category:** Tampering

**Description:**  
The `TotalAnchors` counter is stored as a `u32`, which wraps at 4,294,967,295. At 1 reading per second, this takes ~136 years to overflow. At the Soroban SDK level, debug builds panic on overflow but release/Wasm builds use wrapping arithmetic by default for `u32` unless `overflow-checks = true` is set in the Cargo profile.

**Recommendation:**  
Confirm that `overflow-checks = true` is set in the release Cargo profile for all contracts (the existing overflow audit for `energy_token` covers `i128` arithmetic; verify `u32` counters are also covered). Alternatively, use `checked_add` for the counter increment and return an error if it would overflow. At realistic meter volumes, this will not trigger in practice, but the defensive check costs nothing.

**Status:** Low priority; verify Cargo profile setting.

---

#### L-02 — Webhook Delivery Is Fire-and-Forget with No Retry or Failure Tracking

**Component:** API  
**Location:** `apps/web/src/lib/webhooks.ts` (called via `void fireWebhook(...)`)  
**STRIDE category:** Repudiation

**Description:**  
Webhook calls (`fireWebhook`) are invoked with `void` — failures are silently discarded. If a cooperative's webhook endpoint is unavailable, they receive no notification of anchoring or minting events. There is no retry queue, failure log, or delivery guarantee.

**Recommendation:**  
Move webhook delivery to a background job queue (Redis-backed BullMQ or Supabase Edge Functions). Store delivery attempts and outcomes in the database. Implement exponential-backoff retries with a configurable maximum attempt count.

**Status:** Open.

---

#### L-03 — `propose_rotate` in `multisig_admin` Stores Pending Signer Addresses Under Predictable Keys

**Contract:** `multisig_admin`  
**Location:** `apps/contracts/multisig_admin/src/lib.rs`, `propose_rotate()` function  
**STRIDE category:** Informational / Tampering risk

**Description:**  
The `propose_rotate()` function stores the proposed new signer set using keys of the form `Signer(op_id * 10 + 3)`, `Signer(op_id * 10 + 4)`, `Signer(op_id * 10 + 5)`. If many operations are proposed (>429,496,729 — unlikely but theoretically possible), the computed indices `op_id * 10 + N` could collide with the live signer indices `Signer(0)`, `Signer(1)`, `Signer(2)`. This would corrupt the signer set without a rotation being executed.

At realistic operation volumes this is not exploitable, but the storage key design is fragile.

**Recommendation:**  
Use a dedicated `DataKey::PendingRotation(op_id)` key that stores a struct containing all three proposed addresses and the new threshold, rather than individual `Signer` keys. This eliminates the collision risk entirely and makes the intent clearer.

**Status:** Low priority; refactor before high-volume production use.

---

### Informational

#### I-01 — `energy_token` Symbol Mismatch Between Contract and Documentation

**Contract:** `energy_token`  
**Location:** `apps/contracts/energy_token/src/lib.rs`, `symbol()` function  

**Description:**  
The `symbol()` function returns `"SKWH"` and `name()` returns `"SolarProof kWh"`. The README and contract documentation refer to the token symbol as `"SPEC"` and the name as `"SolarProof Energy Certificate"`. Some test assertions (`test_sep41_name_symbol_decimals`) also assert against `"SPEC"` / `"SolarProof Energy Certificate"`, which would fail against the current contract implementation. This is either a documentation inconsistency or a stale implementation that has not been updated.

**Recommendation:**  
Align the contract implementation, tests, and documentation on a single canonical symbol and name before mainnet deployment.

---

#### I-02 — Nonce Variable Referenced Before Declaration in `POST /api/readings`

**Component:** API  
**Location:** `apps/web/src/app/api/readings/route.ts`

**Description:**  
In the `POST` handler, `nonce` is referenced in the idempotency check block (`if (nonce) { ... }`) but is not destructured from `parsed.data` at that point in the code. The `ReadingSchema` includes a `nonce` field, but the destructuring assignment (`const { meter_id, kwh, timestamp, signature_hex } = parsed.data`) omits `nonce`. This will cause `nonce` to be `undefined` at runtime, silently bypassing the database-level idempotency check for nonces.

**Recommendation:**  
Add `nonce` to the destructuring: `const { meter_id, kwh, timestamp, signature_hex, nonce } = parsed.data`.

---

#### I-03 — Governance `finalize()` Quorum Check Uses Inconsistent Logic

**Contract:** `community_governance`  
**Location:** `finalize()` function

**Description:**  
The finalization quorum check reads:
```rust
p.yes_votes * 10_000 / total >= threshold_bps && total * 10_000 >= quorum_bps
```
The second condition (`total * 10_000 >= quorum_bps`) is dimensionally inconsistent: `total` is a raw vote count, not a percentage. The intended check is whether the participation rate meets a minimum quorum, but without knowing the total eligible voter population, this condition is always true for `total >= 1` when `quorum_bps` is at its default of 1,000 (i.e., 1 × 10,000 = 10,000 ≥ 1,000). The quorum check effectively reduces to "at least one vote cast and threshold_bps of those votes are yes."

This is not exploitable given current quorum settings (the contract behaves as documented), but the semantic meaning of `QuorumBps` is misleading.

**Recommendation:**  
Document clearly that `QuorumBps` is a minimum vote-count threshold (not a participation-rate threshold), or redesign the quorum check to require a minimum percentage of a known total eligible voter count. Update governance initialization documentation accordingly.

---

#### I-04 — `GET /api/audit-log` Exposes Full Reading Metadata Without Field-Level Redaction

**Component:** API  
**Location:** `apps/web/src/app/api/audit-log/route.ts`

**Description:**  
The audit log endpoint returns full reading records including `signature_hex` and `reading_hash` to any authenticated operator. While this is useful for auditing, returning raw `signature_hex` values exposes the meter device's raw signature. Although Ed25519 signatures do not leak private key material, exposing them broadly increases the surface for future cryptanalytic attacks if a weakness in the signing scheme is discovered.

**Recommendation:**  
Consider omitting `signature_hex` from the audit log API response by default, and providing it only through a dedicated verification endpoint or on explicit request with elevated permissions. The signature is already stored in Supabase and accessible to authorized auditors through the verifier endpoint.

---

## 5. Recommendations Summary

| ID | Severity | Finding | Recommended Action | Priority |
|----|----------|---------|-------------------|----------|
| H-01 | High | Persistent storage TTL not managed | Implement TTL bump for all persistent entries | ✅ Resolved (PR #118) |
| H-02 | High | `MINTER_SECRET_KEY` single-point-of-failure | Move to KMS; consider multi-sig minter | ✅ Resolved (PR #118) |
| M-01 | Medium | No on-chain timestamp freshness in `anchor()` | Add ledger timestamp bound check in contract | Pre-launch |
| M-02 | Medium | Governance Sybil vulnerability | Implement token-weighted voting | Roadmap |
| M-03 | Medium | No rate limiting on non-readings endpoints | Add rate limiting middleware to all routes | Pre-launch |
| M-04 | Medium | Batch endpoint partial success not handled atomically | Add explicit partial-success semantics + reconciliation | Pre-launch |
| L-01 | Low | `TotalAnchors` u32 overflow | Verify Cargo profile; add `checked_add` | Before mainnet |
| L-02 | Low | Webhook fire-and-forget with no retry | Move to background job queue with retry | Post-launch |
| L-03 | Low | `multisig_admin` rotation storage key collision | Use dedicated `PendingRotation` storage key | Before mainnet |
| I-01 | Info | Token symbol/name mismatch | Align contract, tests, and docs | Before mainnet |
| I-02 | Info | `nonce` undefined in readings POST handler | Add `nonce` to destructuring | Immediate |
| I-03 | Info | Governance quorum semantics misleading | Clarify docs or redesign quorum check | Pre-launch |
| I-04 | Info | Audit log exposes `signature_hex` | Redact from default response | Pre-launch |

---

## 6. Resolved Issues (Prior Art)

The following issues were confirmed as previously identified and resolved:

| Issue | Contract / Area | Resolution | Reference |
|-------|----------------|------------|-----------|
| Integer overflow in `mint()`, `burn()`, `transfer()` | `energy_token` | All arithmetic replaced with `checked_add`/`checked_sub`; boundary tests added | #277, `docs/security/energy-token-overflow-audit.md` |
| Full reading payload stored on-chain (cost explosion) | `audit_registry` | Only 32-byte hash stored on-chain; full payload in Supabase | #59 |
| No env var validation at startup | API | Validated at startup with startup assertions | #79 |
| Secrets in committed files | CI/repo | Gitleaks scanning added to CI pipeline | #85 |
| `audit_registry` permissionless `anchor()` | `audit_registry` | `ApiSigner` role added; only registered signer may call `anchor()` | Per current implementation |

---

## 7. Test Coverage Assessment

**Contract unit tests:** The contracts have thorough unit test suites covering:
- Happy-path operation (mint, anchor, vote, transfer, burn, retire)
- Duplicate rejection (double-anchor, double-vote, double-initialize)
- Access control (unauthorized mint, unauthorized `set_minter`, non-signer proposal)
- Arithmetic boundaries (overflow at `i128::MAX`, underflow guards)
- Governance lifecycle (pass, reject, expire, execute, timing boundaries)
- Reentrancy guard for `vote()`
- Bitmap scaling to 200+ voters (multiple bitmap words)

**Fuzz targets:** Fuzz targets exist for `fuzz_mint`, `fuzz_anchor`, and `fuzz_vote`. The audit recommends running these targets for a minimum of 24 CPU-hours before mainnet deployment.

**API tests:** API route tests (`*.test.ts`) cover the happy path, invalid input, and signature rejection for the readings endpoint. Coverage for edge cases in the batch endpoint and auth routes is thin and should be expanded.

**Identified test gaps:**
- No test for the `nonce` idempotency path in `POST /api/readings` (related to I-02)
- No integration test covering the full path from signed reading → anchor → mint → verify
- No test for `GET /api/verify/[id]` when the underlying Stellar RPC is unavailable (error resilience)

---

## 8. Conclusion

The SolarProof smart contracts are well-structured with clear access control patterns, explicit arithmetic overflow protection, and meaningful test coverage. The core cryptographic flow — Ed25519 meter signature → on-chain hash anchor → SEP-41 certificate — is sound.

The two High findings (TTL management and minter key custody) have been remediated: TTL bump logic is now implemented across all three contracts (H-01), and minter signing has been migrated to a KMS-backed signer with multi-sig defense in depth (H-02). Both fixes are prerequisites for the independent third-party audit and are marked resolved above.

The Medium and Low findings represent hardening opportunities. Governance Sybil resistance and batch-endpoint atomicity are the most impactful to address for production reliability.

A re-audit is recommended after:
1. ~~TTL bump logic is implemented in all three contracts (H-01)~~ — ✅ Done (PR #118)
2. ~~The minter key is migrated to a KMS or multi-sig setup (H-02)~~ — ✅ Done (PR #118)
3. The `nonce` destructuring bug is fixed (I-02)

---

*This report was produced as part of the SolarProof pre-mainnet security review process. It is intended for internal use and authorized security reviewers. Findings should be tracked in the project issue tracker.*
