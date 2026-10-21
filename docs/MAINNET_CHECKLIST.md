# SolarProof — Stellar Mainnet Deployment Checklist & Go-Live Plan

> Resolves #142. Complete every item and obtain sign-off before deploying to Stellar Mainnet.

---

## Phase 1 — Security Audit

| # | Item | Owner | Status |
|---|------|-------|--------|
| 1.1 | Engage third-party auditor (scope: `energy_token`, `audit_registry`, `community_governance` — see [AUDIT_SCOPE.md](AUDIT_SCOPE.md)) | Lead | 🔄 In progress |
| 1.2 | All Critical and High findings from internal audit (`docs/security/SECURITY_AUDIT_REPORT.md`) resolved before third-party audit begins | Lead + Auditor | 🔄 In progress |
| 1.3 | Medium findings triaged; accepted risks documented | Lead | ☐ |
| 1.4 | Third-party audit report published in `docs/audits/` | Lead | ☐ |
| 1.5 | Re-audit of remediated findings conducted | Lead + Auditor | ☐ |
| 1.6 | `anchor()` access control decision finalised (permissionless vs. restricted — see AUDIT_SCOPE.md §audit_registry) | Lead | ☐ |

> **Note:** The third-party audit report and any re-audit reports must be published under `docs/audits/` (not `docs/audit/`). All HIGH findings from the internal audit must be remediated before the third-party audit is engaged.

---

## Phase 2 — Testnet Fork Validation

| # | Item | Owner | Status |
|---|------|-------|--------|
| 2.1 | Deploy all three contracts to a **mainnet-fork** environment using production WASM builds | DevOps | ☐ |
| 2.2 | Run full `cargo test --all` against fork; zero failures | Dev | ☐ |
| 2.3 | End-to-end smoke test: meter reading → Ed25519 verify → anchor → mint → retire | Dev | ☐ |
| 2.4 | Verify `total_supply == total_minted - total_burned` invariant post-smoke-test | Dev | ☐ |
| 2.5 | Confirm `community_governance` quorum and voting period behave correctly at mainnet ledger cadence (~5 s/ledger) | Dev | ☐ |
| 2.6 | Load test: 1 000 concurrent anchor submissions; confirm no duplicate anchors accepted | Dev | ☐ |
| 2.7 | Persistent storage TTL verified — balance entries do not expire unexpectedly under mainnet TTL settings | Dev | ☐ |

---

## Phase 3 — Infrastructure & Key Management

| # | Item | Owner | Status |
|---|------|-------|--------|
| 3.1 | Mainnet admin keypair generated in HSM or hardware wallet; secret never touches CI | DevOps | ☐ |
| 3.2 | Mainnet minter keypair generated and stored in secrets manager (not in `.env` files) | DevOps | ☐ |
| 3.3 | Multi-sig or time-lock on admin key rotation confirmed | Lead | ☐ |
| 3.4 | Production environment variables set in Vercel (see `.env.example`): `NEXT_PUBLIC_ENERGY_TOKEN_ID`, `NEXT_PUBLIC_AUDIT_REGISTRY_ID`, `NEXT_PUBLIC_COMMUNITY_GOVERNANCE_ID`, `MINTER_SECRET_KEY` | DevOps | ☐ |
| 3.5 | Supabase production project provisioned; RLS policies verified (see `supabase/migrations/`) | DevOps | ☐ |
| 3.6 | Automated DB backup workflow enabled and tested (see [BACKUP.md](BACKUP.md)) | DevOps | ☐ |
| 3.7 | Sentry DSN configured for production; error alerts routed to on-call channel | DevOps | ☐ |
| 3.8 | Uptime monitoring configured (see `.github/upptime.yml`) | DevOps | ☐ |

---

## Phase 4 — Mainnet Contract Deployment

Run these steps in order. Record every contract ID immediately.

```bash
# 1. Build release WASMs
cd apps/contracts
stellar contract build

# 2. Deploy (replace YOUR_MAINNET_SECRET with the HSM-sourced key)
TOKEN_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/energy_token.wasm \
  --source YOUR_MAINNET_SECRET --network mainnet)

REGISTRY_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/audit_registry.wasm \
  --source YOUR_MAINNET_SECRET --network mainnet)

GOV_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/community_governance.wasm \
  --source YOUR_MAINNET_SECRET --network mainnet)

# 3. Initialize
stellar contract invoke --id $TOKEN_ID --source YOUR_MAINNET_SECRET --network mainnet \
  -- initialize --admin ADMIN_ADDRESS --minter MINTER_ADDRESS

stellar contract invoke --id $REGISTRY_ID --source YOUR_MAINNET_SECRET --network mainnet \
  -- initialize --admin ADMIN_ADDRESS

stellar contract invoke --id $GOV_ID --source YOUR_MAINNET_SECRET --network mainnet \
  -- initialize --admin ADMIN_ADDRESS --quorum 51 --voting_period_ledgers 17280
```

| # | Item | Owner | Status |
|---|------|-------|--------|
| 4.1 | WASM checksums match audited build artifacts (sha256) | Dev | ☐ |
| 4.2 | All three contracts deployed; IDs recorded in `docs/mainnet-contract-ids.txt` (gitignored) | DevOps | ☐ |
| 4.3 | All three contracts initialised; transactions verified on Stellar Explorer | DevOps | ☐ |
| 4.4 | Production env vars updated with live contract IDs | DevOps | ☐ |
| 4.5 | Post-deploy smoke test repeated against mainnet contracts | Dev | ☐ |

---

## Phase 5 — Go-Live

| # | Item | Owner | Status |
|---|------|-------|--------|
| 5.1 | Public verifier (`/verify`) tested end-to-end on mainnet | Dev | ☐ |
| 5.2 | README contract table updated to reflect mainnet deployment | Dev | ☐ |
| 5.3 | DEPLOYMENT.md updated with mainnet network flag and contract IDs reference | Dev | ☐ |
| 5.4 | Incident response runbook linked from [THREAT_MODEL.md](THREAT_MODEL.md) | Lead | ☐ |
| 5.5 | Team sign-off obtained (see sign-off table below) | Lead | ☐ |
| 5.6 | GitHub release tagged (`v1.0.0`) via `release.yml` workflow | DevOps | ☐ |

---

## Rollback Plan

If a critical issue is discovered post-deployment:

1. **Immediate**: Disable the minter API route (`MINTER_ENABLED=false` env var) to halt new mints.
2. **Contracts**: Soroban contracts are immutable once deployed. Rollback means deploying a patched version and updating env vars to point to the new contract IDs. The old contracts remain on-chain but the API stops routing to them.
3. **Database**: Restore Supabase from the most recent automated backup (see [BACKUP.md](BACKUP.md)).
4. **Frontend**: Revert Vercel deployment to the previous production deployment via the Vercel dashboard.
5. **Communication**: Post a status update to the uptime page and notify registered meter operators within 1 hour.
6. **Post-mortem**: Document root cause and corrective actions within 48 hours.

---

## Team Sign-Off

All roles must sign off before go-live (Phase 5).

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Lead Engineer | | | |
| Security Reviewer | | | |
| DevOps | | | |
| Product Owner | | | |

---

*Last updated: 2026-05-31*
