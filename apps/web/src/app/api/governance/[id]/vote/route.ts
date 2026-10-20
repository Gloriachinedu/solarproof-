import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase'
import { requireAuth, isAuthError } from '@/lib/auth'

const VoteSchema = z.object({
  choice: z.enum(['for', 'against', 'abstain']),
})

const ParamsSchema = z.object({ id: z.string().uuid() })

/** POST /api/governance/[id]/vote — cast a vote */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req)
  if (isAuthError(auth)) return auth

  const parsedParams = ParamsSchema.safeParse(await params)
  if (!parsedParams.success) {
    return NextResponse.json({ error: parsedParams.error.flatten() }, { status: 400 })
  }
  const { id } = parsedParams.data

  const body = await req.json().catch(() => null)
  const parsed = VoteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  // Service role required: vote upsert must be able to read the parent proposal
  // across the cooperative boundary for validation, then write to votes.
  // See docs/adr/007-supabase-service-role-usage.md
  const db = createServiceClient()

  // Verify proposal exists and belongs to user's cooperative
  const { data: proposal, error: fetchError } = await db
    .from('proposals')
    .select('id, status, ends_at')
    .eq('id', id)
    .eq('cooperative_id', auth.cooperativeId)
    .single()

  if (fetchError || !proposal) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
  }

  if (proposal.status !== 'active' || new Date(proposal.ends_at) < new Date()) {
    return NextResponse.json({ error: 'Voting is closed for this proposal' }, { status: 400 })
  }

  // Record the vote
  const { error } = await db
    .from('votes')
    .upsert({
      proposal_id: id,
      voter_id: auth.user.id,
      choice: parsed.data.choice,
    })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ message: 'Vote recorded successfully' })
}
