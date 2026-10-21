# ADR 007 — Supabase Service Role Key Usage

**Status:** Accepted  
**Date:** 2026-06-02  
**Updated:** 2026-10-18 (issue #37 — full audit pass)  
**Issue:** [#134](https://github.com/katecatherinaa/solarproof/issues/134), [#37](https://github.com/katecatherinaa/solarproof/issues/37)

## Context

The Supabase service role key bypasses Row Level Security (RLS). Its use must be
minimised and every remaining usage justified. This ADR documents the audit
performed for issue #37: all `createServiceClient` calls in the codebase were
grepped, reviewed, and annotated with a justification comment pointing back here.

## Audit Results

### Switched to anon key + RLS

| Endpoint | Reason |
|---|---|
| `GET /api/verify` | Public, no auth. Anon SELECT policy added (migration 010). |
| `GET /api/verify/[id]` | Public, no auth. Same policy. |

### Retained service role — justified uses

| Location | Reason service role is required |
|---|---|
| `POST /api/readings` | Device-submitted data, no operator JWT. Must write across cooperative boundaries. |
| `GET /api/readings` | Requires operator JWT (enforced by `requireAuth`), but the service client avoids double-auth round-trip. |
| `POST /api/readings/batch` | Same as POST /api/readings — device-submitted, no user JWT. |
| `POST /api/meters` | Operator action but needs to write `api_key`; simpler to stay consistent with reads. |
| `GET /api/meters/[id]` | Meter lookup backed by requireAuth; service role avoids double RLS round-trip. |
| `PATCH /api/meters/[id]` | Same as above. |
| `PATCH /api/meters/[id]/revoke` | Admin action. No operator JWT in device flow. |
| `POST /api/meters/[id]/rotate-key` | Requires auth, but key rotation updates `api_key` which RLS does not expose to `anon`. |
| `POST /api/certificates/[id]/retire` | Must validate and update certificate state across cooperative scope. |
| `POST /api/certificates/retire/bulk` | Bulk retirement; same justification as single retire. |
| `GET /api/certificates` | Returns paginated certs with JOIN on readings; RLS would require operator JWT which callers may not have. |
| `POST /api/certificates/[id]/transfer` | Transfer validation reads cert and performs optimistic lock; service role avoids double-auth. |
| `GET /api/certificates/[id]/irec-export` | I-REC export reads cert + reading data; service role avoids double-auth. |
| `GET /api/cooperative/me` | Resolves cooperative row from `app_metadata.cooperative_id`; no anon read policy on cooperatives. |
| `GET /api/cooperative/stats` | Analytics RPCs are SECURITY DEFINER and require the service role to invoke. |
| `GET /api/governance` | Proposals JOIN votes needs cross-table visibility; results manually scoped to caller's cooperative. |
| `POST /api/governance` | Insert with cooperative_id FK; anon-key RLS write restriction does not permit this. |
| `POST /api/governance/[id]/vote` | Vote upsert must read parent proposal across cooperative boundary for validation. |
| `GET /api/admin/operators` | Admin endpoint; requires cross-cooperative visibility. |
| `PATCH /api/admin/operators/[id]` | Admin action; suspending requires cross-cooperative write access. |
| `GET /api/admin/audit-logs` | Admin compliance export; cross-tenant audit log visibility required. |
| `GET /api/audit-log` | Admin compliance export; scoped by query params. |
| `GET /api/audit-log/export` | Full export; same justification. |
| `GET /api/jobs/[id]` | Job status lookup; no user JWT in background context. |
| `GET /api/health` | Needs cross-tenant visibility for health checks. |
| `GET /api/ready` | Startup liveness probe. |
| `POST /api/webhooks` | Webhook registration called from device/server contexts without user JWT. |
| `GET /api/webhooks` | Webhook listing; may be called without user JWT. |
| `GET /api/webhooks/logs` | Webhook delivery logs; no user JWT in background context. |
| `lib/audit.ts` | Audit log writes must never be gated by operator RLS. |
| `lib/queue.ts` | Background job processing — no user JWT available. |
| `lib/webhooks.ts` | Cross-cooperative webhook fan-out; no user context. |
| `lib/tracer-sim.ts` | Mint-failure diagnosis reads across tables without a user JWT. |
| `lib/health-checks.ts` | Needs cross-tenant visibility for health checks. |
| `lib/auth.ts` (internal) | Revocation list read/write must not be gated by operator RLS. |

## Decision

1. Use `createAnonClient()` (anon key, RLS enforced) for all public read-only
   endpoints that require no authentication.
2. Add explicit `to anon` RLS policies (migration 010) for the tables those
   endpoints query.
3. All remaining `createServiceClient()` calls are in trusted server-side
   contexts where either no user JWT is available or cross-cooperative access
   is deliberately required.
4. The service role key must never be exposed to the browser or returned in any
   API response.
5. **Every** call to `createServiceClient()` in application code must include a
   one-line comment citing this ADR and stating the justification. This was
   enforced during the issue #37 audit pass (2026-10-18).

## Consequences

- The public verifier (`/api/verify`) no longer uses the service role key.
- New public-read endpoints must use `createAnonClient()` and add an explicit RLS policy.
- Any future use of `createServiceClient()` in a new route requires a comment
  citing this ADR and a one-line justification.
- All existing usages are now annotated inline, making future audits trivially
  verifiable with `grep -n "createServiceClient"`.
