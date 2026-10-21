# Public Next.js Routes

This document describes the public Next.js API routes provided by the `web/` application, their inputs, outputs, and usage examples.

## Goals

- Provide a concise reference for each publicly-exposed route.
- Show expected request/response shapes and common error cases.
- List authentication and rate-limit notes where applicable.

## Routes

Note: adjust the paths below if the app mounts routes differently in deployment.

- `GET /api/health` — Health check
  - Response: 200 OK
  - Body: `{ "status": "ok" }`

- `POST /api/readings` — Submit a meter reading (public ingestion endpoint)
  - Request: JSON body with fields `meterId`, `timestamp`, `value`
  - Response: 202 Accepted on success; 400 for validation errors
  - Authentication: API key or signed payload depending on deployment (see `USER_GUIDE.md`)

- `GET /api/metadata/:meterId` — Get meter metadata
  - Response: 200 with JSON metadata or 404 if not found

- `GET /api/verify` — Public verifier (list/entry point)
  - Response: 200 with JSON verification data
  - Rate limit: 30 requests/minute per IP, enforced in `middleware.ts`
  - On limit exceeded: 429 Too Many Requests with a `Retry-After` header

- `GET /api/verify/{id}` — Public verifier for a specific record
  - Response: 200 with JSON verification data or 404 if not found
  - Rate limit: 30 requests/minute per IP, enforced in `middleware.ts`
  - On limit exceeded: 429 Too Many Requests with a `Retry-After` header
  - Abuse protection: see `ABUSE_PROTECTION.md` (optional PoW/bot challenge for high-volume use)

## Error formats

- Standard error response shape used by public routes:

```
{
  "error": {
    "code": "BadRequest",
    "message": "description of the problem"
  }
}
```

## Best practices for docs

- Keep examples minimal and machine-readable (JSON).
- Point developers to `openapi.yaml` for canonical API schema.

## Where to update

- Runtime route implementations live under `web/src/pages/api/` and `web/src/app/api/` (depending on Next.js routing usage).
- Update this document and `openapi.yaml` together when changing public surface area.

## Contact

If you have questions about a particular route, open an issue referencing this document.
