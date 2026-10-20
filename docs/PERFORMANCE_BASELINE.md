# Performance Baseline — POST /api/readings

> Issue #120 · Last updated: 2026-04-25

## Test configuration

| Parameter | Value |
|---|---|
| Tool | [k6](https://k6.io) |
| Script | `tests/load/readings.js` |
| Concurrent VUs | 100 |
| Duration | 60 s |
| Think time | 100 ms between iterations |
| Target | `POST /api/readings` |

## Acceptance thresholds

| Metric | Threshold | Rationale |
|---|---|---|
| P95 response time | < 2 000 ms | Burst from 100 meters must not stall the pipeline |
| Error rate | < 5 % | Transient network errors tolerated; logic errors are not |

## Running the load test

### Prerequisites

Install k6: https://k6.io/docs/getting-started/installation/

```bash
# macOS
brew install k6

# Linux
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

### Run against staging

```bash
k6 run tests/load/readings.js \
  -e API_URL=https://solarproof-staging.vercel.app \
  -e METER_ID=<seeded-meter-uuid> \
  -e SIGNATURE_HEX=<valid-64-byte-sig-hex>
```

### Run against localhost

```bash
# Start the app
pnpm dev

# In another terminal
k6 run tests/load/readings.js -e API_URL=http://localhost:3000
```

### Generate a signed payload pool (optional)

For a fully cryptographic load test, pre-generate payloads:

```bash
node scripts/gen-meter-key.mjs          # creates meter-key.json
# Then use scripts/send-reading.mjs as a reference to build a payload pool
```

## Baseline results

> Baseline captured on: _not yet recorded — run the test and fill in below_

| Metric | Result | Threshold | Pass? |
|---|---|---|---|
| P95 response time | — ms | < 2 000 ms | — |
| P99 response time | — ms | — | — |
| Median response time | — ms | — | — |
| Requests/s | — | — | — |
| Error rate | — % | < 5 % | — |
| Total requests (60 s) | — | — | — |

_Update this table after each significant infrastructure change or release._

## Interpreting results

- **P95 < 2 000 ms** — the endpoint handles burst load within the SLA.
- **Error rate < 5 %** — the server is not shedding load under pressure.
- If P95 exceeds the threshold, investigate: Supabase connection pool saturation, Stellar RPC latency, or Next.js cold starts.

## CI integration

The load test runs nightly at 02:00 UTC against staging via `.github/workflows/load-test.yml`.

The CI job:
1. Runs `tests/load/readings.js` (100 VUs, 60 s baseline scenario)
2. Parses P95 from the k6 JSON summary
3. Fails if P95 > **2 400 ms** (baseline + 20% regression tolerance)
4. Uploads results as a CI artifact (30-day retention)
5. Posts a summary table to the GitHub Actions job summary

To trigger manually:
```
Actions → Load Test — POST /api/readings → Run workflow
```

### Updating the baseline

When an intentional infrastructure change (e.g., a new caching layer, DB index, or RPC endpoint) improves or changes performance, update the baseline via PR:

1. Run the load test against staging and note the new P95.
2. Update `P95_BASELINE_MS` in `.github/workflows/load-test.yml`.
3. Update the **Baseline results** table below with the new measurements.
4. Open a PR with both changes and reference the workflow run that produced the results.
