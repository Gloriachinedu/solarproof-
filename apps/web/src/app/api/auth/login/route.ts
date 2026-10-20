import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { env } from '@/env'

const LoginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().trim().min(8),
})

// Cookie names used for auth token storage.
// These must match the names read by requireAuth() in src/lib/auth.ts.
const ACCESS_TOKEN_COOKIE = 'sp_access_token'
const REFRESH_TOKEN_COOKIE = 'sp_refresh_token'

/**
 * POST /api/auth/login
 *
 * Exchanges email + password for Supabase session tokens and stores them in
 * HttpOnly, Secure, SameSite=Strict cookies so they are never accessible to
 * JavaScript (mitigates XSS token theft).
 *
 * The response body no longer contains the raw tokens — clients should treat
 * the presence of a 200 response as the success signal and rely on the cookies
 * being set automatically by the browser.
 *
 * Closes #113.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = LoginSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const supabase = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } }
  )

  const { data, error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error || !data.session) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const isProduction = process.env.NODE_ENV === 'production'
  const cookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict' as const,
    path: '/',
  }

  const res = NextResponse.json({
    ok: true,
    expires_in: data.session.expires_in,
    token_type: 'Bearer',
  })

  // Store the access token in an HttpOnly cookie.
  // expires_in is typically 3600 s (1 h) for Supabase access tokens.
  res.cookies.set(ACCESS_TOKEN_COOKIE, data.session.access_token, {
    ...cookieOptions,
    maxAge: data.session.expires_in ?? 3600,
  })

  // Store the refresh token in a separate HttpOnly cookie with a longer TTL.
  // Supabase refresh tokens are valid for 60 days by default.
  res.cookies.set(REFRESH_TOKEN_COOKIE, data.session.refresh_token, {
    ...cookieOptions,
    maxAge: 60 * 24 * 60 * 60, // 60 days
  })

  return res
}
