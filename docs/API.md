# API Reference

Base URL: `https://solarproof.vercel.app` (production) · `http://localhost:3000` (local)

All responses are JSON. Timestamps are ISO 8601 strings unless noted.

---

## Authentication

Endpoints that accept meter readings require an **Ed25519 signature** produced by the registered meter device. The signature is passed in the request body as `signature_hex` — there are no HTTP-level API keys or bearer tokens for this endpoint.

The `GET /api/verify` and `GET /api/health` endpoints are **public** and require no authentication.

---

## Endpoints

### POST /api/readings

Submit a signed meter reading. The server verifies the Ed25519 signature, anchors the reading hash on Stellar, and mints energy certificates.

**Request body**

| Field | Type | Description |
|---|---|---|
| `meter_id` | `string` (UUID) | Registered meter identifier |
| `kwh` | `number` | Energy generated (positive, kWh) |
| `timestamp` | `number` | Unix timestamp in seconds (integer) |
| `signature_hex` | `string` (128 hex chars) | Ed25519 signature of the canonical reading hash, hex-encoded (64 bytes) |

**Canonical reading hash**

The signature must cover the hash produced by `computeReadingHash(meter_id, kwhStroops, BigInt(timestamp))` where `kwhStroops = kwh × 10_000_000`. See [`apps/web/src/lib/crypto.ts`](../apps/web/src/lib/crypto.ts) and [`scripts/send-reading.mjs`](../scripts/send-reading.mjs) for the reference implementation.

**Example request**

```http
POST /api/readings
Content-Type: application/json

{
  "meter_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "kwh": 12.5,
  "timestamp": 1745366400,
  "signature_hex": "4b3e...f09a"
}
```

**Responses**

| Status | Meaning | Body |
|---|---|---|
| `201 Created` | Reading accepted, anchored, and certificates minted | `{ reading_id, anchor_tx_hash, mint_tx_hash }` |
| `400 Bad Request` | Validation failed | `{ error: { fieldErrors, formErrors } }` |
| `401 Unauthorized` | Ed25519 signature invalid | `{ error: "Invalid meter signature" }` |
| `404 Not Found` | `meter_id` not registered or inactive | `{ error: "Meter not found or inactive" }` |
| `500 Internal Server Error` | Anchor or mint failed | `{ error: string, reading_id: string, anchor_tx_hash?: string }` |

**201 response body**

```json
{
  "reading_id": "uuid",
  "anchor_tx_hash": "stellar-tx-hash",
  "mint_tx_hash": "stellar-tx-hash"
}
```

---

### GET /api/verify

Retrieve the full chain of custody for a certificate. Accepts a certificate ID, reading hash, or mint transaction hash.

**Query parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | ✅ | Certificate UUID, reading hash (hex), or mint transaction hash |

**Example request**

