import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
}))

import * as Sentry from '@sentry/nextjs'
import { POST } from '@/app/api/csp-report/route'

function makeRequest(body: unknown) {
  return {
    json: () => Promise.resolve(body),
  } as unknown as Parameters<typeof POST>[0]
}

describe('POST /api/csp-report', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 400 for non-object body', async () => {
    const req = {
      json: () => Promise.reject(new Error('bad json')),
    } as unknown as Parameters<typeof POST>[0]
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 204 for a valid csp-report payload and forwards to Sentry', async () => {
    const report = {
      'csp-report': {
        'blocked-uri': 'https://evil.example.com/script.js',
        'violated-directive': 'script-src',
        'document-uri': 'https://app.solarproof.io/dashboard',
      },
    }

    const res = await POST(makeRequest(report))
    expect(res.status).toBe(204)
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'CSP Violation',
      expect.objectContaining({
        level: 'warning',
        extra: { cspReport: report['csp-report'] },
        tags: expect.objectContaining({
          'csp.blocked_uri': 'https://evil.example.com/script.js',
          'csp.violated_directive': 'script-src',
        }),
      })
    )
  })

  it('returns 204 for a passthrough payload without csp-report key', async () => {
    const report = {
      'blocked-uri': 'https://evil.example.com/img.png',
      'violated-directive': 'img-src',
    }

    const res = await POST(makeRequest(report))
    expect(res.status).toBe(204)
    expect(Sentry.captureMessage).toHaveBeenCalledOnce()
  })

  it('includes correct Sentry tags for blocked-uri and violated-directive', async () => {
    await POST(
      makeRequest({
        'csp-report': {
          'blocked-uri': 'https://tracker.example.com',
          'violated-directive': 'connect-src',
        },
      })
    )

    const call = vi.mocked(Sentry.captureMessage).mock.calls[0]
    const options = call[1] as { tags: Record<string, string> }
    expect(options.tags['csp.blocked_uri']).toBe('https://tracker.example.com')
    expect(options.tags['csp.violated_directive']).toBe('connect-src')
  })
})
