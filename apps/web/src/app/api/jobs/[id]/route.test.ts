import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  createServiceClient: vi.fn(),
}))

import { createServiceClient } from '@/lib/supabase'
import { GET } from '@/app/api/jobs/[id]/route'

function makeRequest() {
  return {} as unknown as Parameters<typeof GET>[0]
}

function makeParams(id: string = 'job-uuid-1234') {
  return { params: Promise.resolve({ id }) }
}

function mockDb(data: unknown, error: unknown = null) {
  vi.mocked(createServiceClient).mockReturnValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data, error }),
        }),
      }),
    }),
  } as never)
}

describe('GET /api/jobs/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 404 when job not found', async () => {
    mockDb(null, { code: 'PGRST116', message: 'not found' })
    const res = await GET(makeRequest(), makeParams())
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Job not found')
  })

  it('returns 404 when data is null without error', async () => {
    mockDb(null, null)
    const res = await GET(makeRequest(), makeParams())
    expect(res.status).toBe(404)
  })

  it('returns 200 with job data on success', async () => {
    const job = {
      id: 'job-uuid-1234',
      type: 'anchor_and_mint',
      status: 'completed',
      attempts: 1,
      result: { reading_id: 'r1' },
      error: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:01:00Z',
    }
    mockDb(job)
    const res = await GET(makeRequest(), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('job-uuid-1234')
    expect(body.type).toBe('anchor_and_mint')
    expect(body.status).toBe('completed')
  })

  it('returns job with failed status and error field', async () => {
    const job = {
      id: 'job-failed-1',
      type: 'anchor_and_mint',
      status: 'failed',
      attempts: 3,
      result: null,
      error: 'stellar network timeout',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:05:00Z',
    }
    mockDb(job)
    const res = await GET(makeRequest(), makeParams('job-failed-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('failed')
    expect(body.error).toBe('stellar network timeout')
  })
})
