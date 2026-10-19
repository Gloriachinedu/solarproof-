# Developer Onboarding Guide

Welcome to SolarProof. This guide gets you from zero to a running local environment with a simulated meter reading end-to-end.

---

## API Documentation

The interactive API reference (Swagger UI) is available in every deployed environment:

| Environment | URL |
|-------------|-----|
| Local dev   | http://localhost:3000/api/docs/ui |
| Staging     | https://solarproof-staging.vercel.app/api/docs/ui |

The raw OpenAPI spec (YAML) is served at `/api/docs`.

---

## Prerequisites

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

## Architecture overview

```
Smart Meter (Ed25519 keypair)
        │  POST /api/readings  { kwh, timestamp, signature_hex }
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

### Key data flows

| Flow | Entry point | Key files |
|------|-------------|-----------|
| Meter reading submission | `POST /api/readings` | `src/app/api/readings/route.ts` |
| Signature verification | `src/lib/crypto.ts` | `@noble/ed25519` |
| Stellar interactions | `src/lib/stellar.ts` | `@stellar/stellar-sdk` |
| Idempotency | `src/lib/idempotency.ts` | Upstash Redis |
| Certificate cache | `src/lib/cache.ts` | Upstash Redis |
| Structured logging | `src/lib/logger.ts` | Logtail / stdout |
| APM traces | `src/instrumentation.ts` | OpenTelemetry OTLP |

---

## 1. Clone and install

```bash
git clone https://github.com/katecatherinaa/solarproof.git
cd solarproof
pnpm install
```

---

## 2. Environment variables

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

For contract IDs, see [Deploying contracts locally](#4-deploying-contracts-locally) below, or ask a teammate for the shared testnet IDs.

---

## 3. Run the web app

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

---

## 4. Deploying contracts locally

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

## 5. Running tests

### Web — unit tests

```bash
# From repo root (Turborepo runs all packages)
pnpm test

# From apps/web only
cd apps/web
pnpm test          # vitest run (single pass)
pnpm test:watch    # vitest watch mode
```

### Web — lint and type-check

```bash
pnpm lint          # ESLint
pnpm type-check    # TypeScript (tsc --noEmit)
pnpm build         # Next.js production build
```

### Web — end-to-end tests

```bash
cd apps/web
pnpm e2e           # Playwright (requires running dev server)
```

### Contracts — unit tests

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

### Shared packages

```bash
cd packages/stellar
pnpm test
```

---

## 6. Simulate a meter reading end-to-end

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

---

## 7. Troubleshooting

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

---

## Project structure

```
solarproof/
├── apps/
│   ├── contracts/              # Soroban smart contracts (Rust)
│   │   ├── energy_token/       # SEP-41 certificate token (minter-gated)
│   │   ├── audit_registry/     # Immutable reading anchors
│   │   └── community_governance/ # Cooperative proposals + voting
│   └── web/                    # Next.js 15 app + API routes
│       ├── src/
│       │   ├── app/            # Next.js App Router pages + API routes
│       │   │   └── api/        # REST API (readings, certificates, meters…)
│       │   ├── lib/            # Shared utilities (stellar, crypto, cache…)
│       │   ├── components/     # React UI components
│       │   └── instrumentation.ts  # OpenTelemetry hook
│       └── e2e/                # Playwright end-to-end tests
├── packages/
│   └── stellar/                # Shared Stellar client utilities
├── scripts/                    # Meter simulation scripts
├── docs/                       # ADRs, deployment guide, API docs
└── supabase/                   # Migrations and seed data
```

See [CONTRIBUTING.md](../CONTRIBUTING.md) for commit conventions and PR workflow.
