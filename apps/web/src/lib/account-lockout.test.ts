import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the Redis connection so tests don't need a live Redis instance.
const mockRedis = {
  exists: vi.fn(),
  incr: vi.fn(),
  expire: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  ttl: vi.fn(),
}

vi.mock('@/lib/redis', () => ({
  getRedisConnection: () => mockRedis,
}))

import {
  isAccountLocked,
  recordFailedAttempt,
  resetFailedAttempts,
  unlockAccount,
  lockoutRemainingSeconds,
  MAX_ATTEMPTS,
  LOCKOUT_SECONDS,
  WINDOW_SECONDS,
} from '@/lib/account-lockout'

describe('account-lockout', () => {
  beforeEach(() => vi.clearAllMocks())

  // ── isAccountLocked ────────────────────────────────────────────────────────

  it('returns true when lockout key exists in Redis', async () => {
    mockRedis.exists.mockResolvedValue(1)
    expect(await isAccountLocked('user@example.com')).toBe(true)
  })

  it('returns false when lockout key does not exist', async () => {
    mockRedis.exists.mockResolvedValue(0)
    expect(await isAccountLocked('user@example.com')).toBe(false)
  })

  // ── recordFailedAttempt ────────────────────────────────────────────────────

  it('sets TTL on the first failed attempt', async () => {
    mockRedis.incr.mockResolvedValue(1)
    await recordFailedAttempt('user@example.com')
    expect(mockRedis.expire).toHaveBeenCalledWith(
      'login_attempts:user@example.com',
      WINDOW_SECONDS
    )
  })

  it('does not reset TTL on subsequent failures', async () => {
    mockRedis.incr.mockResolvedValue(3)
    await recordFailedAttempt('user@example.com')
    expect(mockRedis.expire).not.toHaveBeenCalled()
  })

  it('returns false before the threshold is reached', async () => {
    mockRedis.incr.mockResolvedValue(MAX_ATTEMPTS - 1)
    const justLocked = await recordFailedAttempt('user@example.com')
    expect(justLocked).toBe(false)
    expect(mockRedis.set).not.toHaveBeenCalled()
  })

  it('locks the account when MAX_ATTEMPTS is reached', async () => {
    mockRedis.incr.mockResolvedValue(MAX_ATTEMPTS)
    const justLocked = await recordFailedAttempt('user@example.com')
    expect(justLocked).toBe(true)
    expect(mockRedis.set).toHaveBeenCalledWith(
      'lockout:user@example.com',
      '1',
      'EX',
      LOCKOUT_SECONDS
    )
  })

  it('locks the account on any attempt beyond MAX_ATTEMPTS', async () => {
    mockRedis.incr.mockResolvedValue(MAX_ATTEMPTS + 2)
    const justLocked = await recordFailedAttempt('user@example.com')
    expect(justLocked).toBe(true)
  })

  // ── resetFailedAttempts ───────────────────────────────────────────────────

  it('deletes the attempts counter key', async () => {
    mockRedis.del.mockResolvedValue(1)
    await resetFailedAttempts('user@example.com')
    expect(mockRedis.del).toHaveBeenCalledWith('login_attempts:user@example.com')
  })

  // ── unlockAccount ─────────────────────────────────────────────────────────

  it('removes both lockout and attempts keys', async () => {
    mockRedis.del.mockResolvedValue(2)
    await unlockAccount('user@example.com')
    expect(mockRedis.del).toHaveBeenCalledWith(
      'lockout:user@example.com',
      'login_attempts:user@example.com'
    )
  })

  // ── lockoutRemainingSeconds ───────────────────────────────────────────────

  it('returns the positive TTL from Redis', async () => {
    mockRedis.ttl.mockResolvedValue(420)
    expect(await lockoutRemainingSeconds('user@example.com')).toBe(420)
  })

  it('returns 0 when key does not exist (TTL = -2)', async () => {
    mockRedis.ttl.mockResolvedValue(-2)
    expect(await lockoutRemainingSeconds('user@example.com')).toBe(0)
  })
})
