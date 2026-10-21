/**
 * Operator (cooperative) suspension check with Redis caching.
 *
 * The suspension state is cached in Upstash Redis with a 5-minute TTL so
 * that the readings ingestion path doesn't hit Supabase on every request
 * (issue #31).
 *
 * Cache key: `operator:suspended:<cooperative_id>`
 * TTL: 300 seconds (5 minutes)
 *
 * Falls back to a direct Supabase query when Redis is unavailable.
 */

import { createServiceClient } from '@/lib/supabase'

const SUSPENSION_TTL_SECONDS = 300 // 5 minutes
const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = process.env

function cacheKey(cooperativeId: string): string {
  return `operator:suspended:${cooperativeId}`
}

async function redisFetch(path: string, options: RequestInit = {}): Promise<unknown> {
  if (!UPSTASH_REDIS_REST_URL) {
    throw new Error('UPSTASH_REDIS_REST_URL is not configured')
  }
  const res = await fetch(`${UPSTASH_REDIS_REST_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    ...options,
  })
  const json = await res.json()
  if (!res.ok) throw new Error((json as { error?: string }).error ?? 'Redis error')
  return json
}

async function cacheGet(key: string): Promise<string | null> {
  try {
    const json = await redisFetch(`/get/${encodeURIComponent(key)}`) as { result: string | null }
    return json.result
  } catch {
    return null // Redis unavailable — fall back to DB
  }
}

async function cacheSet(key: string, value: string, ttl: number): Promise<void> {
  try {
    await redisFetch(`/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      body: JSON.stringify({ value, ex: ttl }),
    })
  } catch {
    // Non-fatal — we already have the answer from the DB
  }
}

/**
 * Check whether the given cooperative (operator) is currently suspended.
 *
 * Result is cached in Redis for 5 minutes. Returns `false` when the
 * cooperative is not found (not suspended by default).
 */
export async function isOperatorSuspended(cooperativeId: string): Promise<boolean> {
  const key = cacheKey(cooperativeId)

  // 1. Try cache first
  if (UPSTASH_REDIS_REST_URL) {
    const cached = await cacheGet(key)
    if (cached !== null) {
      return cached === '1'
    }
  }

  // 2. Cache miss — query Supabase
  const db = createServiceClient()
  const { data } = await db
    .from('cooperatives')
    .select('suspended')
    .eq('id', cooperativeId)
    .maybeSingle()

  const suspended = data?.suspended ?? false

  // 3. Populate cache
  if (UPSTASH_REDIS_REST_URL) {
    await cacheSet(key, suspended ? '1' : '0', SUSPENSION_TTL_SECONDS)
  }

  return suspended
}

/**
 * Invalidate the cached suspension state for a cooperative.
 * Must be called by the admin PATCH /api/admin/operators/:id route after
 * changing the suspended flag so the cache reflects the new state immediately.
 */
export async function invalidateOperatorSuspensionCache(cooperativeId: string): Promise<void> {
  if (!UPSTASH_REDIS_REST_URL) return
  try {
    await redisFetch(`/del/${encodeURIComponent(cacheKey(cooperativeId))}`, {
      method: 'POST',
    })
  } catch {
    // Non-fatal
  }
}
