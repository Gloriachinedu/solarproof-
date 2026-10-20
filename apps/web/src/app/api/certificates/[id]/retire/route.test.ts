import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/lib/stellar', () => ({
  retireCertificate: vi.fn(),
}))

vi.mock('@/lib/webhooks', () => ({
  fireWebhook: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/irec-bridge', () => ({
  triggerIRecRetirement: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/email', () => ({
  sendRetiredEmail: vi.fn().mockResolvedValue(undefined),
}))

import { createServiceClient } from '@/lib/supabase'
import { retireCertificate } from '@/lib/stellar'
import { POST } from '@/app/api/certificates/[id]/retire/route'

const CERT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

function makeRequest(body: unknown) {
  return {
    json: () => Promise.resolve(body),
  } as unknown as Parameters<typeof POST>[0]
}

function makeParams(id: string = CERT_ID) {
  return { params: Promise.resolve({ id }) }
}

function mockDb(cert: unknown, updateResult: unknown = null) {
  const selectSingle = vi.fn().mockResolvedValue({ data: cert, error: null })
  const updateSingle = vi.fn().mockResolvedValue(
    updateResult ?? { data: { ...cert as object, retired: true, retired_at: new Date().toISOString(), retired_by: 'GWALLET', retire_tx_hash: 'retire-tx-hash', cooperative_id: 'coop-1' }, error: null }
  )

  vi.mocked(createServiceClient).mockReturnValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ single: selectSingle }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({ single: updateSingle }),
        }),
      }),
    }),
  } as never)
}

describe('POST /api/certificates/[id]/retire', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 400 when id is not a UUID', async () => {
    const res = await POST(makeRequest({ wallet_address: 'GWALLET' }), { params: Promise.resolve({ id: 'not-a-uuid' }) })
    expect(res.status).toBe(400)
  })

  it('returns 400 when wallet_address is missing', async () => {
    mockDb({ id: CERT_ID, retired: false, kwh: 10 })
    const res = await POST(makeRequest({}), makeParams())
    expect(res.status).toBe(400)
  })

  it('returns 400 when wallet_address is empty', async () => {
    mockDb({ id: CERT_ID, retired: false, kwh: 10 })
    const res = await POST(makeRequest({ wallet_address: '' }), makeParams())
    expect(res.status).toBe(400)
  })

  it('returns 400 when body is not JSON', async () => {
    const req = { json: () => Promise.reject(new Error('bad json')) } as unknown as Parameters<typeof POST>[0]
    const res = await POST(req, makeParams())
    expect(res.status).toBe(400)
  })

  it('returns 404 when certificate not found', async () => {
    mockDb(null)
    const res = await POST(makeRequest({ wallet_address: 'GWALLET' }), makeParams())
    expect(res.status).toBe(404)
  })

  it('returns 409 when certificate is already retired', async () => {
    mockDb({ id: CERT_ID, retired: true, kwh: 10 })
    const res = await POST(makeRequest({ wallet_address: 'GWALLET' }), makeParams())
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('Certificate already retired')
  })

  it('returns 500 when retireCertificate throws', async () => {
    mockDb({ id: CERT_ID, retired: false, kwh: 10 })
    vi.mocked(retireCertificate).mockRejectedValue(new Error('stellar network error'))
    const res = await POST(makeRequest({ wallet_address: 'GWALLET' }), makeParams())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('stellar network error')
  })

  it('returns 200 with retirement details on success', async () => {
    mockDb({ id: CERT_ID, retired: false, kwh: 10, issued_at: new Date().toISOString() })
    vi.mocked(retireCertificate).mockResolvedValue('retire-tx-hash-123')
    const res = await POST(makeRequest({ wallet_address: 'GWALLET' }), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(CERT_ID)
    expect(body.retired).toBe(true)
    expect(body.retire_tx_hash).toBeDefined()
  })

  it('returns 500 when database update fails', async () => {
    mockDb({ id: CERT_ID, retired: false, kwh: 10, issued_at: new Date().toISOString() }, { data: null, error: { message: 'update failed' } })
    vi.mocked(retireCertificate).mockResolvedValue('retire-tx-hash-123')
    const res = await POST(makeRequest({ wallet_address: 'GWALLET' }), makeParams())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Failed to update certificate status')
  })
})
