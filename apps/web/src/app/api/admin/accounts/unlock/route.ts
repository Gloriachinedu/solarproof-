import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { unlockAccount, isAccountLocked } from '@/lib/account-lockout'
import { createServiceClient } from '@/lib/supabase'

const UnlockSchema = z.object({
  email: z.string().trim().email(),
})

/**
 * POST /api/admin/accounts/unlock
 *
 * Admin-only endpoint to immediately unlock a locked user account.
 *
 * Removes the Redis lockout flag and failure counter so the user may
 * attempt to log in again without waiting for the 15-minute TTL.
 * Appends an entry to the audit_log table.
 *
 * Authorization: Bearer <ADMIN_SECRET>
 *
 * Issue #115.
 */
export async function POST(req: NextRequest) {
  const authError = requireAdmin(req)
  if (authError) return authError

  const body = await req.json().catch(() => null)
  const parsed = UnlockSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { email } = parsed.data

  const wasLocked = await isAccountLocked(email)

  // Unlock regardless of current state (idempotent operation)
  await unlockAccount(email)

  // Record the admin action in the audit log
  try {
    const db = createServiceClient()
    await db.from('audit_logs').insert({
      actor: 'admin',
      action: 'account.unlock',
      resource: email,
      resource_id: null,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
          req.headers.get('x-real-ip') ??
          null,
      metadata: { was_locked: wasLocked } as unknown as import('@/lib/database.types').Json,
    })
  } catch (err) {
    // Audit log failure must not fail the unlock operation
    console.error('[admin unlock] audit log failed:', err)
  }

  return NextResponse.json({
    ok: true,
    email,
    was_locked: wasLocked,
    message: wasLocked
      ? `Account ${email} has been unlocked.`
      : `Account ${email} was not locked; failure counter reset.`,
  })
}
