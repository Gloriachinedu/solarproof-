import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

// Custom counter tracking how many responses were rate limited (HTTP 429).
const rateLimited = new Counter('rate_limited');

// Base URL of the deployment under test (e.g. https://verifier.example.com).
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Placeholder verification id to hit the public verifier endpoint.
const VERIFY_ID = __ENV.VERIFY_ID || 'load-test-placeholder';

// Send a burst of >30 requests within 60 seconds from a single VU/IP so that
// the 30 requests/minute per-IP rate limit is guaranteed to be exceeded.
export const options = {
  scenarios: {
    burst: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 40,
      maxDuration: '60s',
    },
  },
  thresholds: {
    // At least one 429 must be observed during the burst.
    rate_limited: ['count>0'],
    // Every 429 response must include a Retry-After header.
    checks: ['rate==1'],
  },
};

export default function () {
  const url = `${BASE_URL}/api/verify?id=${encodeURIComponent(VERIFY_ID)}`;

  const res = http.get(url, {
    tags: { name: 'verify' },
  });

  if (res.status === 429) {
    rateLimited.add(1);
  }

  check(res, {
    'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
    '429 responses include Retry-After header': (r) =>
      r.status !== 429 || r.headers['Retry-After'] !== undefined,
  });
}