```http
GET /api/verify?id=a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

**Responses**

| Status | Meaning |
|---|---|
| `200 OK` | Certificate found — returns chain of custody |
| `400 Bad Request` | `id` parameter missing |
| `404 Not Found` | No certificate matches the given `id` |

**200 response body**

```json
{
  "certificate": {
    "id": "uuid",
    "kwh": 12.5,
    "issued_at": "2026-04-23T00:00:00.000Z",
    "retired": false,
    "retired_at": null,
    "retired_by": null
  },
  "on_chain": {
    "anchor_tx": "stellar-tx-hash",
    "anchor_explorer": "https://stellar.expert/explorer/testnet/tx/<hash>",
    "mint_tx": "stellar-tx-hash",
    "mint_explorer": "https://stellar.expert/explorer/testnet/tx/<hash>"
  },
  "meter_proof": {
    "meter_id": "uuid",
    "reading_hash": "hex-string",
    "signature_hex": "128-char-hex",
    "kwh": 12.5,
    "timestamp": "2026-04-23T00:00:00.000Z",
    "verified": true
  }
}
```

`meter_proof` is `null` if the associated reading record cannot be found.

---

### GET /api/ws/readings

**Not implemented.** This route currently responds with `501 Not Implemented` JSON; it does not accept WebSocket upgrades or publish events. Real-time certificate alerts require a WebSocket-capable event service or an authorized Supabase Realtime subscription before the frontend can receive issuance, failure, and retirement notifications. The event source and payload contract must be defined before a client integration can be implemented. See [issue #11](https://github.com/katecatherinaa/solarproof/issues/11).

---

### GET /api/health

Liveness check used by uptime monitoring.

**No parameters.**

**Responses**

| Status | Body |
|---|---|
| `200 OK` | `{ "status": "ok", "ts": <unix-ms> }` |

---

## Error format

All error responses follow this shape:

```json
{ "error": "human-readable message" }
```

Validation errors from `POST /api/readings` return a Zod flatten structure:

```json
{
  "error": {
    "fieldErrors": { "kwh": ["Expected number, received string"] },
    "formErrors": []
  }
}
```

---

## Error codes

| HTTP Status | Cause |
|---|---|
| `400` | Missing or invalid request parameters |
| `401` | Ed25519 signature verification failed |
| `404` | Resource (meter or certificate) not found |
| `500` | Upstream failure: Supabase write, Stellar anchor, or certificate mint |

---

## v1 API endpoints (`/api/v1/`)

All routes under `/api/v1/` are aliases of the corresponding unversioned routes and behave identically. The `/api/v1/` prefix is provided for forward-compatibility.

Base URL prefix: `/api/v1`

---

### Authentication (JWT)

Most `/api/v1/` routes (meters, certificates, cooperative, governance) require a **Bearer JWT** issued at login.

```
Authorization: Bearer <jwt>
```

Obtain a JWT via `POST /api/v1/auth/login`.

---

### POST /api/v1/auth/login

Exchange email + password for a JWT.

**Request body**

| Field | Type | Description |
|---|---|---|
| `email` | `string` | Operator email address |
| `password` | `string` | Account password |

**Example request**

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "admin@coop.example",
  "password": "s3cr3t!"
}
```

**Responses**

| Status | Body |
|---|---|
| `200 OK` | `{ "access_token": "<jwt>", "token_type": "Bearer", "expires_in": 3600 }` |
| `400 Bad Request` | `{ "error": { "fieldErrors": {...}, "formErrors": [] } }` |
| `401 Unauthorized` | `{ "error": "Invalid credentials" }` |
| `500 Internal Server Error` | `{ "error": "<message>" }` |

---

### POST /api/v1/auth/logout

Invalidate the current session token. Requires a valid Bearer JWT.

**Example request**

```http
POST /api/v1/auth/logout
Authorization: Bearer <jwt>
```

**Responses**

| Status | Body |
|---|---|
| `200 OK` | `{ "message": "Logged out" }` |
| `401 Unauthorized` | `{ "error": "Unauthorized" }` |

---

### POST /api/v1/auth/refresh

Refresh an expiring JWT.

**Example request**

```http
POST /api/v1/auth/refresh
Authorization: Bearer <expired-or-near-expiry-jwt>
```

**Responses**

| Status | Body |
|---|---|
| `200 OK` | `{ "access_token": "<new-jwt>", "expires_in": 3600 }` |
| `401 Unauthorized` | `{ "error": "Invalid or expired token" }` |

---

### GET /api/v1/meters

List all meters belonging to the authenticated cooperative.

**Auth:** Bearer JWT required.

**Example request**

```http
GET /api/v1/meters
Authorization: Bearer <jwt>
```

**200 response body**

```json
[
  {
    "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "name": "Roof Panel A",
    "serial_number": "METER-001",
    "pubkey_hex": "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
    "active": true,
    "created_at": "2026-01-15T10:00:00.000Z",
    "cooperative_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "meter_group": "rooftop",
    "tags": ["phase-1", "south-facing"]
  }
]
```

**Responses**

| Status | Meaning |
|---|---|
| `200 OK` | Array of meter objects |
| `401 Unauthorized` | Missing or invalid JWT |
| `500 Internal Server Error` | Database error |

---

### POST /api/v1/meters

Register a new meter for the authenticated cooperative.

**Auth:** Bearer JWT required.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | ✅ | Human-readable label (max 128 chars) |
| `serial_number` | `string` | ✅ | Unique device serial number (max 64 chars) |
| `pubkey_hex` | `string` | ✅ | Ed25519 public key — exactly 64 hex chars (32 bytes) |
| `meter_group` | `string` | ✗ | Logical group label (max 64 chars) |
| `tags` | `string[]` | ✗ | Array of tag strings (each max 32 chars) |

