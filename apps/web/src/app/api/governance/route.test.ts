import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn(),
}))

import { createServiceClient } from '@/lib/supabase'
import { requireAuth, isAuthError } from '@/lib/auth'
import { GET, POST } from '@/app/api/governance/route'

const AUTH = { userId: 'user-1', cooperativeId: 'coop-1', accessToken: 'tok' }

function makeRequest(body?: unknown) {
  return {
    json: () => Promise.resolve(body),
  } as unknown as Parameters<typeof GET>[0]
}

function mockAuth(isError = false) {
  vi.mocked(requireAuth).mockResolvedValue(AUTH as never)
  vi.mocked(isAuthError).mockReturnValue(isError)
}

function mockAuthError() {
  const errorRes = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  vi.mocked(requireAuth).mockResolvedValue(errorRes as never)
  vi.mocked(isAuthError).mockReturnValue(true)
}

function mockDbSelect(data: unknown[], error: unknown = null) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error }),
  }
  vi.mocked(createServiceClient).mockReturnValue({
    from: vi.fn().mockReturnValue(query),
  } as never)
  return query
}

function mockDbInsert(data: unknown, error: unknown = null) {
  vi.mocked(createServiceClient).mockReturnValue({
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data, error }),
        }),
      }),
    }),
  } as never)
}

describe('GET /api/governance', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns auth error when unauthenticated', async () => {
    mockAuthError()
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns 200 with empty proposals array', async () => {
    mockAuth()
    mockDbSelect([])
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(0)
  })

  it('returns proposals with vote tallies', async () => {
    mockAuth()
    mockDbSelect([
      {
        id: 'prop-1',
        title: 'Add new meter',
        description: 'Add meter to coop',
        status: 'active',
        cooperative_id: 'coop-1',
        ends_at: '2026-12-31T00:00:00Z',
        votes: [
          { choice: 'for' },
          { choice: 'for' },
          { choice: 'against' },
        ],
      },
    ])
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body[0].tally.for).toBe(2)
    expect(body[0].tally.against).toBe(1)
    expect(body[0].tally.abstain).toBe(0)
  })

  it('returns 500 when database errors', async () => {
    mockAuth()
    mockDbSelect([], { message: 'db error' })
    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
  })
})

describe('POST /api/governance', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns auth error when unauthenticated', async () => {
    mockAuthError()
    const res = await POST(makeRequest({ title: 'Test', description: 'A proposal', days: 7 }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when title is missing', async () => {
    mockAuth()
    const res = await POST(makeRequest({ description: 'A proposal' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when description is missing', async () => {
    mockAuth()
    const res = await POST(makeRequest({ title: 'Test proposal' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when title exceeds 120 chars', async () => {
    mockAuth()
    const res = await POST(makeRequest({ title: 'a'.repeat(121), description: 'desc' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when days is out of range', async () => {
    mockAuth()
    const res = await POST(makeRequest({ title: 'Test', description: 'desc', days: 31 }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when body is not JSON', async () => {
    mockAuth()
    const req = { json: () => Promise.reject(new Error('bad json')) } as unknown as Parameters<typeof POST>[0]
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 201 with created proposal on success', async () => {
    mockAuth()
    const proposal = { id: 'prop-new', title: 'Test', description: 'desc', status: 'active' }
    mockDbInsert(proposal)
    const res = await POST(makeRequest({ title: 'Test', description: 'desc' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe('prop-new')
  })

  it('returns 500 when database insert fails', async () => {
    mockAuth()
    mockDbInsert(null, { message: 'insert failed' })
    const res = await POST(makeRequest({ title: 'Test', description: 'desc' }))
    expect(res.status).toBe(500)
  })
})
