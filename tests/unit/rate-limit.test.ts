import { afterEach, describe, expect, it } from 'vitest'
import { checkRateLimit, resetRateLimits } from '@/lib/rate-limit'

describe('checkRateLimit (R-05)', () => {
  afterEach(() => resetRateLimits())

  it('allows hits under the limit and counts down remaining', () => {
    const r1 = checkRateLimit('u1', 3, 60_000)
    const r2 = checkRateLimit('u1', 3, 60_000)
    const r3 = checkRateLimit('u1', 3, 60_000)
    expect(r1.ok).toBe(true)
    expect(r1.remaining).toBe(2)
    expect(r3.remaining).toBe(0)
  })

  it('blocks the hit over the limit with a Retry-After hint', () => {
    for (let i = 0; i < 3; i++) checkRateLimit('u2', 3, 60_000)
    const r4 = checkRateLimit('u2', 3, 60_000)
    expect(r4.ok).toBe(false)
    expect(r4.retryAfterSec).toBeGreaterThanOrEqual(1)
    expect(r4.retryAfterSec).toBeLessThanOrEqual(60)
  })

  it('keys are isolated per user', () => {
    for (let i = 0; i < 3; i++) checkRateLimit('a', 3, 60_000)
    expect(checkRateLimit('a', 3, 60_000).ok).toBe(false)
    expect(checkRateLimit('b', 3, 60_000).ok).toBe(true) // different key unaffected
  })

  it('windows reset after expiry (fake-clock friendly via tiny window)', async () => {
    const r1 = checkRateLimit('u3', 1, 20)
    expect(r1.ok).toBe(true)
    const blocked = checkRateLimit('u3', 1, 20)
    expect(blocked.ok).toBe(false)
    await new Promise((r) => setTimeout(r, 30))
    expect(checkRateLimit('u3', 1, 20).ok).toBe(true)
  })
})