> **Note:** Individual accounts are limited to 1 meter. Cooperative accounts may register unlimited meters.

**Example request**

```http
POST /api/v1/meters
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "name": "Roof Panel A",
  "serial_number": "METER-001",
  "pubkey_hex": "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
  "meter_group": "rooftop",
  "tags": ["phase-1", "south-facing"]
}
```

**Responses**

| Status | Meaning | Body |
|---|---|---|
| `201 Created` | Meter registered | Full meter object including one-time `api_key` |
| `400 Bad Request` | Validation failed | `{ "error": { "fieldErrors": {...} } }` |
| `401 Unauthorized` | Invalid JWT | `{ "error": "Unauthorized" }` |
| `403 Forbidden` | Individual account meter limit reached | `{ "error": "Individual accounts are limited to 1 meter…" }` |
| `404 Not Found` | Cooperative record missing | `{ "error": "Cooperative not found" }` |
| `409 Conflict` | Public key already registered | `{ "error": "A meter with this public key already exists" }` |
| `500 Internal Server Error` | Database error | `{ "error": "<message>" }` |

> **Important:** The `api_key` field (`mk_…`) in the 201 response is shown exactly once. Store it securely; it cannot be retrieved again.

---

### GET /api/v1/meters/:id

Get a single meter by ID.

**Auth:** Bearer JWT required.

**Path parameter:** `id` — meter UUID.

**Example request**

```http
GET /api/v1/meters/f47ac10b-58cc-4372-a567-0e02b2c3d479
Authorization: Bearer <jwt>
```

**Responses**

| Status | Body |
|---|---|
| `200 OK` | Meter object |
| `401 Unauthorized` | `{ "error": "Unauthorized" }` |
| `404 Not Found` | `{ "error": "Meter not found" }` |

---

### DELETE /api/v1/meters/:id

Delete (deregister) a meter. Does not delete associated reading history.

**Auth:** Bearer JWT required.

**Responses**

| Status | Body |
|---|---|
| `200 OK` | `{ "success": true }` |
| `401 Unauthorized` | `{ "error": "Unauthorized" }` |
| `404 Not Found` | `{ "error": "Meter not found" }` |
| `500 Internal Server Error` | `{ "error": "<message>" }` |

---

### POST /api/v1/meters/:id/revoke

Revoke a meter's API key, generating and returning a new one.

**Auth:** Bearer JWT required.

**Example request**

```http
POST /api/v1/meters/f47ac10b-58cc-4372-a567-0e02b2c3d479/revoke
Authorization: Bearer <jwt>
```

**Responses**

| Status | Body |
|---|---|
| `200 OK` | `{ "api_key": "mk_<new-hex>" }` |
| `401 Unauthorized` | `{ "error": "Unauthorized" }` |
| `404 Not Found` | `{ "error": "Meter not found" }` |

---

### POST /api/v1/readings

