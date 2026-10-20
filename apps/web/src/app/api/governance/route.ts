import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase'
import { requireAuth, isAuthError } from '@/lib/auth'

const ProposalSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(2000),
  action: z.string().trim().max(200).optional(),
  days: z.number().min(1).max(30).default(7),
})

/** GET /api/governance — list proposals for user's cooperative */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (isAuthError(auth)) return auth

  // Service role required: proposals JOIN votes needs cross-table visibility;
  // the auth JWT scopes results via .eq('cooperative_id', auth.cooperativeId).
  // See docs/adr/007-supabase-service-role-usage.md
  const db = createServiceClient()

  // Fetch proposals and their vote counts
  const { data, error } = await db
    .from('proposals')
    .select(`
      *,
      votes (
        choice
      )
    `)
    .eq('cooperative_id', auth.cooperativeId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Process votes into tallies and check if user has voted
  const proposals = (data ?? []).map((p) => {
    const votes = ((p as unknown as { votes?: { choice: string }[] }).votes) ?? []
    const tally = {
      for: votes.filter(v => v.choice === 'for').length,
      against: votes.filter(v => v.choice === 'against').length,
      abstain: votes.filter(v => v.choice === 'abstain').length,
    }
    
    return {
      ...p,
      tally,
      userVote: undefined, // Will be filled if needed, or handled client-side
    }
  })

  return NextResponse.json(proposals)
}

/** POST /api/governance — create a new proposal */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (isAuthError(auth)) return auth

  const body = await req.json().catch(() => null)
  const parsed = ProposalSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  // Service role required: insert needs to write cooperative_id FK without
  // triggering anon-key RLS write restriction. See docs/adr/007-supabase-service-role-usage.md
  const db = createServiceClient()

  const endsAt = new Date()
  endsAt.setDate(endsAt.getDate() + parsed.data.days)

  const { data, error } = await db
    .from('proposals')
    .insert({
      cooperative_id: auth.cooperativeId,
      title: parsed.data.title,
      description: parsed.data.description,
      action: parsed.data.action,
      ends_at: endsAt.toISOString(),
      status: 'active',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data, { status: 201 })
}
