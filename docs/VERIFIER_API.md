# Public Verifier API — Integration Guide

The SolarProof public verifier API lets regulators, auditors, and third-party systems verify renewable energy certificates programmatically — no account or API key required.

**Base URL:** `https://solarproof.vercel.app`

---

## Endpoints

### GET /api/verify

Retrieve the full chain of custody for a certificate by query parameter.

```
GET /api/verify?id=<identifier>
```

### GET /api/verify/{id}

Identical to the above but accepts the identifier as a path segment.

```
GET /api/verify/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

---

## Input

Both endpoints accept a single identifier that can be any of:

| Type | Format | Example |
|---|---|---|
| Certificate UUID | 36-character UUID | `a1b2c3d4-e5f6-7890-abcd-ef1234567890` |
| Reading hash | 64-character hex string | `4b3e9f…f09a` (64 chars) |
| Mint transaction hash | 64-character hex string | `8d1a2b…c3d4` (64 chars) |

The identifier is case-insensitive.

---

## Response

### 200 OK — Certificate found

```json
{
  "certificate": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "kwh": 12.5,
    "issued_at": "2026-04-23T00:00:00.000Z",
    "retired": false,
    "retired_at": null,
    "retired_by": null
  },
  "on_chain": {
    "anchor_tx": "8d1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a",
    "anchor_explorer": "https://stellar.expert/explorer/testnet/tx/8d1a2b...",
    "mint_tx": "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
    "mint_explorer": "https://stellar.expert/explorer/testnet/tx/1a2b3c...",
    "retirement_tx": null
  },
  "meter_proof": {
    "meter_id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "reading_hash": "4b3e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e",
    "signature_hex": "4b3e9f0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f09a",
    "kwh": 12.5,
    "timestamp": "2026-04-23T00:00:00.000Z",
    "verified": true
  }
}
```

#### Response fields

**`certificate`**

| Field | Type | Description |
|---|---|---|
| `id` | UUID string | Unique certificate identifier |
| `kwh` | number | Energy amount this certificate represents |
| `issued_at` | ISO 8601 datetime | When the certificate was minted |
| `retired` | boolean | `true` if permanently retired |
| `retired_at` | datetime \| null | When it was retired |
| `retired_by` | string \| null | Stellar address that retired it |

**`on_chain`**

| Field | Type | Description |
|---|---|---|
| `anchor_tx` | string | Stellar transaction hash of the reading anchor |
| `anchor_explorer` | URI | Link to view the anchor tx on Stellar Expert |
| `mint_tx` | string | Stellar transaction hash of the certificate mint |
| `mint_explorer` | URI | Link to view the mint tx on Stellar Expert |
| `retirement_tx` | string \| null | Present when the certificate has been retired |

**`meter_proof`** (may be `null` if the raw reading record is unavailable)

| Field | Type | Description |
|---|---|---|
| `meter_id` | UUID string | Registered device that generated the energy |
| `reading_hash` | 64-char hex | SHA-256 of the canonical reading payload |
| `signature_hex` | 128-char hex | Ed25519 signature produced by the meter |
| `kwh` | number | Energy recorded by the meter |
| `timestamp` | ISO 8601 datetime | When the meter reading was taken |
| `verified` | boolean | `true` — server confirmed the Ed25519 signature |

---

## Error responses

| HTTP status | `error` value | Meaning |
|---|---|---|
| `400 Bad Request` | `"id must be a UUID or 64-char hex hash"` | Identifier format is invalid |
| `404 Not Found` | `"Certificate not found"` | No certificate matches the identifier |

### 400 example

```json
{
  "error": {
    "fieldErrors": {},
    "formErrors": ["id must be a UUID or 64-char hex hash"]
  }
}
```

### 404 example

```json
{
  "error": "Certificate not found"
}
```

---

## Caching

Responses are cached in Redis for **60 seconds**.

| Header | Value |
|---|---|
| `Cache-Control` | `public, max-age=60, stale-while-revalidate=30` |
| `X-Cache` | `HIT` (served from cache) or `MISS` (freshly fetched) |

Integrations that need real-time data should check `X-Cache: MISS` or wait for the 60-second TTL to expire.

---

## Rate limits

The verification endpoints are public and require no account or API key, but they are rate limited to protect the service against scraping and abuse.

| Limit | Scope | Window |
|---|---|---|
| **30 requests** | Per client IP address | 1 minute (sliding) |

The limit is enforced in `middleware.ts` before the request reaches the verify handler. Both `GET /api/verify` and `GET /api/verify/{id}` share the same per-IP budget.

### Rate-limit headers

Every response from the verify endpoints includes:

| Header | Value | Description |
|---|---|---|
| `X-RateLimit-Limit` | `30` | Maximum requests allowed per window |
| `X-RateLimit-Remaining` | integer | Requests left in the current window |
| `X-RateLimit-Reset` | Unix timestamp (seconds) | When the current window resets |
| `Retry-After` | integer (seconds) | Present on `429` responses only |

### 429 Too Many Requests

When the limit is exceeded, the API responds with `429` and does not touch the certificate store:

```json
{
  "error": "Too many requests. Please retry after 42 seconds."
}
```

```
HTTP/1.1 429 Too Many Requests
Retry-After: 42
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1745366460
```

Clients should back off until `Retry-After` elapses (or `X-RateLimit-Reset` is reached) and retry with jitter. Repeated violations may result in longer blocks at the CDN level.

### Bot challenges (optional)

High-volume or automated deployments can enable a lightweight bot challenge — **Cloudflare Turnstile** or **hCaptcha** — in front of the verify endpoints. When enabled, requests must include a valid challenge token (for example the `cf-turnstile-response` header) in addition to the identifier; requests without a valid token receive `403 Forbidden`.

The challenge is disabled by default for the public verifier so that simple `curl` and scripted integrations keep working. If you operate a high-volume integration, contact the SolarProof team to arrange a dedicated allowance or a challenge-exempt token.

See [`docs/ABUSE_PROTECTION.md`](./ABUSE_PROTECTION.md) for the full threat model and mitigation details.

---

## Example requests

### curl

```bash
# By certificate UUID
curl "https://solarproof.vercel.app/api/verify?id=a1b2c3d4-e5f6-7890-abcd-ef1234567890"