Submit a signed meter reading. Identical to `POST /api/readings` — see [that endpoint](#post-apireadings) for the full specification.

---

### POST /api/v1/readings/batch

Submit multiple signed meter readings in a single request.

**Auth:** No bearer token; each reading includes its own `signature_hex`.

**Request body**

```json
{
  "readings": [
    {
      "meter_id": "uuid",
      "kwh": 12.5,
      "timestamp": 1745366400,
      "signature_hex": "4b3e...f09a"
    },
    {
      "meter_id": "uuid",
      "kwh": 8.2,
      "timestamp": 1745370000,
      "signature_hex": "9c1a...b72e"
    }
  ]
}
```

**Responses**

| Status | Meaning | Body |
|---|---|---|
| `207 Multi-Status` | Batch processed (some may have failed) | `{ "results": [ { "index": 0, "status": 201, "data": {...} }, { "index": 1, "status": 401, "error": "..." } ] }` |
| `400 Bad Request` | Top-level schema invalid | `{ "error": { "fieldErrors": {...} } }` |

---

### GET /api/v1/certificates

List energy certificates with cursor-based pagination.

**Auth:** Not required (public endpoint).

**Query parameters**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | `integer` | `20` | Page size (max 100) |
| `cursor` | `string` | — | ISO timestamp of `issued_at` from previous page's `next_cursor` |
| `q` | `string` | — | Prefix search on certificate ID or meter ID |
| `status` | `"active"` \| `"retired"` | — | Filter by retirement status |
| `date_from` | ISO date | — | Inclusive lower bound on `issued_at` |
| `date_to` | ISO date | — | Inclusive upper bound on `issued_at` |

**Example request**

```http
GET /api/v1/certificates?limit=10&status=active&date_from=2026-01-01
```

**200 response body**

```json
{
  "data": [
    {
      "id": "cert-uuid",
      "kwh": 12.5,
      "issued_at": "2026-04-23T10:00:00.000Z",
      "retired": false,
      "retired_at": null,
      "retired_by": null,
      "mint_tx_hash": "stellar-tx-hash",
      "meter_id": "meter-uuid"
    }
  ],
  "next_cursor": "2026-04-22T08:00:00.000Z",
  "total": 142
}
```

**Responses**

| Status | Meaning |
|---|---|
| `200 OK` | Certificate page |
| `400 Bad Request` | Invalid query params |
| `500 Internal Server Error` | Database error |

---

### POST /api/v1/certificates/:id/retire

Permanently retire (burn) a certificate.

**Auth:** Bearer JWT required.

**Path parameter:** `id` — certificate UUID.

**Example request**

```http
POST /api/v1/certificates/cert-uuid/retire
Authorization: Bearer <jwt>
```

**Responses**

| Status | Body |
|---|---|
| `200 OK` | `{ "success": true, "retired_at": "<iso-timestamp>" }` |
| `400 Bad Request` | `{ "error": "Certificate already retired" }` |
| `401 Unauthorized` | `{ "error": "Unauthorized" }` |
| `404 Not Found` | `{ "error": "Certificate not found" }` |
| `500 Internal Server Error` | `{ "error": "<message>" }` |

> **Warning:** Retirement is irreversible. The certificate token is burned on-chain.

---

### GET /api/v1/certificates/:id/irec-export

Export a certificate in I-REC(E) issuance request format (JSON).

**Auth:** Bearer JWT required.

**Example request**

```http
GET /api/v1/certificates/cert-uuid/irec-export
Authorization: Bearer <jwt>
```

**200 response body**

```json
{
  "deviceId": "meter-uuid",
  "productionStart": "2026-04-23T00:00:00.000Z",
  "productionEnd": "2026-04-23T23:59:59.000Z",
  "volume": 0.0000125,
  "mrvDocumentUrl": "https://solarproof.vercel.app/verify?id=cert-uuid"
}
```

**Responses**

| Status | Body |
|---|---|
| `200 OK` | I-REC payload object |
| `401 Unauthorized` | `{ "error": "Unauthorized" }` |
| `404 Not Found` | `{ "error": "Certificate not found" }` |

---

### POST /api/v1/certificates/:id/transfer

Transfer a certificate to another cooperative.

**Auth:** Bearer JWT required.

**Request body**

| Field | Type | Description |
|---|---|---|
| `recipient_cooperative_id` | `string` (UUID) | Destination cooperative |

**Responses**

| Status | Body |
|---|---|
| `200 OK` | `{ "success": true }` |
| `400 Bad Request` | `{ "error": { "fieldErrors": {...} } }` |
| `401 Unauthorized` | `{ "error": "Unauthorized" }` |
| `404 Not Found` | `{ "error": "Certificate not found" }` |
| `500 Internal Server Error` | `{ "error": "<message>" }` |

---

### GET /api/v1/verify

Identical to `GET /api/verify` — see [that endpoint](#get-apiverify). Also available at `GET /api/v1/verify/:id` (path-param form).

---

### GET /api/v1/cooperative/me

Return the authenticated user's cooperative profile.

**Auth:** Bearer JWT required.

**Example request**

```http
GET /api/v1/cooperative/me
Authorization: Bearer <jwt>
```

**200 response body**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "name": "Sunshine Coop",
  "account_type": "cooperative",
  "admin_address": "GABC...XYZ",
  "suspended": false,
  "created_at": "2026-01-01T00:00:00.000Z"
}
```

**Responses**

| Status | Body |
|---|---|
| `200 OK` | Cooperative object |
| `401 Unauthorized` | `{ "error": "Unauthorized" }` |
| `500 Internal Server Error` | `{ "error": "<message>" }` |

---

### GET /api/v1/cooperative/stats

Return aggregated energy and certificate statistics for the authenticated cooperative.

**Auth:** Bearer JWT required.

**Query parameters**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `date_from` | ISO datetime | 30 days ago | Range start |
| `date_to` | ISO datetime | now | Range end |
| `granularity` | `"day"` \| `"month"` \| `"year"` | `"day"` | Trend bucket size |

**Example request**

```http
GET /api/v1/cooperative/stats?granularity=month&date_from=2026-01-01T00:00:00.000Z
Authorization: Bearer <jwt>
```

**200 response body**

```json
{
  "summary": {
    "total_kwh": 4210.5,
    "certificates_issued": 4210,
    "certificates_retired": 300,
    "active_meters": 5
  },
  "trends": [
    { "period": "2026-01", "kwh": 1200.0, "certs_issued": 1200, "certs_retired": 80 }
  ],
  "meter_stats": [
    { "meter_id": "uuid", "name": "Roof Panel A", "kwh": 840.0, "readings_count": 168 }
  ],
  "range": {
    "start": "2026-01-01T00:00:00.000Z",
    "end": "2026-10-19T00:00:00.000Z",
    "granularity": "month"
  }
}
```

**Responses**

| Status | Body |
|---|---|
| `200 OK` | Stats object |
| `400 Bad Request` | `{ "error": { "fieldErrors": {...} } }` |
| `401 Unauthorized` | `{ "error": "Unauthorized" }` |
| `500 Internal Server Error` | `{ "error": "<message>" }` |

---

### GET /api/v1/governance

List governance proposals for the authenticated cooperative.

**Auth:** Bearer JWT required.

**Example request**

```http
GET /api/v1/governance
Authorization: Bearer <jwt>
```

**200 response body**

```json
[
  {
    "id": "prop-uuid",
    "title": "Reduce platform fee to 1%",
    "description": "Proposal to lower the cooperative fee...",
    "status": "active",
    "ends_at": "2026-10-26T00:00:00.000Z",
    "created_at": "2026-10-19T00:00:00.000Z",
    "tally": { "for": 12, "against": 3, "abstain": 1 }
  }
]
```

**Responses**

| Status | Body |
|---|---|
| `200 OK` | Array of proposal objects |
| `401 Unauthorized` | `{ "error": "Unauthorized" }` |
| `500 Internal Server Error` | `{ "error": "<message>" }` |

---

### POST /api/v1/governance

Create a new governance proposal.

**Auth:** Bearer JWT required.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | `string` | ✅ | Proposal title (max 120 chars) |
| `description` | `string` | ✅ | Full description (max 2000 chars) |
| `action` | `string` | ✗ | Machine-readable action identifier (max 200 chars) |
| `days` | `integer` | ✗ | Voting period in days (1–30, default 7) |

**Example request**

```http
POST /api/v1/governance
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "title": "Reduce platform fee to 1%",
  "description": "We propose lowering the cooperative fee from 2% to 1% of minted certificates.",
  "days": 14
}
```

**Responses**

| Status | Body |
|---|---|
| `201 Created` | Proposal object |
| `400 Bad Request` | `{ "error": { "fieldErrors": {...} } }` |
| `401 Unauthorized` | `{ "error": "Unauthorized" }` |
| `500 Internal Server Error` | `{ "error": "<message>" }` |

---

### POST /api/v1/governance/:id/vote

Cast a vote on an active proposal.

**Auth:** Bearer JWT required.

**Path parameter:** `id` — proposal UUID.

**Request body**

| Field | Type | Description |
|---|---|---|
| `choice` | `"for"` \| `"against"` \| `"abstain"` | Your vote |

**Example request**

```http
POST /api/v1/governance/prop-uuid/vote
Authorization: Bearer <jwt>
Content-Type: application/json

