# I-REC Bridge Integration Guide — Cooperative Operator

> **Audience:** Cooperative operators who have deployed the SolarProof I-REC bridge and want to register their devices, submit monthly batches to Evident, and diagnose common API errors.  
> **Background research:** [IREC_ENERGYWEB_INTEROP.md](./IREC_ENERGYWEB_INTEROP.md)  
> **Status:** This guide tracks the bridge implementation. Review it against the running bridge before onboarding new cooperatives.

---

## Overview

The SolarProof I-REC bridge acts as a **Measurement, Reporting and Verification (MRV) data provider**. It aggregates your SolarProof kWh readings into monthly MWh batches and submits them to the [Evident registry](https://www.trackingstandard.org/product-code/electricity/) via the Evident REST API, where an accredited I-REC Issuer mints the resulting I-REC(E) certificates.

```
SolarProof meters (kWh readings, Ed25519 signed)
        │
        ▼
SolarProof API  (audit_registry anchor on Stellar)
        │
        ▼
I-REC Bridge  (POST /api/irec/submit-batch)
  1. Aggregate readings per device per month → MWh
  2. Upload MRV document URL (SolarProof /verify link)
  3. POST to Evident API → issuance request
        │
        ▼
Evident Registry  (I-REC(E) certificates minted by accredited Issuer)
        │
        ▼
SolarProof certificate record  (irec_certificate_id stored, shown on /verify)
```

---

## Prerequisites

Before using the bridge you must have:

1. **An Evident account** — Register at [evident.energy](https://evident.energy) as a **Registrant** (cooperative entity). This requires submitting legal documentation of your cooperative. Allow 5–10 business days for approval.

2. **An accredited I-REC Issuer** in your country — SolarProof cannot mint I-RECs directly; an accredited Issuer must approve and mint certificates on your behalf. Contact the [I-TRACK Foundation](https://www.trackingstandard.org) for a list of Issuers by country.

3. **Evident API credentials** — Once your Evident account is approved, generate an OAuth client ID and secret from **Evident Portal → Settings → API Access**.

4. **Bridge environment variables** — Set the following in `apps/web/.env.local` (never commit these):

   ```env
   EVIDENT_CLIENT_ID=your-client-id
   EVIDENT_CLIENT_SECRET=your-client-secret
   EVIDENT_API_URL=https://api.evident.energy/v1   # production
   # EVIDENT_API_URL=https://api-sandbox.evident.energy/v1  # sandbox for testing
   EVIDENT_REGISTRANT_ID=your-registrant-account-id
   ```

5. **Device fields in your cooperative record** — Each meter that will have I-RECs issued must have the following fields populated in the `meters` table (via the API or Supabase dashboard):

   | Field | Description | Example |
   |---|---|---|
   | `irec_device_id` | Unique I-REC device identifier (assigned by Evident after device registration) | `DEV-001-GBR` |
   | `country` | ISO 3166-1 alpha-2 country code | `GB` |
   | `fuel_type` | Energy source type | `Solar` |
   | `technology` | Technology sub-type | `Photovoltaic` |
   | `capacity_kw` | Installed capacity in kW | `10.5` |
   | `commission_date` | ISO date of commissioning | `2025-03-01` |
   | `latitude` | Device latitude (decimal degrees) | `51.5074` |
   | `longitude` | Device longitude (decimal degrees) | `-0.1278` |

---

## Step 1 — Register a Device with Evident

Before your first batch submission you must register each solar installation as a **device** in the Evident registry. This is a one-time step per device.

### 1a. Prepare the device registration payload

Collect the required fields from the Prerequisites table above. The `irec_device_id` is assigned by Evident *after* registration — you will store it back on your meter record once received.

### 1b. Call the bridge device registration endpoint

```bash
curl -X POST https://solarproof.vercel.app/api/irec/register-device \
  -H "Authorization: Bearer <your-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "meter_id": "<your-meter-uuid>",
    "country": "GB",
    "fuel_type": "Solar",
    "technology": "Photovoltaic",
    "capacity_kw": 10.5,
    "commission_date": "2025-03-01",
    "latitude": 51.5074,
    "longitude": -0.1278
  }'
```

**Expected response (201)**

```json
{
  "irec_device_id": "DEV-001-GBR",
  "status": "pending_issuer_approval"
}
```

The device status will be `pending_issuer_approval` until your accredited Issuer approves it in the Evident portal. You will receive an email confirmation from Evident.

### 1c. Store the returned `irec_device_id`

Once you receive the `irec_device_id`, the bridge stores it automatically on the meter record. You can verify it via:

```bash
curl https://solarproof.vercel.app/api/v1/meters/<meter-uuid> \
  -H "Authorization: Bearer <your-jwt>"
```

Look for `"irec_device_id": "DEV-001-GBR"` in the response.

---

## Step 2 — Trigger a Batch Submission

The bridge aggregates all verified SolarProof readings for a given device and calendar month into a single MWh figure, then submits an issuance request to Evident.

### 2a. Ensure all readings for the month are anchored

Before submitting a batch, confirm that all readings for the target month are in `verified` status (Ed25519 signature confirmed and hash anchored on Stellar). Use the cooperative stats endpoint to check:

```bash
curl "https://solarproof.vercel.app/api/v1/cooperative/stats?granularity=month&date_from=2026-09-01T00:00:00.000Z&date_to=2026-09-30T23:59:59.000Z" \
  -H "Authorization: Bearer <your-jwt>"
```

Confirm `meter_stats[].readings_count` matches your expected reading count for the month.

### 2b. Submit the batch

```bash
curl -X POST https://solarproof.vercel.app/api/irec/submit-batch \
  -H "Authorization: Bearer <your-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "meter_id": "<your-meter-uuid>",
    "period_start": "2026-09-01T00:00:00.000Z",
    "period_end": "2026-09-30T23:59:59.000Z"
  }'
```

The bridge will:

1. Aggregate all verified readings for the device in the given period into total MWh (`total_kwh / 1000`).
2. Construct the MRV document URL (a SolarProof `/verify` link covering the period).
3. POST the issuance request to Evident.
4. Store the returned `irec_request_id` on the SolarProof certificate records.

**Expected response (202 Accepted)**

```json
{
  "irec_request_id": "IREQ-2026-09-GBR-001",
  "total_mwh": 4.21,
  "readings_included": 168,
  "period_start": "2026-09-01T00:00:00.000Z",
  "period_end": "2026-09-30T23:59:59.000Z",
  "mrv_document_url": "https://solarproof.vercel.app/verify?batch=..."
}
```

### 2c. Monitor issuance status

Evident typically processes issuance requests within 1–3 business days. Poll the status:

```bash
curl "https://solarproof.vercel.app/api/irec/batch-status?request_id=IREQ-2026-09-GBR-001" \
  -H "Authorization: Bearer <your-jwt>"
```

**Response**

```json
{
  "irec_request_id": "IREQ-2026-09-GBR-001",
  "status": "issued",
  "irec_certificate_ids": ["IREC-GB-2026-09-001", "IREC-GB-2026-09-002"],
  "issued_at": "2026-10-02T14:00:00.000Z"
}
```

Possible statuses: `pending` · `processing` · `issued` · `rejected`

Once `issued`, the `irec_certificate_ids` are stored on the SolarProof certificates and displayed on the public `/verify` page.

---

## Step 3 — Verify the Cross-Reference

After issuance, buyers can independently verify the link between a SolarProof certificate and its I-REC:

1. Navigate to `https://solarproof.vercel.app/verify?id=<cert-id>`.
2. Scroll to the **I-REC** section — it shows the `irec_certificate_id` and a direct link to the Evident registry entry.
3. Buyers can cross-check the Evident ID on the [I-TRACK Evident portal](https://www.trackingstandard.org) to confirm the I-REC was not double-redeemed.

---

## Troubleshooting — Common Evident API Errors

| HTTP Status | Evident error code | Cause | Resolution |
|---|---|---|---|
| `400 Bad Request` | `DEVICE_NOT_FOUND` | The `irec_device_id` does not exist in Evident | Verify the device ID with `GET /api/irec/device-status?meter_id=<uuid>`. Re-register if missing. |
| `400 Bad Request` | `INVALID_PERIOD` | `period_start` or `period_end` is malformed or the period exceeds one calendar month | Use ISO 8601 datetimes. Ensure `period_end` is at most the last instant of the same month as `period_start`. |
| `400 Bad Request` | `VOLUME_BELOW_MINIMUM` | Total MWh for the period is less than 0.001 MWh (1 kWh) | Aggregate more readings before submitting. I-REC(E) certificates are issued in whole MWh; sub-MWh volumes are rounded down. |
| `401 Unauthorized` | `INVALID_TOKEN` | OAuth access token expired or revoked | The bridge auto-refreshes tokens; if this persists, check `EVIDENT_CLIENT_ID` and `EVIDENT_CLIENT_SECRET` are current. |
| `403 Forbidden` | `DEVICE_PENDING_APPROVAL` | The device is registered but not yet approved by the Issuer | Contact your accredited Issuer and ask them to approve the device in the Evident portal. |
| `403 Forbidden` | `REGISTRANT_SUSPENDED` | Your Evident registrant account is suspended | Contact Evident support at [support@evident.energy](mailto:support@evident.energy). |
| `409 Conflict` | `DUPLICATE_SUBMISSION` | A batch for this device + period was already submitted | Retrieve the existing request ID via `GET /api/irec/batch-status?meter_id=<uuid>&period=2026-09`. Do not resubmit. |
| `422 Unprocessable Entity` | `MRV_DOCUMENT_UNREACHABLE` | Evident cannot reach the MRV document URL | Ensure `https://solarproof.vercel.app/verify?batch=...` is publicly accessible. Check Vercel deployment status. |
| `429 Too Many Requests` | `RATE_LIMIT_EXCEEDED` | More than 60 API calls per minute to Evident | The bridge applies exponential back-off automatically. If you see this in logs, check for runaway batch jobs. |
| `500 Internal Server Error` | `EVIDENT_INTERNAL_ERROR` | Transient Evident platform error | Retry after 15 minutes. If the error persists beyond 1 hour, contact Evident support with the `X-Request-Id` from the response header. |

### Bridge-side errors (not Evident API)

| Error message | Cause | Resolution |
|---|---|---|
| `"No verified readings found for period"` | No readings in the requested period have `anchor_tx_hash` set | Confirm readings were anchored on Stellar. Check `GET /api/v1/cooperative/stats` for the period. |
| `"irec_device_id not set on meter"` | Device not yet registered with Evident | Complete Step 1 above. |
| `"EVIDENT_CLIENT_ID not configured"` | Bridge env vars missing | Set `EVIDENT_CLIENT_ID` and `EVIDENT_CLIENT_SECRET` in your environment. |
| `"Batch already submitted for this period"` | Idempotency guard triggered | Retrieve the existing request with `GET /api/irec/batch-status`. Do not resubmit. |

---

## Granularity note

I-REC(E) certificates are issued per **MWh**. SolarProof meters report per reading (sub-kWh precision). The bridge automatically:

1. Aggregates all `verified` readings for the device + period into a total kWh figure.
2. Converts to MWh (`total_kwh / 1000`), rounded to 3 decimal places.
3. Reports this as the `volume` in the Evident issuance request.

If your cooperative's monthly generation is under 1 MWh, the bridge will submit a fractional MWh. Some Issuers round down to the nearest whole MWh — check with your Issuer's policy.

---

## References

- [IREC_ENERGYWEB_INTEROP.md](./IREC_ENERGYWEB_INTEROP.md) — technical research and gap analysis
- [API.md](./API.md) — SolarProof v1 API reference
- [Evident API Integration Guidance](https://www.trackingstandard.org/guidance-for-api-integration-with-evident-registry-for-i-rece/)
- [I-REC(E) Product Code](https://www.trackingstandard.org/product-code/electricity/)
- [I-TRACK Foundation](https://www.trackingstandard.org/the-standard/)
