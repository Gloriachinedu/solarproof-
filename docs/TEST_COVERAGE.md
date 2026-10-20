# Test Coverage Targets

This document defines coverage goals, critical modules, and failure criteria for the SolarProof project.

---

## Coverage goals by layer

| Layer | Tool | Target | Minimum to pass CI |
|---|---|---|---|
| Soroban contracts (Rust) | `cargo test` + `cargo llvm-cov` | **90 %** line coverage | **80 %** |
| API routes (Next.js) | Jest / Vitest | **90 %** line coverage | **80 %** |
| Frontend components | Vitest + React Testing Library | **70 %** line coverage | **60 %** |
| Shared `packages/stellar` | Vitest | **85 %** line coverage | **75 %** |

> Targets apply to new code merged into `main`. Legacy code brought in by third-party deps is excluded.

---

## Critical modules

The following modules have elevated importance. Coverage falling below the **minimum** threshold blocks merge.

### Contracts

| Module | Why critical |
|---|---|
| `energy_token` — `mint`, `burn`, `transfer` | Financial correctness; over/undercounting tokens is unrecoverable on-chain |
| `audit_registry` — `anchor`, `verify` | Immutable records; a bug here produces permanently incorrect proofs |
| `energy_token` — `set_minter` / admin auth | Privilege escalation risk |
| `audit_registry` — duplicate-anchor guard | Prevents replaying the same reading as multiple certificates |

### API routes

| Module | Why critical |
|---|---|
| `POST /api/readings` — Ed25519 verification | A bypass here allows minting without real generation |
| `POST /api/readings` — Supabase write path | Data integrity for meter records |
| `GET /api/verify` | Public-facing audit endpoint; incorrect output breaks trust |

### Frontend

| Module | Why critical |
|---|---|
| `src/lib/crypto.ts` — `verifyReading` | Client-side signature check mirrors server logic |
| `src/lib/stellar.ts` — contract invocation helpers | Incorrect ABI encoding silently produces bad transactions |

---

## What must be tested

### Contracts (must have unit tests)
- Happy-path for every public entrypoint
- Auth failures (`require_auth` panics when called by wrong account)
- Boundary / overflow conditions (zero amounts, duplicate anchors, double-voting)
- Event emission for state-changing calls

### API routes (must have integration tests)
- Valid request → 200 + expected payload
- Missing or malformed fields → 400
- Invalid Ed25519 signature → 403
- Supabase / Stellar errors → 500 with structured error body

### Frontend components
- Render without errors for all prop variants
- Error and loading states displayed correctly
- Wallet-connection flows (mocked)

---

## Failure criteria

A PR **fails coverage checks** if any of the following are true:

1. Any layer's coverage drops **below the minimum** threshold in the table above.
2. A critical module listed above has **any untested public entrypoint**.
3. An auth-gating path (admin / minter require_auth) has no test asserting it panics when called without authorization.
4. The total number of contract tests decreases (tests must not be deleted to inflate line percentages).

---

## Running coverage locally

### Contracts

```bash
# Install cargo-llvm-cov once
cargo install cargo-llvm-cov

cd apps/contracts
cargo llvm-cov --all --html
# Report: apps/contracts/target/llvm-cov/html/index.html
```

### API + frontend

```bash
# From repo root
pnpm test -- --coverage
```

---

## Dependencies

- Contract coverage depends on `cargo-llvm-cov` being available in CI (see `.github/workflows/ci.yml`).
- Frontend/API coverage depends on a Vitest or Jest config with `coverage.provider = 'v8'`.
- See also: test strategy document (linked from CONTRIBUTING.md when available).
