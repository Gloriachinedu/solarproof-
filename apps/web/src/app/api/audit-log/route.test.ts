import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  createServiceClient: vi.fn(),
}))

import { createServiceClient } from '@/lib/supabase'
import { GET } from '@/app/api/audit-log/route'

function makeRequest(params: Record<string, string> = {}) {
  const searchParams = new URLSearchParams(params)
  return {
    nextUrl: { searchParams },
  } as unknown as Parameters<typeof GET>[0]
}

function mockDb(data: unknown[], error: unknown = null) {
  const query = {
    select: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
  }
  // Make the final call (order) resolve with data
  query.order.mockResolvedValue({ data, error })

  vi.mocked(createServiceClient).mockReturnValue({
    from: vi.fn().mockReturnValue(query),
  } as never)

  return query
}

describe('GET /api/audit-log', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns CSV with headers on empty result', async () => {
    mockDb([])
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('id,operator_id,action,resource_id,ip_address,metadata,created_at')
    expect(res.headers.get('Content-Type')).toContain('text/csv')
  })

  it('includes Content-Disposition header with filename', async () => {
    mockDb([])
    const res = await GET(makeRequest())
    expect(res.headers.get('Content-Disposition')).toMatch(/attachment; filename="audit_log_/)
  })

  it('returns CSV rows for each audit log entry', async () => {
    mockDb([
      {
        id: 'log-1',
        actor: 'user-123',
        action: 'mint',
        resource: 'certificate',
        resource_id: 'cert-abc',
        ip: '1.2.3.4',
        metadata: { kwh: 10 },
        timestamp: '2026-01-01T00:00:00Z',
      },
    ])
    const res = await GET(makeRequest())
    const text = await res.text()
    expect(text).toContain('log-1')
    expect(text).toContain('mint')
    expect(text).toContain('cert-abc')
  })

  it('applies operator_id filter when provided', async () => {
    const query = mockDb([])
    await GET(makeRequest({ operator_id: 'user-456' }))
    expect(query.eq).toHaveBeenCalledWith('actor', 'user-456')
  })

  it('applies from/to date filters when provided', async () => {
    const query = mockDb([])
    const from = '2026-01-01T00:00:00Z'
    const to = '2026-01-31T23:59:59Z'
    await GET(makeRequest({ from, to }))
    expect(query.gte).toHaveBeenCalledWith('timestamp', from)
    expect(query.lte).toHaveBeenCalledWith('timestamp', to)
  })

  it('returns 500 when database query fails', async () => {
    mockDb([], { message: 'connection error' })
    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('connection error')
  })
})
