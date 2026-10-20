# Runbook: Minter Key Rotation Before Mainnet Launch

> Resolves #111  
> Status: **REQUIRED** — must be completed and signed off before any mainnet deployment.

This runbook covers generating a fresh Ed25519 minter keypair in an HSM,
deactivating the old testnet key, storing the new key in the production secret
manager, and confirming no old key material remains in the repository.

---

## Background

The testnet minter key has been used during development and may be known to
contributors. Using it on mainnet would expose the minting authority to anyone
who observed it in logs, environment files, or git history.

A fresh key **must** be generated in an HSM (Hardware Security Module), never
on a developer workstation, before mainnet launch.

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| HSM or hardware wallet access | YubiKey 5 Series (PIV), AWS CloudHSM, or GCP Cloud HSM are all acceptable. See [HSM_INTEGRATION.md](../HSM_INTEGRATION.md) for setup. |
| Production secret manager | AWS Secrets Manager, GCP Secret Manager, or HashiCorp Vault configured for the production environment. |
| `stellar-sdk` CLI or Stellar Laboratory | For verifying the new key on Stellar testnet before cutover. |
| `gh` CLI authenticated | Required for secret scanning confirmation step. |
| Authorized sign-off | Requires approval from two project leads before cutover (see sign-off section). |

---

## Step 1 — Generate new minter keypair in HSM

**NEVER generate production keys on a developer workstation.**

### Option A — YubiKey 5 (PIV slot, Ed25519)

```bash
# Generate Ed25519 key in PIV slot 9c (Digital Signature)
yubico-piv-tool -a generate -s 9c -A ECCP256
# For Ed25519 support, use the ECDSA P-256 slot or use ykman:
ykman piv keys generate --algorithm ED25519 9c pubkey-minter-new.pem
```

Extract the public key for Stellar (convert PEM → 32-byte raw → base32 Stellar address):

```bash
openssl pkey -in pubkey-minter-new.pem -pubin -text -noout
# Copy the raw 32-byte public key bytes, then:
node -e "
const { Keypair } = require('@stellar/stellar-sdk');
const rawPub = Buffer.from('<32-byte-hex-from-pem>', 'hex');
// Stellar Ed25519 address is base32(version_byte || raw_pub || checksum)
console.log(Keypair.fromRawEd25519Seed(rawPub).publicKey());
"
```

### Option B — AWS CloudHSM / GCP Cloud HSM

Follow the provider-specific guide in [HSM_INTEGRATION.md](../HSM_INTEGRATION.md).
The output must be a 32-byte raw Ed25519 public key and a key handle (not the
private key bytes — those must never leave the HSM).

### Option C — Stellar Laboratory (staging pre-check only)

Use Stellar Laboratory **only** for staging/testnet pre-checks.
Never use it to generate a mainnet key.

---

## Step 2 — Store the new key in the production secret manager

The private key (or HSM key handle) must be stored in the production secret
manager, not in `.env` files, GitHub repository secrets, or any code.

### AWS Secrets Manager

```bash
aws secretsmanager create-secret \
  --name "solarproof/mainnet/minter-secret-key" \
  --description "SolarProof mainnet minter Ed25519 private key" \
  --secret-string '{"MINTER_SECRET_KEY":"<stellar-secret-key-Sxxx>"}'
```

### GCP Secret Manager

```bash
echo -n "S<stellar-secret-key>" | \
  gcloud secrets create solarproof-mainnet-minter-key \
    --data-file=- \
    --replication-policy="automatic"
```

### Vercel (production environment variable)

```bash
vercel env add MINTER_SECRET_KEY production
# Paste the new Stellar secret key when prompted.
# Verify it does NOT appear in the output or logs.
```

**Verification:** Confirm the secret is accessible by the production deployment
without printing its value:

```bash
vercel env ls production | grep MINTER_SECRET_KEY
# Should list the variable name without its value.
```

---

## Step 3 — Update deployment configuration

1. Update the production deployment environment to pull `MINTER_SECRET_KEY` from
   the secret manager instead of any hardcoded or `.env`-sourced value.

2. If the Stellar contract has the old minter key registered as an authorized
   signer, invoke the admin function to rotate it:

   ```bash
   # Using the Stellar CLI (soroban):
   stellar contract invoke \
     --id <AUDIT_REGISTRY_CONTRACT_ID> \
     --source <ADMIN_KEY_NAME> \
     --network mainnet \
     -- set_api_signer \
     --new_signer <NEW_MINTER_PUBLIC_KEY_HEX>
   ```

3. Confirm the new key is authorized on-chain:

   ```bash
   stellar contract invoke \
     --id <AUDIT_REGISTRY_CONTRACT_ID> \
     --source <ADMIN_KEY_NAME> \
     --network mainnet \
     -- api_signer_query
   # Output must be the new public key hex.
   ```

---

## Step 4 — Deactivate and revoke the old testnet key

