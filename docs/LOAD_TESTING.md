# Load Testing — `/api/readings`

Covers Issue #525: backpressure validation for the meter reading ingest endpoint.

## Prerequisites

Install [k6](https://k6.io/docs/get-started/installation/):

```bash
# macOS
brew install k6

# Linux (Debian/Ubuntu)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
     --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# Windows
choco install k6
```

## Running the tests

All commands assume the app is running locally (`pnpm dev`).

```bash
export BASE_URL=http://localhost:3000
```

### Smoke (1 VU · 30 s)

Quick sanity check — ensures the endpoint is reachable and not throwing 5xx errors.

```bash
k6 run --env BASE_URL=$BASE_URL \
       --env SCENARIO=smoke \
       --config /dev/null \
       --include-system-env-vars \
       scripts/load-test-readings.mjs
```

Or run all scenarios together:

```bash
k6 run --env BASE_URL=$BASE_URL scripts/load-test-readings.mjs
```

### Load (50 VUs · ramp 1 m → sustain 3 m → ramp-down 1 m)

Simulates expected production peak traffic. The endpoint must stay below 2 s p95.

```bash
k6 run --env BASE_URL=$BASE_URL scripts/load-test-readings.mjs
```

### Stress (200 VUs · ramp over 2 m)

Pushes the server beyond expected capacity to find the breaking point and observe backpressure behaviour (queue depth, timeout responses, 429s).

## Thresholds

| Metric | Threshold | Applies to |
|---|---|---|
| `http_req_duration` p95 | < 2 000 ms | all scenarios |
| `error_rate` | < 10 % | smoke only |

A failed threshold exits k6 with a non-zero code, which will fail CI.

**Note:** The test sends `signature_hex: "000…0"` (128 zeroes), so the API returns 401 Unauthorized. This is intentional — 4xx responses still exercise the full request/response path and reflect real backpressure behaviour without requiring valid credentials.

## Interpreting results

```
✓ status not 5xx
✓ response time < 2s

checks.........................: 99.80%  ✓ 5988  ✗ 12
http_req_duration..............: avg=45ms  p(95)=312ms  p(99)=890ms
error_rate.....................: 0.20%
```

- **`error_rate` > 10 %** in smoke → the server is returning 5xx; investigate application logs.
- **`p95 > 2 000 ms`** → the server is overloaded or a slow dependency (Supabase, Stellar RPC) is the bottleneck.
- **Spike in p99 during stress** → expected; look for connection pool exhaustion or rate-limiter kicks.

## Verify rate-limit test — `/api/verify`

Covers Issue #119: abuse protection for the public verifier. The verify endpoint is
rate limited to **30 requests/minute per IP** (configured in `middleware.ts`). This
test sends bursts well above that limit from a single IP and asserts that the
limiter actually kicks in.

### What it checks

- Requests beyond the 30 req/min budget return **429 Too Many Requests**.
- 429 responses include a **`Retry-After`** header.
- Requests within the budget are not rejected by the limiter.

### Running locally

```bash
export BASE_URL=http://localhost:3000
k6 run --env BASE_URL=$BASE_URL scripts/load-test-verify-ratelimit.mjs
```

The script fires a burst of requests from one VU (single IP) so the per-IP limiter
is exercised deterministically. Because the limiter window is one minute, a full
run takes a little over a minute.

### Running in CI

The `load-test` job in `.github/workflows/load-test.yml` runs this script against
the staging environment:

```yaml
- name: Verify rate-limit test
  run: k6 run --env BASE_URL=${{ vars.STAGING_URL }} scripts/load-test-verify-ratelimit.mjs
```

### Interpreting results

```
✓ 429 returned after limit exceeded
✓ Retry-After header present on 429

rate_limited_requests...........: 45
allowed_requests................: 30
```

- **No 429s observed** → the limiter is not enforced (check `middleware.ts` config
  and that the test is not being routed through a proxy that rewrites client IPs).
- **429s returned but `Retry-After` missing** → the limiter response is incomplete;
  clients cannot back off correctly.
- **429s returned before 30 requests** → the limit is too strict or the window is
  misconfigured; verify the 30 req/min setting.
- **429s on the very first request** → a previous test run may still hold the
  window; wait one minute and re-run.

## CI integration

Add to `.github/workflows/ci.yml` when a staging environment is available:

```yaml
- name: Load test
  run: k6 run --env BASE_URL=${{ vars.STAGING_URL }} scripts/load-test-readings.mjs
```