{ "choice": "for" }
```

**Responses**

| Status | Body |
|---|---|
| `200 OK` | `{ "message": "Vote recorded successfully" }` |
| `400 Bad Request` | `{ "error": "Voting is closed for this proposal" }` or validation error |
| `401 Unauthorized` | `{ "error": "Unauthorized" }` |
| `404 Not Found` | `{ "error": "Proposal not found" }` |
| `500 Internal Server Error` | `{ "error": "<message>" }` |

---

### GET /api/v1/audit-log

Return the structured audit log for the authenticated cooperative.

**Auth:** Bearer JWT required.

**Query parameters**

| Parameter | Type | Description |
|---|---|---|
| `limit` | `integer` | Page size (max 100, default 20) |
| `cursor` | `string` | Pagination cursor from previous response |
| `event_type` | `string` | Filter by event type (e.g. `reading.anchored`, `certificate.retired`) |

**Example request**

```http
GET /api/v1/audit-log?limit=10&event_type=certificate.retired
Authorization: Bearer <jwt>
```

**200 response body**

```json
{
  "data": [
    {
      "id": "log-uuid",
      "event_type": "certificate.retired",
      "actor_id": "user-uuid",
      "resource_id": "cert-uuid",
      "meta": {},
      "created_at": "2026-04-23T10:00:00.000Z"
    }
  ],
  "next_cursor": "2026-04-22T08:00:00.000Z"
}
```

**Responses**

| Status | Body |
|---|---|
| `200 OK` | Audit log page |
| `401 Unauthorized` | `{ "error": "Unauthorized" }` |
| `500 Internal Server Error` | `{ "error": "<message>" }` |

---

### GET /api/v1/jobs/:id

Poll the status of a long-running background job (e.g. a batch reading import).

**Auth:** Bearer JWT required.

**Path parameter:** `id` — job UUID.

**200 response body**

```json
{
  "id": "job-uuid",
  "status": "completed",
  "progress": 100,
  "result": { "processed": 50, "failed": 0 },
  "created_at": "2026-04-23T10:00:00.000Z",
  "completed_at": "2026-04-23T10:00:05.000Z"
}
```

**Job statuses:** `pending` · `running` · `completed` · `failed`

**Responses**

| Status | Body |
|---|---|
| `200 OK` | Job status object |
| `401 Unauthorized` | `{ "error": "Unauthorized" }` |
| `404 Not Found` | `{ "error": "Job not found" }` |

---

### GET /api/v1/webhooks

List registered webhook endpoints for the authenticated cooperative.

**Auth:** Bearer JWT required.

**Responses**

| Status | Body |
|---|---|
| `200 OK` | Array of webhook objects |
| `401 Unauthorized` | `{ "error": "Unauthorized" }` |

---

### POST /api/v1/webhooks

Register a new webhook endpoint to receive reading and certificate events.

**Auth:** Bearer JWT required.

**Request body**

| Field | Type | Description |
|---|---|---|
| `url` | `string` | HTTPS endpoint to receive POST events |
| `events` | `string[]` | Event types to subscribe to (e.g. `["reading.anchored", "certificate.minted", "certificate.retired"]`) |
| `secret` | `string` | HMAC-SHA256 signing secret for payload verification |

**Example request**

```http
POST /api/v1/webhooks
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "url": "https://your-system.example/webhooks/solar",
  "events": ["reading.anchored", "certificate.retired"],
  "secret": "whsec_your-secret-here"
}
```

**Responses**

| Status | Body |
|---|---|
| `201 Created` | Webhook object with `id` |
| `400 Bad Request` | `{ "error": { "fieldErrors": {...} } }` |
| `401 Unauthorized` | `{ "error": "Unauthorized" }` |
| `500 Internal Server Error` | `{ "error": "<message>" }` |

---

### GET /api/v1/health

Liveness check. Identical to `GET /api/health`.

**No parameters. No auth required.**

```json
{ "status": "ok", "ts": 1745366400000 }
```

---

## Postman / Insomnia collection

A collection is available at [`docs/solarproof-api-v1.postman_collection.json`](./solarproof-api-v1.postman_collection.json) and can be imported directly into Postman or Insomnia. Set the `baseUrl` collection variable to your target environment (`https://solarproof.vercel.app` for production, `http://localhost:3000` for local).
