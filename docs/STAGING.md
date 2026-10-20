# Staging Environment

SolarProof maintains a staging environment that mirrors production to catch regressions before they reach users.

## Architecture

| Concern | Staging | Production |
|---|---|---|
| Deployment platform | Vercel (separate project) | Vercel |
| Stellar network | **Testnet** | Mainnet |
| Database | Separate Supabase project | Production Supabase project |
| Minter key | Testnet keypair (disposable) | AWS Secrets Manager ARN |
| URL | `https://solarproof-staging.vercel.app` | `https://solarproof.vercel.app` |
| Branch | `develop` | `main` |

## Deployment pipeline

```
Push to develop
      │
      ▼
[test] pnpm test (with Redis service)
      │ passes
      ▼
[deploy-staging] vercel deploy → staging Vercel project
      │
      ▼
[health check] GET /api/health → must return 200 (5 retries)
      │ passes
      ▼
Staging URL posted to GitHub Actions summary
```

Production uses a separate blue-green pipeline (`.github/workflows/blue-green-deploy.yml`) triggered on pushes to `main`.

## Setting up the staging environment

### 1. Create a Vercel staging project

```bash
# In the Vercel dashboard, create a new project linked to this repo.
# Name it "solarproof-staging" (separate from the production project).
# Note the project ID — you will need VERCEL_PROJECT_ID_STAGING.
```

### 2. Create a Supabase staging project

1. Create a new Supabase project at https://supabase.com/dashboard.
2. Run migrations: `supabase db push --db-url <staging-db-url>` or apply them manually.
3. Note the URL, anon key, and service-role key.

### 3. Deploy staging contracts to Stellar Testnet

```bash
cd apps/contracts
stellar contract build

# Fund a staging deployer account
stellar keys generate staging-deployer --network testnet
stellar keys fund staging-deployer --network testnet

# Deploy
TOKEN_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/energy_token.wasm \
  --source staging-deployer --network testnet)

REGISTRY_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/audit_registry.wasm \
  --source staging-deployer --network testnet)

GOV_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/community_governance.wasm \
  --source staging-deployer --network testnet)
```

Record the IDs in `docs/deployments.md`.

### 4. Configure GitHub Actions secrets

Under **Settings → Environments → staging**, add:

| Secret | Value |
|---|---|
| `VERCEL_TOKEN` | Your Vercel personal access token |
| `VERCEL_ORG_ID` | Your Vercel team/org ID |
| `VERCEL_PROJECT_ID_STAGING` | Staging Vercel project ID |
| `STAGING_SUPABASE_URL` | Staging Supabase URL |
| `STAGING_SUPABASE_ANON_KEY` | Staging anon key |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` | Staging service-role key |
| `STAGING_MINTER_SECRET_KEY` | Testnet Stellar secret key |
| `STAGING_ENERGY_TOKEN_ID` | Testnet contract ID |
| `STAGING_AUDIT_REGISTRY_ID` | Testnet contract ID |
| `STAGING_COMMUNITY_GOVERNANCE_ID` | Testnet contract ID |

### 5. Configure Vercel staging project environment variables

In the Vercel staging project's **Settings → Environment Variables**, set the same values. Vercel stores them encrypted and injects them at build/runtime.

## Local staging simulation

```bash
cp apps/web/.env.staging.example apps/web/.env.staging.local
# Fill in your staging values
NODE_ENV=production pnpm --filter web start
```

## Smoke testing staging

```bash
# After a staging deploy, run the smoke test script against the staging URL
SOLARPROOF_URL=https://solarproof-staging.vercel.app node scripts/smoke-test.mjs
```

## Promoting to production

Merge `develop` → `main`. The blue-green deploy workflow (`deploy-contracts.yml`, `blue-green-deploy.yml`) takes over automatically.

---

## Config drift detection

A weekly CI job (`.github/workflows/config-drift.yml`) runs every Monday at 06:00 UTC to detect drift between staging and production. It checks:

1. **Stellar network** — staging must use `testnet`, production must use `mainnet`
2. **Required env var keys** — all keys in `.env.staging.example` must be present and up to date
3. **Supabase migrations** — all migration files must have corresponding rollback scripts
4. **Deploy pipeline config** — `deploy-staging.yml` targets `develop`, `blue-green-deploy.yml` targets `main`

Run it manually at any time:
```
Actions → Staging Config Drift Check → Run workflow
```

### Current parity state

| Concern | Staging | Production | Status |
|---|---|---|---|
| Stellar network | Testnet | Mainnet | ✅ Correct |
| Contract addresses | Testnet IDs (see `docs/deployments.md`) | Mainnet IDs | ✅ Separate |
| Supabase project | Dedicated staging project | Production project | ✅ Separate |
| Minter key | Testnet disposable keypair | AWS Secrets Manager ARN | ✅ Separate |
| Required env vars | Documented in `.env.staging.example` | Documented in `.env.example` | ✅ In sync |
| Branch | `develop` | `main` | ✅ Correct |

> If the drift check job fails, review the job summary for details and open a PR to resolve the inconsistency.
