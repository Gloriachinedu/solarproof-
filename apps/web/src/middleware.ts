import { NextRequest, NextResponse } from 'next/server'
import { getCorsHeaders } from '@/lib/cors'

export const SUPPORTED_LOCALES = ['en', 'es', 'fr', 'de', 'pt', 'ar'] as const
export type Locale = typeof SUPPORTED_LOCALES[number]

/**
 * Middleware that:
 * 1. Enforces CORS policy — restricts origins to CORS_ALLOWED_ORIGINS + localhost in dev.
 * 2. Handles OPTIONS preflight requests.
 * 3. Injects a correlation ID into every API request.
 * 4. Redirects unversioned /api/* routes to /api/v1/* with a deprecation header.
 *
 * Correlation ID:
 *   - Reads `X-Correlation-Id` from the incoming request if present.
 *   - Otherwise generates a new UUID v4.
 *   - Forwards the ID in the `X-Correlation-Id` response header.
 *
 * API versioning:
 *   - Requests to /api/<route> (not already /api/v1/) are redirected to
 *     /api/v1/<route> with a 308 Permanent Redirect and a Deprecation header.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)

  // ── HTTPS redirect ────────────────────────────────────────────────────────
  // In production, redirect plain HTTP to HTTPS with a 301 permanent redirect.
  // Vercel/CDN handles this at the edge, but the middleware acts as a safety net.
  if (
    process.env.NODE_ENV === 'production' &&
    req.headers.get('x-forwarded-proto') === 'http'
  ) {
    const httpsUrl = req.nextUrl.clone()
    httpsUrl.protocol = 'https:'
    return NextResponse.redirect(httpsUrl, { status: 301 })
  }

  // ── CORS preflight ────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    if (corsHeaders) {
      return new NextResponse(null, { status: 204, headers: corsHeaders })
    }
    // Origin not allowed — return 403
    return new NextResponse(null, { status: 403 })
  }

  // ── API versioning redirect ───────────────────────────────────────────────
  // Match /api/<segment> but NOT /api/v1/... or /api/docs or /api/admin
  const unversioned = pathname.match(/^\/api\/(?!v\d+\/|admin\/)(.+)$/)
  if (unversioned) {
    const url = req.nextUrl.clone()
    url.pathname = `/api/v1/${unversioned[1]}`
    const redirect = NextResponse.redirect(url, { status: 301 })
    redirect.headers.set('Deprecation', 'true')
    redirect.headers.set('Link', `<${url.toString()}>; rel="successor-version"`)
    redirect.headers.set('API-Version', 'v1')
    // Propagate correlation ID on the redirect response too
    const correlationId = req.headers.get('x-correlation-id') ?? crypto.randomUUID()
    redirect.headers.set('x-correlation-id', correlationId)
    if (corsHeaders) {
      for (const [k, v] of Object.entries(corsHeaders)) {
        redirect.headers.set(k, v)
      }
    }
    return redirect
  }

  // ── Correlation ID injection ──────────────────────────────────────────────
  const correlationId = req.headers.get('x-correlation-id') ?? crypto.randomUUID()
  const res = NextResponse.next({
    request: {
      headers: new Headers({
        ...Object.fromEntries(req.headers),
        'x-correlation-id': correlationId,
      }),
    },
  })
  res.headers.set('x-correlation-id', correlationId)
  res.headers.set('API-Version', 'v1')

  // ── Attach CORS headers ───────────────────────────────────────────────────
  if (corsHeaders) {
    for (const [k, v] of Object.entries(corsHeaders)) {
      res.headers.set(k, v)
    }
  }

  return res
}

export const config = {
  matcher: [
    // Run on all routes for HTTPS redirect
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
