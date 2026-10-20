# ADR-009 — Redis Caching Strategy

**Status:** Accepted  
**Date:** 2026-10-16  
**Issue:** [#84](https://github.com/katecatherinaa/solarproof/issues/84)

## Context

SolarProof's API layer has four distinct caching needs that emerged as the
system scaled:

1. **Session caching** — operator JWTs are validated on every authenticated
   request. Round-tripping to Supabase Auth on every call adds latency and
   consumes Auth API quota.
2. **Rate limiting** — the meter ingestion endpoint (`POST /api/readings`) must
   reject abusive devices without adding per-request database writes.
3. **Idempotency** — signed meter readings include a client-generated nonce. The
   API must deduplicate retried requests without hitting Postgres on every
   inbound reading.
4. **Operator suspension** — a suspended operator must be blocked immediately
   across all API routes. The current state is read on every request, so Postgres
   latency compounds at scale.

These four patterns share a common requirement: **fast key-value lookups with
controlled expiry**. The existing stack (Supabase Postgres + Next.js) has no
built-in mechanism for sub-millisecond TTL-based caching.

### Alternatives considered

| Option | Pros | Cons |
|---|---|---|
| **Postgres-backed cache table** | No new dependency; transactional | Latency 10–50 ms per lookup; write amplification; TTL needs a cron job |
| **In-process LRU (node-lru-cache)** | Zero infra; instant | Not shared across Next.js instances; lost on cold start; no rolling-window support |
| **Vercel Edge Config** | Low latency at edge | Read-only; cannot support rate-limit counters or idempotency writes |
| **Upstash (managed Redis over HTTP)** | Serverless-friendly; no infra ops | HTTP overhead; vendor lock-in; cost at high RPS |
| **Redis (self-hosted / Docker)** | Sub-ms latency; atomic ops (`INCR`, `SET NX`); TTL native; widely understood | Requires a running Redis process; persistence config needed |

Redis was chosen because:

- **Atomic primitives** — `INCR` + `EXPIRE` for rate-limit counters, `SET NX`
  for idempotency locks, and `SET EX` for session/suspension caches map
  directly onto Redis commands with no application-level locking.
- **Native TTL** — expiry is enforced by Redis itself; no cron job or
  application sweep is needed.
- **Docker Compose parity** — a Redis container is already included in the
  local development stack (`docker-compose.yml`), so there is no gap between
  local and production behaviour.
- **Operational maturity** — Redis is the industry-standard choice for these
  patterns; extensive documentation, client libraries (`ioredis`), and
  monitoring tooling exist.

## Decision

Use Redis as the sole caching layer for SolarProof's API. All cache access is
encapsulated in `lib/redis.ts` via a single `ioredis` client instance.

### TTL per cache type

| Cache type | Key pattern | TTL | Rationale |
|---|---|---|---|
| **Session** | `session:<operator_id>` | **24 hours** | Matches Supabase JWT expiry. Refreshed on each successful auth validation so active operators never experience a cold miss. Invalidated immediately on logout or key revocation. |
| **Rate limit** | `rl:<meter_id>:<window_start_unix_minute>` | **1 minute (rolling)** | Each key covers a 60-second window. A new `INCR` + `EXPIRE` is issued per request; the key expires automatically after its window. Threshold: 60 readings/minute per meter. |
| **Idempotency** | `idem:<nonce>` | **24 hours** | Matches the client-side retry window documented in the meter firmware spec. A `SET NX EX 86400` prevents duplicate processing; the key self-expires, avoiding permanent growth. |
| **Operator suspension** | `suspended:<operator_id>` | **5 minutes** | A short TTL ensures that a newly unsuspended operator gains access within 5 minutes without manual cache invalidation. The worst-case window is acceptable for the suspension use case. |

### Cache invalidation strategy

| Event | Action |
|---|---|
| Operator logs out | `DEL session:<operator_id>` |
| API key revoked (`PATCH /api/meters/[id]/revoke`) | `DEL session:<operator_id>` for all meters owned by the operator |
| Operator suspended | `SET suspended:<operator_id> 1 EX 300` (write through; no explicit invalidation needed — TTL handles expiry) |
| Operator unsuspended | `DEL suspended:<operator_id>` (immediate relief; does not wait for TTL) |
| Idempotency key consumed | Key remains set until natural TTL expiry; no manual deletion |
| Rate-limit window expires | Automatic TTL expiry; no application action needed |

### Failure mode

If Redis is unavailable:

- **Session cache miss** — fall back to Supabase Auth validation. No outage,
  increased latency.
- **Rate limit** — fail open (allow the request) and log a warning. Preferred
  over dropping legitimate meter readings during a Redis outage.
- **Idempotency** — fail open; log a warning. Duplicate processing risk is low
  and preferable to rejecting valid readings.
- **Suspension check** — fail closed (deny the request) and log an error.
  Allowing a suspended operator through during a Redis outage is a security
  regression; the conservative choice is to deny.

### Configuration

```
REDIS_URL=redis://localhost:6379   # Docker Compose default
```

Production deployments use a managed Redis service (e.g., AWS ElastiCache,
Upstash) configured via the same `REDIS_URL` environment variable.

## Consequences

- **Easier:** sub-millisecond cache lookups; atomic rate-limit counters without
  application-level locking; idempotency with no Postgres writes; suspension
  state propagates within 5 minutes automatically.
- **Harder:** Redis becomes a required runtime dependency; the Docker Compose
  stack and production environment must include a Redis instance; cache
  stampede on session key expiry must be monitored at high concurrency.
- Any new caching requirement must be documented in this ADR (or a superseding
  ADR) with a justified TTL and invalidation strategy before implementation.
