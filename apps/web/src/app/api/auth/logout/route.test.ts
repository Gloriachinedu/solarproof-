import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn(),
  createUserClient: vi.fn(),
  revokeToken: vi.fn().mockResolvedValue(undefined),
}))

import { requireAuth, isAuthError, createUserClient, revokeToken } from '@/lib/auth'
import { POST } from '@/app/api/auth/logout/route'

function makeRequest() {
  return {} as unknown as Parameters<typeof POST>[0]
}

function mockAuth(authResult: unknown, isError: boolean) {
  vi.mocked(requireAuth).mockResolvedValue(authResult as never)
  vi.mocked(isAuthError).mockReturnValue(isError)
}

describe('POST /api/auth/logout', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns auth error response when not authenticated', async () => {
    const errorResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    mockAuth(errorResponse, true)
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
  })

  it('revokes the access token before signing out', async () => {
    const auth = { accessToken: 'tok-abc', userId: 'user-1', cooperativeId: 'coop-1' }
    mockAuth(auth, false)
    vi.mocked(createUserClient).mockReturnValue({
      auth: { signOut: vi.fn().mockResolvedValue({ error: null }) },
    } as never)

    await POST(makeRequest())
    expect(revokeToken).toHaveBeenCalledWith('tok-abc')
  })

  it('returns 200 ok on successful logout', async () => {
    const auth = { accessToken: 'tok-abc', userId: 'user-1', cooperativeId: 'coop-1' }
    mockAuth(auth, false)
    vi.mocked(createUserClient).mockReturnValue({
      auth: { signOut: vi.fn().mockResolvedValue({ error: null }) },
    } as never)

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('returns 500 when signOut fails', async () => {
    const auth = { accessToken: 'tok-abc', userId: 'user-1', cooperativeId: 'coop-1' }
    mockAuth(auth, false)
    vi.mocked(createUserClient).mockReturnValue({
      auth: { signOut: vi.fn().mockResolvedValue({ error: { message: 'signout failed' } }) },
    } as never)

    const res = await POST(makeRequest())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('signout failed')
  })
})
