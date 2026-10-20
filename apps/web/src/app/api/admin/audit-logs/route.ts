import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase'

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

/**
 * GET /api/admin/audit-logs
 * Returns paginated audit logs. Requires SUPABASE_SERVICE_ROLE_KEY (server-only).
 * Query params: limit (default 50), offset (default 0)
 */
export async function GET(req: NextRequest) {
  const queryParams = Object.fromEntries(req.nextUrl.searchParams.entries())
  const parsed = QuerySchema.safeParse(queryParams)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { limit, offset } = parsed.data

  // Service role required: admin compliance export needs cross-tenant audit log
  // visibility. See docs/adr/007-supabase-service-role-usage.md
  const db = createServiceClient()
  const { data, error, count } = await db
    .from('audit_logs')
    .select('*', { count: 'exact' })
    .order('timestamp', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data, total: count, limit, offset })
}
