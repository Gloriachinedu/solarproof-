# Log Aggregation

SolarProof ships structured JSON logs to **Better Stack (Logtail)** from all Next.js API routes.

## Setup

1. Create a **Source** in [Better Stack Logs](https://logs.betterstack.com) → choose *HTTP source*.
2. Copy the **Source token** and add it to your environment:
   - Vercel: `Settings → Environment Variables → LOGTAIL_SOURCE_TOKEN`
   - Local: add to `.env.local`
3. Retention is configured per-team in Better Stack → **30 days** is the default for the free tier; upgrade if needed.

## Correlation IDs

Every API request is assigned a **`X-Correlation-ID`** header in middleware. This ID flows through all log entries for a request so you can trace a single request across logs, Sentry, and external services.

- If the inbound request includes `X-Correlation-ID`, that value is reused.
- Otherwise the middleware generates a new UUID v4.
- The value is forwarded in the `X-Correlation-ID` response header.

### Using the request-scoped logger

Use `createRequestLogger(req)` in route handlers to automatically include `correlationId`, `route`, `method`, and `duration_ms` in every log entry:

```ts
import { createRequestLogger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const log = createRequestLogger(req)
  log.info('readings.post.start', { meter_id })
  // ... process ...
  log.end(202)  // emits request.complete with status + duration
}
```

## Log format

Every log line is a JSON object with at minimum:

```json
{
  "level": "info",
  "event": "reading.anchored",
  "timestamp": "2026-04-24T13:00:00.000Z",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "route": "/api/v1/readings",
  "method": "POST",
  "txHash": "abc123",
  "kwh": 12.5
}
```

A completed request emits a `request.complete` entry with timing:

```json
{
  "level": "info",
  "event": "request.complete",
  "timestamp": "2026-04-24T13:00:01.000Z",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "route": "/api/v1/readings",
  "method": "POST",
  "status": 202,
  "duration_ms": 312
}
```

## PII Redaction

PII fields are automatically redacted. See [docs/SECURE_LOGGING.md](./SECURE_LOGGING.md) for the full policy.

Key fields that are **always redacted**:
- `meter_id`, `email`, `operator_email` (PII per SECURE_LOGGING.md)
- Any key matching `/key|secret|token|password|sig|hex|private/i`

Use `redactPii(meta)` before passing untrusted objects to the logger:

```ts
import { redactPii } from '@/lib/logger'
log.info('reading.received', redactPii({ meter_id, kwh, timestamp }))
```

## Sentry integration

`createRequestLogger()` sets the `correlationId` tag on the active Sentry scope. This means:
- Sentry errors include the correlation ID as a tag and extra field
- Sentry breadcrumbs include the correlation ID, route, and method
- You can search Sentry by correlation ID to find the log context for any error

## Usage in code

```ts
import { logger, createRequestLogger, redact, redactPii } from '@/lib/logger'

// Simple logger (no request context)
logger.info('reading.anchored', { txHash, kwh })
logger.error('mint.failed', { error: err.message, readingId })

// With explicit correlation ID
const log = logger.withCorrelationId(correlationId)
log.info('reading.anchored', { txHash })

// Request-scoped (recommended for route handlers)
const log = createRequestLogger(req)
log.info('readings.post.start')
log.end(202)

// Structural redaction
const safe = redact({ signature_hex, pubkey_hex, kwh })
log.info('reading.received', safe)
```

## Alerts

Configure in Better Stack → **Alerts**:

| Alert | Condition | Channel |
|---|---|---|
| Error spike | `level = error` count > 10 in 5 min | Email / PagerDuty |
| High error rate | `level = error` / total > 5 % over 15 min | Slack |

Logs are also captured by Vercel function logs (stdout) and Sentry (errors via `@sentry/nextjs`).
