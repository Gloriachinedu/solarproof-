import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import type { Database } from './database.types'
import { env } from '@/env'

/**
 * Create a Supabase client that validates the caller's JWT (anon key, RLS enforced).
 */
export function createUserClient(accessToken: string) {
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false },
    }
  )
}

/** Service-role client — bypasses RLS, used for revocation list writes. */
function createServiceClient() {
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  )
}

/**
 * Decode the JTI claim from a JWT without verifying the signature.
 * Verification is handled by Supabase's getUser() call.
 */
function extractJti(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    return typeof payload.jti === 'string' ? payload.jti : null
  } catch {
    return null
  }
}

/**
 * Check whether a token's JTI appears in the revocation list.
 * Returns true if the token has been revoked.
 */
async function isRevoked(jti: string): Promise<boolean> {
  const db = createServiceClient()
  const { data } = await db
    .from('revoked_tokens')
    .select('jti')
    .eq('jti', jti)
    .maybeSingle()
  return data !== null
}

/**
 * Add a token's JTI to the revocation list.
 * expires_at is set to now + 15 minutes (access token max lifetime).
 */
export async function revokeToken(accessToken: string): Promise<void> {
  const jti = extractJti(accessToken)
  if (!jti) return
  const db = createServiceClient()
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
  await db.from('revoked_tokens').upsert({ jti, expires_at: expiresAt })
}

// Cookie name that /api/auth/login sets with the access token.
// Must stay in sync with the name used in the login/logout route handlers.
const ACCESS_TOKEN_COOKIE = 'sp_access_token'

/**
 * Extract and validate the Bearer JWT from either:
 *   1. The `sp_access_token` HttpOnly cookie (set by /api/auth/login), or
 *   2. The `Authorization: Bearer <token>` header (for API / non-browser clients).
 *
 * Cookie auth is preferred — it prevents JavaScript from accessing the token
 * and mitigates XSS token theft (issue #113).
 *
 * Also checks the revocation list before accepting the token.
 */
export async function requireAuth(
  req: NextRequest
): Promise<{ user: { id: string; email?: string }; accessToken: string; cooperativeId: string } | NextResponse> {
  // Prefer HttpOnly cookie over Authorization header.
  const cookieToken = req.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null
  const authHeader = req.headers.get('authorization') ?? ''
  const headerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  const accessToken = cookieToken ?? headerToken

  if (!accessToken) {
    return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 })
  }

  // Check revocation list before hitting Supabase
  const jti = extractJti(accessToken)
  if (jti && (await isRevoked(jti))) {
    return NextResponse.json({ error: 'Token has been revoked' }, { status: 401 })
  }

  const client = createUserClient(accessToken)
  const { data, error } = await client.auth.getUser()

  if (error || !data.user) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
  }

  const cooperativeId = data.user.app_metadata.cooperative_id
  if (!cooperativeId) {
    return NextResponse.json({ error: 'User has no associated cooperative' }, { status: 403 })
  }

  return {
    user: { id: data.user.id, email: data.user.email },
    accessToken,
    cooperativeId,
  }
}

/**
 * Type guard: returns `true` when `requireAuth` returned a `NextResponse`.
 */
export function isAuthError(result: unknown): result is NextResponse {
  return result instanceof NextResponse
}
