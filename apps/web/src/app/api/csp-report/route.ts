import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { z } from 'zod'

// Schema for the browser-sent CSP violation report body.
// The browser wraps the report in a "csp-report" key per the W3C spec.
const CspSchema = z.object({
  'csp-report': z.record(z.unknown()).optional(),
}).passthrough()

/**
 * POST /api/csp-report
 *
 * Receives Content-Security-Policy violation reports from the browser and
 * forwards them to Sentry as captured messages so they appear in the
 * Sentry Issues dashboard.
 *
 * The CSP header in next.config.ts is set to Content-Security-Policy
 * (enforce mode, not Report-Only) with `report-uri /api/csp-report`.
 *
 * Closes #112.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = CspSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid CSP report format' }, { status: 400 })
  }

  const report = parsed.data['csp-report'] ?? parsed.data

  // Log locally for server-side observability
  console.warn('[CSP Violation]', JSON.stringify(report))

  // Forward the violation to Sentry.
  // captureMessage creates a Sentry "issue" so violations are tracked and
  // reviewable in the Sentry dashboard (satisfies the quarterly review AC).
  Sentry.captureMessage('CSP Violation', {
    level: 'warning',
    extra: { cspReport: report },
    tags: {
      'csp.blocked_uri': String(
        (report as Record<string, unknown>)['blocked-uri'] ?? 'unknown'
      ),
      'csp.violated_directive': String(
        (report as Record<string, unknown>)['violated-directive'] ?? 'unknown'
      ),
    },
  })

  // 204 No Content is the conventional response for CSP report endpoints.
  return new NextResponse(null, { status: 204 })
}
