import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase'

const VALID_EVENTS = [
  'anchor',
  'mint',
  'retire',
  'mint_failed',
  'certificate.minted',
  'certificate.transferred',
  'certificate.retired',
] as const

const WebhookSchema = z.object({
  cooperative_id: z.string().uuid(),
  url: z.string().trim().url(),
  secret: z.string().trim().min(16),
  events: z.array(z.enum(VALID_EVENTS)).min(1),
})

const QuerySchema = z.object({
  cooperative_id: z.string().uuid(),
})

/**
 * POST /api/webhooks
 *
 * Register a webhook endpoint for a cooperative.
 * Body: { cooperative_id, url, secret, events }
 * Supported events: certificate.minted, certificate.transferred, certificate.retired
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = WebhookSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  // Service role required: webhook registration writes without a user JWT
  // (called from device/server contexts). See docs/adr/007-supabase-service-role-usage.md
  const db = createServiceClient()
  const { data, error } = await db
    .from('webhook_endpoints')
    .insert(parsed.data)
    .select('id, cooperative_id, url, events, active, created_at')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Failed to register webhook' }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

/**
 * GET /api/webhooks?cooperative_id=UUID
 *
 * List registered webhook endpoints for a cooperative.
 */
export async function GET(req: NextRequest) {
  const queryParams = Object.fromEntries(req.nextUrl.searchParams.entries())
  const parsedQuery = QuerySchema.safeParse(queryParams)
  
  if (!parsedQuery.success) {
    return NextResponse.json({ error: parsedQuery.error.flatten() }, { status: 400 })
  }

  const { cooperative_id: cooperativeId } = parsedQuery.data

  // Service role required: webhook listing may be called without a user JWT.
  // See docs/adr/007-supabase-service-role-usage.md
  const db = createServiceClient()
  const { data, error } = await db
    .from('webhook_endpoints')
    .select('id, cooperative_id, url, events, active, created_at')
    .eq('cooperative_id', cooperativeId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data: data ?? [] })
}
