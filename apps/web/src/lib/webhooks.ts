import { createHmac } from 'crypto'
import { createServiceClient } from '@/lib/supabase'
import type { Json } from '@/lib/database.types'

export type WebhookEvent =
  | 'anchor'
  | 'mint'
  | 'retire'
  | 'mint_failed'
  | 'certificate.minted'
  | 'certificate.transferred'
  | 'certificate.retired'
  | 'certificate.verified'
  | 'certificate.failed'

export interface WebhookPayload {
  event: WebhookEvent
  cooperative_id: string
  data: Record<string, unknown>
  timestamp: string
}

function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

const MAX_ATTEMPTS = 5

async function deliver(url: string, secret: string, payload: WebhookPayload): Promise<{ status: number; attempts: number }> {
  const body = JSON.stringify(payload)
  const sig = sign(secret, body)

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-SolarProof-Signature': sig },
        body,
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) return { status: res.status, attempts: attempt }
      if (attempt === MAX_ATTEMPTS) return { status: res.status, attempts: attempt }
    } catch {
      if (attempt === MAX_ATTEMPTS) throw new Error(`Webhook delivery failed after ${MAX_ATTEMPTS} attempts`)
    }
    // Exponential backoff: 1s, 2s, 4s, 8s between retries
    await new Promise((r) => setTimeout(r, 2 ** (attempt - 1) * 1000))
  }
  return { status: 0, attempts: MAX_ATTEMPTS }
}

/**
 * Fire a webhook event to all active endpoints subscribed to it.
 * Logs each delivery attempt. Never throws — failures are logged only.
 */
export async function fireWebhook(
  cooperative_id: string,
  event: WebhookEvent,
  data: Record<string, unknown>
): Promise<void> {
  const db = createServiceClient()

  const { data: endpoints } = await db
    .from('webhook_endpoints')
    .select('id, url, secret')
    .eq('cooperative_id', cooperative_id)
    .eq('active', true)
    .contains('events', [event])

  if (!endpoints?.length) return

  const payload: WebhookPayload = { event, cooperative_id, data, timestamp: new Date().toISOString() }

  await Promise.allSettled(
    endpoints.map(async (ep) => {
      let status = 'failed'
      let responseStatus: number | null = null
      let attempts = 0
      try {
        const result = await deliver(ep.url, ep.secret, payload)
        responseStatus = result.status
        attempts = result.attempts
        status = responseStatus >= 200 && responseStatus < 300 ? 'delivered' : 'failed'
      } catch {
        attempts = MAX_ATTEMPTS
      }
      await db.from('webhook_logs').insert({
        endpoint_id: ep.id,
        event,
        payload: payload as unknown as Json,
        status,
        attempts,
        response_status: responseStatus,
      })
    })
  )
}
