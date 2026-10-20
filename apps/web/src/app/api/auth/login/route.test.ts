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
import { POST } from '@/app/api/auth/login/route'

function makeRequest(body: unknown) {
  return {
    json: () => Promise.resolve(body),
  } as unknown as Parameters<typeof POST>[0]
}

function mockSupabase(session: unknown, error: unknown = null) {
  vi.mocked(createClient).mockReturnValue({
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ data: { session }, error }),
    },
  } as never)
}

describe('POST /api/auth/login', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 400 for missing email', async () => {
    const res = await POST(makeRequest({ password: 'password123' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid email format', async () => {
    const res = await POST(makeRequest({ email: 'not-an-email', password: 'password123' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for missing password', async () => {
    const res = await POST(makeRequest({ email: 'user@example.com' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for password shorter than 8 chars', async () => {
    const res = await POST(makeRequest({ email: 'user@example.com', password: 'short' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when body is not JSON', async () => {
    const req = { json: () => Promise.reject(new Error('bad json')) } as unknown as Parameters<typeof POST>[0]
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 401 when credentials are invalid', async () => {
    mockSupabase(null, { message: 'Invalid login credentials' })
    const res = await POST(makeRequest({ email: 'user@example.com', password: 'wrongpass' }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Invalid credentials')
  })

  it('returns 401 when session is null even without error', async () => {
    mockSupabase(null, null)
    const res = await POST(makeRequest({ email: 'user@example.com', password: 'password123' }))
    expect(res.status).toBe(401)
  })

  it('returns 200 with token data on successful login', async () => {
    mockSupabase({
      access_token: 'access-123',
      refresh_token: 'refresh-456',
      expires_in: 3600,
    })
    const res = await POST(makeRequest({ email: 'user@example.com', password: 'password123' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.access_token).toBe('access-123')
    expect(body.refresh_token).toBe('refresh-456')
    expect(body.expires_in).toBe(3600)
    expect(body.token_type).toBe('Bearer')
  })
})
