import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase'
import { invalidateMeterRevocation } from '@/lib/cache'
import { requireAuth, isAuthError } from '@/lib/auth'
import { auditLog } from '@/lib/audit'

const RevokeSchema = z.object({
  reason: z.string().trim().min(1).max(500),
})

const ParamsSchema = z.object({ id: z.string().uuid() })

/**
 * POST /api/meters/[id]/revoke
 *
 * Revokes a meter's public key. Revoked meters can no longer submit readings.
 * This action is permanent and recorded in the audit log.
 *
 * Requires operator JWT.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(req)
  if (isAuthError(auth)) return auth

  const resolvedParams = await params
  const parsedParams = ParamsSchema.safeParse(resolvedParams)
  if (!parsedParams.success) {
    return NextResponse.json({ error: parsedParams.error.flatten() }, { status: 400 })
  }

  const { id } = parsedParams.data
  const body = await req.json().catch(() => ({}))
  const parsed = RevokeSchema.safeParse(body)
  
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const db = createServiceClient()
  const now = new Date().toISOString()

  const { data, error } = await db
    .from('meters')
    .update({ 
      active: false, 
      revoked_at: now, 
      revocation_reason: parsed.data.reason 
    })
    .eq('id', id)
    .is('revoked_at', null)
    .select('id, serial_number, pubkey_hex')
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'Meter not found or already revoked' }, { status: 404 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await invalidateMeterRevocation(id)

  // Audit logging
  await auditLog(req, {
    operator_id: auth.user.id,
    action: 'meter.revoke',
    resource_id: id,
    metadata: {
      serial_number: data.serial_number,
      pubkey_hex: data.pubkey_hex,
      reason: parsed.data.reason,
    }
  })

  return NextResponse.json({ 
    message: 'Meter revoked successfully',
    id: data.id,
    revoked_at: now
  })
}
