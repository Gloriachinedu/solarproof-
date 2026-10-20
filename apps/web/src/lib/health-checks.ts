import { createServiceClient } from '@/lib/supabase'
import { env } from '@/env'

export const DEGRADED_THRESHOLD_MS = 300
export const TIMEOUT_MS = 450
/** Timeout for Stellar RPC checks (3 s per acceptance criteria). */
export const STELLAR_TIMEOUT_MS = 3000

export type CheckStatus = 'ok' | 'degraded' | 'error'

export interface CheckResult {
  status: CheckStatus
  latency_ms: number
  error?: string
}

export async function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms)
  })
  try {
    const result = await Promise.race([promise, timeout])
    clearTimeout(timer!)
    return result
  } catch (err) {
    clearTimeout(timer!)
    throw err
  }
}

export async function checkDatabase(): Promise<CheckResult> {
  const start = Date.now()
  try {
    const db = createServiceClient()
    await withTimeout(
      db.from('cooperatives').select('id', { count: 'exact', head: true }),
      TIMEOUT_MS
    )
    const latency_ms = Date.now() - start
    return { status: latency_ms > DEGRADED_THRESHOLD_MS ? 'degraded' : 'ok', latency_ms }
  } catch (err) {
    return { status: 'error', latency_ms: Date.now() - start, error: String(err) }
  }
}

export async function checkStellarRpc(): Promise<CheckResult> {
  const start = Date.now()
  try {
    const res = await withTimeout(
      fetch(env.NEXT_PUBLIC_STELLAR_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLedger', params: { xdr: false } }),
      }),
      STELLAR_TIMEOUT_MS
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const latency_ms = Date.now() - start
    return { status: latency_ms > DEGRADED_THRESHOLD_MS ? 'degraded' : 'ok', latency_ms }
  } catch (err) {
    return {
      status: 'error',
      latency_ms: Date.now() - start,
      error: 'unreachable',
    }
  }
}

export async function checkRedisUpstash(): Promise<CheckResult> {
  const start = Date.now()
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url) return { status: 'degraded', latency_ms: 0 }
  try {
    const res = await withTimeout(
      fetch(`${url}/get/__health__`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }),
      TIMEOUT_MS
    )
    const latency_ms = Date.now() - start
    return { status: res.ok ? (latency_ms > DEGRADED_THRESHOLD_MS ? 'degraded' : 'ok') : 'error', latency_ms }
  } catch (err) {
    return { status: 'error', latency_ms: Date.now() - start, error: String(err) }
  }
}

export async function checkRedisBull(): Promise<CheckResult> {
  const start = Date.now()
  try {
    const { getRedisConnection } = await import('@/lib/redis')
    const conn = getRedisConnection()
    const pong = await withTimeout(conn.ping(), TIMEOUT_MS)
    const latency_ms = Date.now() - start
    return { status: pong === 'PONG' ? (latency_ms > DEGRADED_THRESHOLD_MS ? 'degraded' : 'ok') : 'error', latency_ms }
  } catch (err) {
    return { status: 'error', latency_ms: Date.now() - start, error: String(err) }
  }
}