1. **Remove from secret manager / environment:**  
   Delete or disable the old `MINTER_SECRET_KEY` in every environment
   (staging, production, CI).

2. **Revoke on Stellar (if applicable):**  
   If the old key was set as `api_signer` on testnet contracts, rotate it away:

   ```bash
   stellar contract invoke \
     --id <TESTNET_AUDIT_REGISTRY_ID> \
     --source <ADMIN_KEY_NAME> \
     --network testnet \
     -- set_api_signer \
     --new_signer <NEW_OR_PLACEHOLDER_PUBLIC_KEY_HEX>
   ```

3. **Revoke GitHub Actions secrets** (if the old key was ever stored there):

   ```bash
   gh secret delete MINTER_SECRET_KEY --repo katecatherinaa/solarproof
   # Then add the new value (if GitHub Actions still needs it for CI):
   gh secret set MINTER_SECRET_KEY --repo katecatherinaa/solarproof
   ```

4. Mark the old Stellar account as deactivated in the internal key registry.
   Do not fund or use it going forward.

---

## Step 5 — Secret scanning confirmation

Run secret scanning to verify no old key material remains in the repository
history or current tree.

### TruffleHog (existing CI tool)

```bash
# Scan entire git history for the old Stellar secret key prefix
docker run --rm -v "$(pwd):/repo" \
  trufflesecurity/trufflehog:latest \
  git file:///repo --only-verified
```

### gitleaks (via pre-commit hook or manual run)

```bash
gitleaks detect --source . --verbose
```

### Manual check for Stellar secret key pattern

Stellar secret keys start with `S` and are 56 characters (base32). Search for
any `S[A-Z2-7]{55}` pattern:

```bash
git log --all -p | grep -E '\bS[A-Z2-7]{55}\b' | head -20
# Must return zero matches for the OLD key.
```

If matches are found:

1. Do **not** force-push to rewrite history on a shared branch.
2. Open a security incident per [SECURITY_INCIDENT_PLAYBOOK.md](../SECURITY_INCIDENT_PLAYBOOK.md).
3. Rotate the key immediately (treat it as compromised).
4. Use `git filter-repo` or BFG Repo-Cleaner to scrub history **after**
   coordinating with all active contributors.

---

## Step 6 — Smoke test with new key

Before cutover, verify end-to-end on the staging environment using the new key:

```bash
# 1. Submit a test reading via the API
curl -X POST https://staging.solarproof.io/api/readings \
  -H "Content-Type: application/json" \
  -H "x-api-key: <staging-meter-api-key>" \
  -d '{ ... valid reading payload ... }'
# Expect: 202 Accepted with { reading_id, job_id }

# 2. Check that the reading was anchored and a certificate was minted
# Wait for the anchor_and_mint job to process, then:
curl https://staging.solarproof.io/api/verify/<reading_id>
# Expect: { anchored: true, minted: true, anchor_tx_hash: "...", mint_tx_hash: "..." }
```

---

## Sign-off Checklist

Complete every item and have two project leads sign off before cutover.

| # | Item | Completed by | Date |
|---|------|-------------|------|
| 1 | New minter keypair generated **in HSM** (not on workstation) | | |
| 2 | Private key / key handle stored in production secret manager | | |
| 3 | `MINTER_SECRET_KEY` removed from all `.env` files and GitHub secrets | | |
| 4 | Old testnet key deactivated in Stellar contract (`set_api_signer` called) | | |
| 5 | Old testnet key revoked in all CI/CD environments | | |
| 6 | Secret scanning passes (TruffleHog + gitleaks — zero matches for old key) | | |
| 7 | Staging smoke test passes with new key (202 + anchor verified) | | |
| 8 | On-chain `api_signer_query` returns new public key | | |

**Lead 1 sign-off:** _____________________________ Date: ____________

**Lead 2 sign-off:** _____________________________ Date: ____________

---

## Rollback Plan

If the new key causes minting failures after cutover:

1. Immediately revert `MINTER_SECRET_KEY` in the secret manager to the previous
   value (kept in a versioned secret until the cool-down window closes).
2. Invoke `set_api_signer` to restore the previous authorized signer on-chain.
3. Investigate failure root cause before re-attempting rotation.
4. Do **not** use the old testnet key on mainnet — generate a new one.

---

## References

- [HSM_INTEGRATION.md](../HSM_INTEGRATION.md)
- [SECRETS_ROTATION.md](../SECRETS_ROTATION.md)
- [MAINNET_CHECKLIST.md](../MAINNET_CHECKLIST.md) — Phase 3 (Infrastructure & Key Management)
- [SECURITY_INCIDENT_PLAYBOOK.md](../SECURITY_INCIDENT_PLAYBOOK.md)
- [CONTRACT_ACCOUNT_ROTATION.md](../CONTRACT_ACCOUNT_ROTATION.md)
