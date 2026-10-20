import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/env', () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  },
}))

import { createClient } from '@supabase/supabase-js'
import { POST } from '@/app/api/auth/refresh/route'

function makeRequest(body: unknown) {
  return {
    json: () => Promise.resolve(body),
  } as unknown as Parameters<typeof POST>[0]
}

function mockSupabase(session: unknown, error: unknown = null) {
  vi.mocked(createClient).mockReturnValue({
    auth: {
      refreshSession: vi.fn().mockResolvedValue({ data: { session }, error }),
    },
  } as never)
}

describe('POST /api/auth/refresh', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 400 when body is missing', async () => {
    const req = { json: () => Promise.resolve(null) } as unknown as Parameters<typeof POST>[0]
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when refresh_token is missing', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it('returns 400 when refresh_token is empty string', async () => {
    const res = await POST(makeRequest({ refresh_token: '' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when body is not JSON', async () => {
    const req = { json: () => Promise.reject(new Error('bad json')) } as unknown as Parameters<typeof POST>[0]
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 401 when refresh token is invalid', async () => {
    mockSupabase(null, { message: 'Invalid refresh token' })
    const res = await POST(makeRequest({ refresh_token: 'bad-token' }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Invalid or expired refresh token')
  })

  it('returns 401 when session is null without error', async () => {
    mockSupabase(null, null)
    const res = await POST(makeRequest({ refresh_token: 'stale-token' }))
    expect(res.status).toBe(401)
  })

  it('returns 200 with new token pair on success', async () => {
    mockSupabase({
      access_token: 'new-access-789',
      refresh_token: 'new-refresh-012',
      expires_in: 3600,
    })
    const res = await POST(makeRequest({ refresh_token: 'valid-refresh-token' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.access_token).toBe('new-access-789')
    expect(body.refresh_token).toBe('new-refresh-012')
    expect(body.token_type).toBe('Bearer')
  })
})