# By reading hash (path parameter form)
curl "https://solarproof.vercel.app/api/verify/4b3e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e"
```

### JavaScript (fetch)

```js
async function verifyCertificate(id) {
  const res = await fetch(`https://solarproof.vercel.app/api/verify?id=${encodeURIComponent(id)}`)
  if (res.status === 404) throw new Error('Certificate not found')
  if (!res.ok) throw new Error(`Unexpected status ${res.status}`)
  return res.json()
}

const chain = await verifyCertificate('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
console.log(chain.certificate.kwh, 'kWh', chain.meter_proof?.verified ? '✓ verified' : '⚠ unverified')
```

### Python (requests)

```python
import requests

def verify_certificate(cert_id: str) -> dict:
    r = requests.get(
        "https://solarproof.vercel.app/api/verify",
        params={"id": cert_id},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()

chain = verify_certificate("a1b2c3d4-e5f6-7890-abcd-ef1234567890")
print(chain["certificate"]["kwh"], "kWh")
print("Verified:", chain["meter_proof"]["verified"] if chain["meter_proof"] else "N/A")
```

---

## Verifying the chain of custody manually

A genuine certificate will have all three sections populated:

1. **`certificate`** — valid UUID and positive `kwh`
2. **`on_chain`** — two Stellar transaction hashes you can independently verify at [stellar.expert](https://stellar.expert)
3. **`meter_proof.verified: true`** — the server confirmed the Ed25519 signature matches the registered meter public key

To independently verify the Ed25519 signature yourself:

```js
import { verifyAsync } from '@noble/ed25519'
import { createHash } from 'crypto'

// Reconstruct the canonical reading hash
function computeReadingHash(meterId, kwhStroops, timestampUnix) {
  const meterBytes = Buffer.from(meterId, 'utf8')
  const kwhBuf = Buffer.alloc(8); kwhBuf.writeBigInt64LE(kwhStroops)
  const tsBuf = Buffer.alloc(8); tsBuf.writeBigInt64LE(timestampUnix)
  return createHash('sha256').update(meterBytes).update(kwhBuf).update(tsBuf).digest()
}

const chain = await verifyCertificate('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
const proof = chain.meter_proof

// You need the meter's registered public key (from your own records or the /api/meters endpoint)
const meterPubkeyHex = '<64-char hex public key>'

const hash = computeReadingHash(
  proof.meter_id,
  BigInt(Math.round(proof.kwh * 1e7)),
  BigInt(Math.floor(new Date(proof.timestamp).getTime() / 1000))
)

const valid = await verifyAsync(
  Buffer.from(proof.signature_hex, 'hex'),
  hash,
  Buffer.from(meterPubkeyHex, 'hex')
)
console.log('Signature valid:', valid)
```

---

## OpenAPI reference

The full machine-readable specification is available at:

```
GET https://solarproof.vercel.app/api/docs
```

Interactive Swagger UI:

```
https://solarproof.vercel.app/api/docs/ui
```
