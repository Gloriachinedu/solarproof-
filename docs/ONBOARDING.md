# Developer Onboarding Guide

Welcome to SolarProof. This guide gets you from zero to a running local environment with a simulated meter reading end-to-end — and shows you how to start contributing.

> **New here?** Read sections 1–3 to understand the project, then jump to section 8 (Your First Contribution) to find an issue and open a PR.

---

## Table of Contents

1. [What SolarProof Does](#1-what-solarproof-does)
2. [Architecture Overview](#2-architecture-overview)
3. [Key Data Flows](#3-key-data-flows)
4. [Prerequisites](#4-prerequisites)
5. [Clone and Install](#5-clone-and-install)
6. [Environment Variables](#6-environment-variables)
7. [Run the App and Simulate a Meter Reading](#7-run-the-app-and-simulate-a-meter-reading)
8. [Your First Contribution](#8-your-first-contribution)
9. [Codebase Navigation](#9-codebase-navigation)
10. [Testing](#10-testing)
11. [Common Patterns](#11-common-patterns)
12. [Troubleshooting](#12-troubleshooting)
13. [Getting Help](#13-getting-help)

---

## 1. What SolarProof Does

SolarProof closes the gap between physical energy generation and verifiable on-chain certification. Every kilowatt-hour is signed at the meter, anchored to the Stellar blockchain, and publicly auditable — no trust required.

The three core guarantees:

1. **Signed at source** — each meter reading is Ed25519-signed by the device before leaving the hardware.
2. **Anchored on-chain** — the signed reading hash is recorded on Stellar alongside the minted certificate.
3. **Publicly verifiable** — any regulator, buyer, or auditor can verify the full chain: `meter → signature → ledger → certificate → retirement`.

### Why this matters

Existing renewable energy certificate systems (I-REC, TIGR, Energy Web) have a critical weakness: there is no cryptographic link between the physical meter reading and the on-chain certificate. Anyone can mint a certificate. Nobody can prove it corresponds to real generation. SolarProof fixes this.

---

## 2. Architecture Overview

```
Smart Meter (Ed25519 keypair)
        │  POST /api/readings  { meter_id, kwh, timestamp, signature_hex }
        │  Header: Idempotency-Key: <uuid>
        ▼
SolarProof API  (Next.js 15 — apps/web)
        │  1. Check Idempotency-Key in Redis → return cached response if hit
        │  2. Verify Ed25519 signature against meter public key
        │  3. Anchor reading hash → audit_registry contract (Stellar)
        │  4. Mint energy_token (1 token = 1 kWh) to cooperative admin
        │  5. Store certificate in Supabase
        ▼
Stellar Testnet  (Soroban — apps/contracts)
        ├── energy_token          SEP-41 certificate token (minter-gated)
        ├── audit_registry        immutable signed-reading anchors
        └── community_governance  cooperative proposals + voting
        ▼
Public Verifier  (https://solarproof.vercel.app/verify)
        Input:  certificate ID or tx hash
        Output: meter reading → Ed25519 proof → ledger anchor → certificate
```

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Blockchain | Stellar (Soroban) |
| Smart Contracts | Rust + OpenZeppelin Stellar v0.5.1 |
| Frontend | Next.js 15 + React 19 + TypeScript |
| Styling | Tailwind CSS v4 |
| Wallet | Freighter + Stellar Wallets Kit |
| Backend | Next.js API Routes + Supabase (Postgres) |
| Signing | Ed25519 (meter devices) |
| Debugging | tracer-sim (Soroban replay) |
| Caching | Redis (Upstash in production) |
| Deployment | Vercel |
| Monorepo | Turborepo + pnpm |

---

## 3. Key Data Flows

### Meter Reading → Certificate (the main flow)

```
1. Meter generates Ed25519 keypair (scripts/gen-meter-key.mjs)
2. Meter signs: sign({ meter_id, kwh_in_stroops, timestamp })
3. POST /api/readings with { meter_id, kwh, timestamp, signature_hex, nonce }
4. API verifies signature against meter.pubkey_hex from Supabase
5. API computes reading hash = SHA-256(meter_id ‖ kwh_stroops ‖ timestamp)
6. API calls audit_registry.anchor(reading_hash) on Stellar → anchor_tx_hash
7. API calls energy_token.mint(recipient, kwh_stroops) → mint_tx_hash
8. API inserts certificate row in Supabase
9. Operator views certificate on /certificates
10. Auditor verifies full chain on /verify
```

### Key files by flow

| Flow | Entry point | Key files |
|------|-------------|-----------|
| Meter reading submission | `POST /api/readings` | `src/app/api/readings/route.ts` |
| Signature verification | `src/lib/crypto.ts` | `@noble/ed25519` |
| Stellar interactions | `src/lib/stellar.ts` | `@stellar/stellar-sdk` |
| Idempotency | `src/lib/idempotency.ts` | Upstash Redis |
| Certificate cache | `src/lib/cache.ts` | Upstash Redis |
| Structured logging | `src/lib/logger.ts` | Logtail / stdout |
| APM traces | `src/instrumentation.ts` | OpenTelemetry OTLP |
| Rate limiting | `src/lib/rate-limit.ts` | Redis sliding window |
| Background jobs | `src/lib/queue.ts` | BullMQ |

---

## 4. Prerequisites

Install the following before cloning:

| Tool | Version | Install |
|------|---------|---------|
| Node.js | v22+ | [nodejs.org](https://nodejs.org) or `nvm install 22` |
| pnpm | v10+ | `npm install -g pnpm@10` |
| Rust + Cargo | stable (1.78+) | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| wasm32 target | — | `rustup target add wasm32-unknown-unknown` |
| Stellar CLI | latest | `cargo install --locked stellar-cli --features opt` |
| Docker + Compose | v24+ | [docs.docker.com](https://docs.docker.com/get-docker/) *(optional, recommended)* |

Verify:

```bash
node --version      # v22.x.x
pnpm --version      # 10.x.x
cargo --version     # cargo 1.x.x
stellar --version   # stellar x.x.x
```

---

## 5. Clone and Install

```bash
git clone https://github.com/katecatherinaa/solarproof.git
cd solarproof
pnpm install
```

> If you're contributing as an external developer, fork the repo first and clone your fork:
> ```bash
> git clone https://github.com/<your-username>/solarproof.git
> git remote add upstream https://github.com/katecatherinaa/solarproof.git
> ```

---

## 6. Environment Variables

```bash
cp apps/web/.env.example apps/web/.env.local
```

Edit `apps/web/.env.local` and fill in:

> Local development secrets must live in `apps/web/.env.local` only. This file is gitignored and should never be committed.
> CI should use GitHub Actions secrets, and production should use Vercel environment variables.

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Stellar
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_ENERGY_TOKEN_ID=        # from contract deployment
NEXT_PUBLIC_AUDIT_REGISTRY_ID=      # from contract deployment
NEXT_PUBLIC_COMMUNITY_GOVERNANCE_ID= # from contract deployment
MINTER_SECRET_KEY=                  # Stellar secret key for the minter account

# Redis (Upstash) — optional for local dev, required for idempotency + caching
UPSTASH_REDIS_REST_URL=https://your-instance.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token

# Observability — optional
LOGTAIL_SOURCE_TOKEN=               # Better Stack structured logs
OTEL_EXPORTER_OTLP_ENDPOINT=        # OpenTelemetry collector URL
OTEL_EXPORTER_OTLP_HEADERS=         # e.g. Authorization=Basic <base64>
```

For contract IDs, see [Deploying contracts locally](#deploying-contracts-locally) below, or ask a teammate for the shared testnet IDs.

---

## 7. Run the App and Simulate a Meter Reading

### Option A — Docker (recommended)

Spins up Next.js, Supabase, and Redis together:

```bash
docker compose up
```

App available at http://localhost:3000. Data persists in named volumes across restarts.

### Option B — Local dev server

```bash
pnpm dev
```

Opens at http://localhost:3000. Requires Supabase and Redis to be running separately (or set env vars to cloud instances).

### Simulate a meter reading end-to-end

**Step 1 — Generate a meter keypair:**

```bash
node scripts/gen-meter-key.mjs
# Outputs meter-key.json with public_key_hex and private_key_hex
```

**Step 2 — Register the meter in Supabase:**

```sql
INSERT INTO meters (id, public_key_hex, name, cooperative_id, active)
VALUES (gen_random_uuid(), '<public_key_hex>', 'dev-meter', '<cooperative_id>', true);
```

**Step 3 — Start the dev server:**

```bash
pnpm dev
```

**Step 4 — Send a signed reading:**

```bash
node scripts/send-reading.mjs \
  --meter-id <uuid-from-step-2> \
  --kwh 12.5 \
  --key ./meter-key.json \
  --api http://localhost:3000
```

Expected output:

```
Sending reading: { meterId: '...', kwh: 12.5, timestamp: ... }
Reading hash: <hex>
✓ Success: { anchor_tx: '...', token_tx: '...' }
```

**Step 5 — Verify on-chain:**

Open http://localhost:3000/verify and enter the reading hash or token transaction ID.

### Deploying contracts locally

Build all contracts:

```bash
cd apps/contracts
stellar contract build
```

Deploy to Stellar testnet (requires a funded testnet account):

```bash
# Fund a testnet account
stellar keys generate deployer --network testnet
stellar keys fund deployer --network testnet

# Deploy
TOKEN_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/energy_token.wasm \
  --source deployer --network testnet)

REGISTRY_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/audit_registry.wasm \
  --source deployer --network testnet)

GOV_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/community_governance.wasm \
  --source deployer --network testnet)
```

Initialize each contract:

```bash
stellar contract invoke --id $TOKEN_ID --source deployer --network testnet \
  -- initialize --admin $(stellar keys address deployer) --minter $(stellar keys address deployer)

stellar contract invoke --id $REGISTRY_ID --source deployer --network testnet \
  -- initialize --admin $(stellar keys address deployer)

stellar contract invoke --id $GOV_ID --source deployer --network testnet \
  -- initialize --admin $(stellar keys address deployer) --quorum 51 --voting_period_ledgers 17280
```

Copy the IDs into `apps/web/.env.local`.

---

## 8. Your First Contribution

### Find an issue

1. Browse [open issues](https://github.com/katecatherinaa/solarproof/issues) — look for the `good first issue` label.
2. Comment on the issue to claim it before starting work.
3. Wait for a maintainer to assign it to you.

### Branch and develop

```bash
# Make sure you're on the latest main
git checkout main
git pull upstream main

# Create a branch following the naming convention
git checkout -b feat/your-feature-<issue-number>
# or: git checkout -b fix/your-fix-<issue-number>
# or: git checkout -b docs/your-docs-change
```

**Branch naming conventions:**

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feat/<short-description>-<issue>` | `feat/batch-anchor-42` |
| Bug fix | `fix/<short-description>-<issue>` | `fix/signature-validation-17` |
| Docs | `docs/<short-description>` | `docs/contract-interfaces` |
| Chore / CI | `chore/<short-description>` | `chore/turbo-remote-cache` |

### Commit your work

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

[optional body]

[optional footer: Closes #<issue>]
```

**Types:** `feat` · `fix` · `docs` · `chore` · `refactor` · `test` · `ci` · `perf`

**Scopes:** `api` · `contracts` · `web` · `stellar` · `ci` · `docs`

Examples:

```
feat(contracts): add batch anchor support
fix(api): validate Ed25519 signature before DB write
docs(contracts): document energy_token interface
test(web): add security tests for Ed25519 verification
```

### Open a PR

```bash
# Push to your fork
git push origin feat/your-feature-<issue-number>

# Create a PR targeting main
gh pr create --base main --title "feat(api): add batch anchor support" --body "Closes #42"
```

**PR checklist:**

- [ ] Branch name follows the convention above
- [ ] All commits follow Conventional Commits format
- [ ] `pnpm lint` passes with no errors
- [ ] `pnpm build` succeeds
- [ ] Relevant tests added or updated
- [ ] `cargo test` passes for any contract changes
- [ ] Docs updated if public interfaces changed
- [ ] PR description references the issue (`Closes #<n>`)
- [ ] No secrets or `.env` files committed

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full contribution guide.

---

## 9. Codebase Navigation

### Monorepo structure

```
solarproof/
├── apps/
│   ├── contracts/              # Soroban smart contracts (Rust)
│   │   ├── energy_token/       # SEP-41 certificate token (minter-gated)
│   │   ├── audit_registry/     # Immutable reading anchors
│   │   ├── community_governance/ # Cooperative proposals + voting
│   │   └── multisig_admin/     # Multi-signature admin controls
│   └── web/                    # Next.js 15 app + API routes
│       ├── src/
│       │   ├── app/            # Next.js App Router pages + API routes
│       │   │   └── api/        # REST API (readings, certificates, meters…)
│       │   ├── lib/            # Shared utilities (stellar, crypto, cache…)
│       │   ├── components/     # React UI components
│       │   ├── hooks/          # React hooks (useWallet, use-realtime-readings)
│       │   └── instrumentation.ts  # OpenTelemetry hook
│       └── e2e/                # Playwright end-to-end tests
├── packages/
│   └── stellar/                # Shared Stellar client utilities
├── scripts/                    # Meter simulation and deployment scripts
├── tests/                      # Load tests and integration tests
│   ├── load/                   # k6 load test scenarios
│   └── integration/            # End-to-end integration tests
├── docs/                      # ADRs, deployment guide, API docs
│   ├── adr/                    # Architecture Decision Records
│   ├── contracts/              # Contract documentation
│   ├── security/               # Security audit reports
│   └── runbooks/               # Operational runbooks
└── supabase/                   # Migrations and seed data
```

### Frontend routes (`apps/web/src/app/`)

| Route | Description |
|-------|-------------|
| `/` | Landing page / product overview |
| `/dashboard` | Operator metrics: kWh totals, certificate counts, charts, recent readings |
| `/certificates` | Certificate history with date/meter filters and CSV export |
| `/verify` | Public chain-of-custody verifier (no login required) |
| `/governance` | Cooperative proposals and voting |
| `/meters` | Meter management and registration |
| `/admin` | Admin panel |
| `/settings` | User settings |

### API routes (`apps/web/src/app/api/`)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Liveness probe used by smoke tests and uptime monitoring |
| `/api/readings` | POST | Accept signed meter reading; verify Ed25519, anchor on Stellar, mint token |
| `/api/readings` | GET | List readings with cursor-based pagination |
| `/api/certificates` | GET | List certificates with filtering (date, meter) and CSV export |
| `/api/certificates/[id]/retire` | POST | Retire a certificate via the energy_token contract |
| `/api/verify` | GET | Resolve a certificate ID or tx hash to its full audit chain |
| `/api/meters` | POST | Register a new meter |
| `/api/governance` | GET/POST | Cooperative governance proposals and voting |

### Shared libraries (`apps/web/src/lib/`)

| Module | Purpose |
|--------|---------|
| `crypto.ts` | Ed25519 reading hash computation and signature verification |
| `stellar.ts` | Stellar SDK calls: anchor, mint, retire, verify |
| `supabase.ts` | Supabase client factory (service + anon) |
| `cache.ts` | Redis-backed certificate cache invalidation |
| `idempotency.ts` | Idempotency key storage and retrieval |
| `rate-limit.ts` | IP-based and meter-based rate limiting |
| `queue.ts` | BullMQ background job queue (anchor + mint) |
| `logger.ts` | Structured logging with correlation IDs |
| `auth.ts` | JWT authentication for operator routes |
| `errors.ts` | Typed application errors with categories |

### Architecture Decision Records (ADRs)

ADRs document key design decisions. Read them to understand why things are the way they are:

| ADR | Title | Key decision |
|-----|-------|-------------|
| [001](adr/001-ed25519-signing.md) | Ed25519 for Meter Signing | Why Ed25519 over other signature schemes |
| [002](adr/002-stellar-soroban.md) | Stellar/Soroban over EVM | Why Stellar instead of Ethereum |
| [003](adr/003-sep41-token-standard.md) | SEP-41 Token Standard | Why SEP-41 for energy certificates |
| [004](adr/004-cooperative-governance.md) | Cooperative Governance Model | On-chain governance design |
| [005](adr/005-monorepo-structure.md) | Monorepo Structure | Turborepo + pnpm workspace |
| [006](adr/006-certificate-retirement-model.md) | Certificate Retirement Model | Burn-based retirement |
| [007](adr/007-supabase-service-role-usage.md) | Supabase Service Role Key Usage | Server-side key management |
| [009](adr/009-redis-caching.md) | Redis Caching Strategy | Caching, rate limiting, idempotency |

---

## 10. Testing

### Web — unit tests (Vitest)

```bash
# From repo root (Turborepo runs all packages)
pnpm test

# From apps/web only
cd apps/web
pnpm test          # vitest run (single pass)
pnpm test:watch    # vitest watch mode
```

Unit tests live in:
- `apps/web/src/__tests__/` — component and utility tests
- `apps/web/src/lib/__tests__/` — library function tests
- `apps/web/src/app/api/__tests__/` — API route regression tests

### Web — end-to-end tests (Playwright)

```bash
cd apps/web
pnpm e2e           # Playwright (requires running dev server)
```

E2E tests live in `apps/web/e2e/` and test the full user journey through the browser.

### Web — lint and type-check

```bash
pnpm lint          # ESLint
pnpm type-check    # TypeScript (tsc --noEmit)
pnpm build         # Next.js production build
```

### Contracts — unit tests (Rust)

```bash
cd apps/contracts
cargo fmt --all -- --check   # formatting
cargo clippy --all-targets   # lints
cargo test --all             # unit tests (all contracts)

# Single contract
cargo test --package energy-token
cargo test --package audit-registry
cargo test --package community-governance
```

### Load tests (k6)

```bash
k6 run tests/load/readings.js -e API_URL=http://localhost:3000 -e SCENARIO=baseline
```

See [docs/performance/results.md](performance/results.md) for baseline results and [docs/LOAD_TESTING.md](LOAD_TESTING.md) for the full guide.

### Shared packages

```bash
cd packages/stellar
pnpm test
```

---

## 11. Common Patterns

### API route pattern

All API routes follow the same structure. Here's the pattern for a POST route:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

// 1. Define the request schema with Zod
const RequestSchema = z.object({
  field: z.string().min(1),
})

// 2. Export the handler
export async function POST(req: NextRequest) {
  // 3. Parse and validate the body
  const body = await req.json().catch(() => null)
  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  // 4. Business logic...
  return NextResponse.json({ success: true }, { status: 200 })
}
```

### Ed25519 signature verification

The crypto module (`src/lib/crypto.ts`) provides two functions:

```typescript
// Compute the canonical reading hash
const hash = computeReadingHash(meterId, kwhStroops, BigInt(timestamp))

// Verify an Ed25519 signature
const valid = await verifyReadingSignature(signatureHex, hash, pubkeyHex)
```

The canonical hash is `SHA-256(meter_id_utf8 ‖ kwh_stroops_le64 ‖ timestamp_le64)`. Little-endian encoding matches the firmware convention on ARM Cortex-M targets. See [docs/ED25519_PROTOCOL.md](ED25519_PROTOCOL.md) for the full protocol spec.

### Supabase queries

The service role client is used server-side only:

```typescript
import { createServiceClient } from '@/lib/supabase'

const db = createServiceClient()
const { data, error } = await db.from('table').select('*')
```

Row-level security (RLS) policies enforce cooperative-level data isolation.

### Test factories

When writing tests that need database rows, use the factories in `src/tests/factories.ts`:

```typescript
import { makeCooperative, makeMeter, makeReading, cleanup, emptyCleanupIds } from '@/tests/factories'

let ids: CleanupIds
beforeEach(() => { ids = emptyCleanupIds() })
afterEach(() => cleanup(db, ids))

it('creates a reading', async () => {
  const coop = await makeCooperative(db, ids)
  const meter = await makeMeter(db, ids, { cooperative_id: coop.id })
  const reading = await makeReading(db, ids, { meter_id: meter.id })
})
```

### Structured logging

Use the logger, not `console.log`:

```typescript
import { logger } from '@/lib/logger'

logger.info('readings.post.enqueued', { reading_id: '...', job_id: '...' })
logger.warn('readings.post.invalid_signature', { meter_id: '...' })
logger.error('readings.post.db_insert_failed', { error: '...' })
```

---

## 12. Troubleshooting

**`pnpm install` fails with peer dependency errors**
→ Ensure Node.js v22+ is active: `node --version`. Switch with `nvm use 22`.

**`stellar contract build` fails with `wasm32-unknown-unknown` not found**
→ Run: `rustup target add wasm32-unknown-unknown`

**`stellar keys fund` returns an error**
→ Testnet friendbot may be rate-limited. Try directly:
```bash
curl "https://friendbot.stellar.org?addr=$(stellar keys address deployer)"
```

**API returns `Invalid meter signature`**
→ The `meter_id` passed to `send-reading.mjs` must exactly match the UUID registered in Supabase. UUIDs are case-sensitive.

**API returns `Meter not found or inactive`**
→ Ensure the meter row has `active = true` and the `cooperative_id` references a valid cooperative with an `admin_address`.

**`cargo test` fails with `ed25519` import errors**
→ Ensure you're using the `soroban-sdk` version pinned in `apps/contracts/Cargo.toml`. Run `cargo update` only if explicitly needed.

**Next.js build fails with missing env vars**
→ All `NEXT_PUBLIC_*` vars must be set at build time. Check `apps/web/.env.local` exists and is populated. See `apps/web/src/env.ts` for the full list of required vars.

**Idempotency-Key not working (duplicate requests re-process)**
→ `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` must be set. Without Redis, idempotency is a no-op (by design, for local dev).

**OpenTelemetry traces not appearing**
→ Set `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS`. Verify the collector is reachable. Check stdout for SDK startup errors.

**Docker compose fails to start Supabase**
→ Ensure ports 5432 and 54321 are free: `lsof -i :5432`. Stop any local Postgres instances first.

**Playwright tests fail with connection refused**
→ Ensure the dev server is running (`pnpm dev`) or set `BASE_URL` to a running instance. The Playwright config auto-starts a dev server on `127.0.0.1:3000` if `BASE_URL` is not set.

---

## 13. Getting Help

- **Issues:** Browse [open issues](https://github.com/katecatherinaa/solarproof/issues) or open a new one.
- **CONTRIBUTING.md:** Read [CONTRIBUTING.md](../CONTRIBUTING.md) for commit conventions and PR workflow.
- **ADRs:** Check [docs/adr/](adr/) for architectural decisions and rationale.
- **Runbooks:** See [docs/runbooks/](runbooks/) for operational procedures.
- **Security:** Found a vulnerability? See [SECURITY.md](../SECURITY.md) for responsible disclosure.

---

*Built on Stellar · SolarProof Contributors 2026*
