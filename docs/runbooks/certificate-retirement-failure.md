# Runbook: Certificate Retirement Failure Recovery

Covers diagnosing and resolving certificate retirement failures where the on-chain retire transaction succeeds but the Supabase off-chain state is not updated.

Resolves: [#87](https://github.com/katecatherinaa/solarproof/issues/87)

---

## Background

When a certificate is retired, the API:
1. Submits a `retire` call to the `energy_token` Soroban contract on Stellar
2. Records the retirement in the `certificate_retirements` table in Supabase with a `status` of `retired`
3. Updates the certificate's status in the `certificates` table to `retired`

A retirement failure in this runbook refers specifically to the scenario where step 1 succeeds (the on-chain burn/retire is confirmed) but steps 2 or 3 fail — leaving Supabase out of sync with the ledger. The certificate appears active in the database while it has already been retired on-chain.

Failed or incomplete retirements are recorded in the `certificate_retirements` table. Rows with `status = 'pending'` or `status = 'error'` that have a non-null `retire_tx_hash` are the key signal for this scenario.

---

## Step 1 — Identify the Inconsistent Record

```sql
-- Find retirements that have an on-chain tx hash but are not marked retired in Supabase
SELECT cr.id, cr.certificate_id, cr.retire_tx_hash, cr.status, cr.created_at, cr.error_message,
       c.status AS certificate_status
FROM certificate_retirements cr
JOIN certificates c ON c.id = cr.certificate_id
WHERE cr.retire_tx_hash IS NOT NULL
  AND (cr.status != 'retired' OR c.status != 'retired')
ORDER BY cr.created_at DESC
LIMIT 20;
```

A row appearing here means the on-chain transaction was submitted but Supabase was not updated to reflect it.

---

## Step 2 — Verify the On-Chain Retirement

Before making any database changes, confirm the transaction actually succeeded on-chain.

```bash
# Look up the transaction on Stellar Expert (testnet)
# Replace <retire_tx_hash> with the value from the query above
open "https://stellar.expert/explorer/testnet/tx/<retire_tx_hash>"

# Or use the Stellar CLI
stellar tx fetch --tx-hash <retire_tx_hash> --network testnet
```

Check that the transaction:
- Has `status: success`
- Includes a `retire` operation on the `energy_token` contract
- The `certificate_id` in the contract invocation matches the database record

If the transaction **failed or does not exist**, do not proceed with reconciliation — the on-chain state is not retired. Treat this as a standard retirement failure and re-submit via the API.

---

## Step 3 — Common Failure Causes

| Symptom | Likely cause | Resolution |
|---|---|---|
| `retire_tx_hash` present, `status = 'pending'` | API process crashed or timed out after on-chain submit | Reconcile Supabase (Step 4) |
| `retire_tx_hash` present, `status = 'error'`, `error_message` contains DB error | Supabase write failed (transient error, connection pool exhausted) | Reconcile Supabase (Step 4) |
| `retire_tx_hash` present, `status = 'error'`, `error_message` contains RPC timeout | Stellar RPC response not received before timeout, but tx may have landed | Verify on-chain (Step 2), then reconcile if confirmed (Step 4) |
| `certificates.status` not updated but `certificate_retirements.status = 'retired'` | Partial write — retirements table updated, certificates table update failed | Run targeted certificates update (Step 4b) |
| Duplicate `certificate_retirements` rows for same `certificate_id` | Retry logic submitted multiple retirement requests | Identify the successful tx and mark duplicates as `superseded` (Step 5) |

---

## Step 4 — Reconcile Supabase State

Only proceed after confirming the on-chain transaction succeeded in Step 2.

### Step 4a — Update the `certificate_retirements` table

```sql
UPDATE certificate_retirements
SET
  status        = 'retired',
  error_message = NULL,
  updated_at    = NOW()
WHERE id = '<retirement-id>'
  AND retire_tx_hash = '<retire_tx_hash>';
```

Verify the row was updated:
```sql
SELECT id, status, retire_tx_hash, updated_at
FROM certificate_retirements
WHERE id = '<retirement-id>';
```

### Step 4b — Update the `certificates` table

```sql
UPDATE certificates
SET
  status     = 'retired',
  retired_at = NOW(),
  updated_at = NOW()
WHERE id = '<certificate-id>'
  AND status != 'retired';
```

Verify:
```sql
SELECT id, status, retired_at FROM certificates WHERE id = '<certificate-id>';
```

---

## Step 5 — Handle Duplicate Retirement Records (if present)

If the same certificate has multiple `certificate_retirements` rows with a `retire_tx_hash`, identify the canonical successful transaction and suppress the duplicates.

```sql
-- Find duplicates
SELECT certificate_id, COUNT(*) AS count, array_agg(id ORDER BY created_at) AS retirement_ids
FROM certificate_retirements
WHERE certificate_id = '<certificate-id>'
GROUP BY certificate_id
HAVING COUNT(*) > 1;

-- Mark all but the canonical retirement as superseded
UPDATE certificate_retirements
SET status = 'superseded', updated_at = NOW()
WHERE certificate_id = '<certificate-id>'
  AND id != '<canonical-retirement-id>';
```

---

## Step 6 — Verify Full Resolution

After reconciliation, verify both the on-chain and off-chain states are consistent.

```sql
-- Confirm Supabase state
SELECT
  c.id           AS certificate_id,
  c.status       AS certificate_status,
  c.retired_at,
  cr.id          AS retirement_id,
  cr.status      AS retirement_status,
  cr.retire_tx_hash
FROM certificates c
JOIN certificate_retirements cr ON cr.certificate_id = c.id
WHERE c.id = '<certificate-id>';
```

Expected result:
- `certificate_status = 'retired'`
- `retirement_status = 'retired'`
- `retire_tx_hash` is non-null and matches the confirmed on-chain transaction

Confirm on-chain at:
```
https://stellar.expert/explorer/testnet/tx/<retire_tx_hash>
```

Finally, confirm the public verifier reflects the retirement:
```
https://solarproof.vercel.app/verify?cert=<certificate-id>
```

---

## Step 7 — Escalate if Unresolved

If the inconsistency cannot be resolved with the steps above:
1. Capture the `certificate_id`, `retirement_id`, `retire_tx_hash`, and any `error_message` values
2. Do **not** modify on-chain state — Stellar transactions are immutable
3. Open an incident (see [incident-response.md](incident-response.md))
4. Check Stellar network status at https://status.stellar.org
5. Review application logs for the retirement request to trace where the failure occurred (look for the `retire_certificate` log context)
6. Escalate to the on-call engineer if the certificate owner is waiting on confirmation — provide them the `retire_tx_hash` as proof of on-chain retirement while the DB is reconciled
