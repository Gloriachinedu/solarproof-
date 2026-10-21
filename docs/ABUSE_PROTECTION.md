# Abuse Protection

SolarProof's public API endpoints are protected against abuse via IP-based rate limiting, strict request validation, and response headers.

---

## Endpoints covered

| Endpoint | Limit | Window |
|---|---|---|
| `POST /api/readings` | 10 requests | 60 seconds per IP |
| `GET /api/verify` | 30 requests | 60 seconds per IP |
| `GET /api/verify/{id}` | 30 requests | 60 seconds per IP |
| `GET /api/v1/verify` | 30 requests | 60 seconds per IP |
| `GET /api/v1/verify/{id}` | 30 requests | 60 seconds per IP |

The public verifier endpoints (`/api/verify`, `/api/verify/{id}` and their `/api/v1` equivalents) are limited to **30 requests per 60 seconds per IP**.

---

## Rate limiting

Rate limiting for the public verifier is enforced in `apps/web/src/middleware.ts`, which applies the policy to every matching request before it reaches the route handler. The underlying counter store lives in `apps/web/src/lib/rate-limit.ts`.

When the limit is exceeded the API returns:

```
HTTP 429 Too Many Requests
Retry-After: <seconds until reset>
X-RateLimit-Limit: <limit>
X-RateLimit-Remaining: 0
```

**Current backend:** in-memory store (per serverless instance).  
**Recommended for production:** replace with an edge-distributed KV store (e.g. [Upstash Redis](https://upstash.com/) or Vercel KV) so limits are enforced consistently across all instances. The in-memory store is intended for local development and single-instance deployments only.

---

## Request validation

All `POST /api/readings` requests are validated with [Zod](https://zod.dev/) before any DB or chain operation:

| Field | Rule |
|---|---|
| `meter_id` | Valid UUID |
| `kwh` | Positive number |
| `timestamp` | Positive integer (Unix seconds) |
| `signature_hex` | 128-character hex string (64-byte Ed25519) |

Invalid payloads receive `HTTP 400` with a structured error body.

---

## Ed25519 signature verification

The server rejects any reading whose Ed25519 signature does not verify against the registered meter public key.  
This prevents fabricated readings from untrusted sources (`HTTP 401`).

---

## CAPTCHA / bot detection (optional)

For high-volume or higher-risk deployments, an optional bot-detection challenge can be layered on top of rate limiting. It is disabled by default and gated by the `BOT_DETECTION_PROVIDER` environment variable:

| `BOT_DETECTION_PROVIDER` | Provider | Required secret |
|---|---|---|
| unset / empty | Disabled (rate limiting only) | — |
| `turnstile` | [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) | `TURNSTILE_SECRET_KEY` |
| `hcaptcha` | [hCaptcha](https://www.hcaptcha.com/) | `HCAPTCHA_SECRET_KEY` |

When enabled, the client obtains a token from the provider and passes it to the API; the server verifies the token against the provider's siteverify endpoint before processing the request. Requests with a missing or invalid token are rejected.

- **Cloudflare Turnstile** — zero-friction, works with edge middleware
- **hCaptcha** — open alternative

---

## Legitimate clients

Legitimate meter devices operate well within the rate limits (typically one reading every few minutes per device).  
The Zod schema is designed to accept all valid meter payloads without false rejections.

---

## Escalation

If automated abuse is detected (patterns consistent with replay attacks or scanning), report via [GitHub Security Advisories](../../../security/advisories/new) or rotate the affected meter keypair.
