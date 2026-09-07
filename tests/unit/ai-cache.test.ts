import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cacheGet, cacheKey, cacheSet, resetCache } from '@/lib/ai/cache'

describe('AI response cache (lib/ai/cache)', () => {
  beforeEach(() => resetCache())
  afterEach(() => vi.useRealTimers())

  it('miss on empty store, hit after set', () => {
    const key = cacheKey({ tool: 't', model: 'm', system: 's', user: 'u' })
    expect(cacheGet(key).hit).toBe(false)
    cacheSet(key, { a: 1 })
    const res = cacheGet(key)
    expect(res.hit).toBe(true)
    expect(res.value).toEqual({ a: 1 })
  })

  it('different inputs produce different keys', () => {
    const a = cacheKey({ tool: 't', model: 'm', system: 's', user: 'u1' })
    const b = cacheKey({ tool: 't', model: 'm', system: 's', user: 'u2' })
    const c = cacheKey({ tool: 't', model: 'm2', system: 's', user: 'u1' })
    expect(new Set([a, b, c]).size).toBe(3)
  })

  it('same inputs produce the same key (temperature/token defaults are stable)', () => {
    const a = cacheKey({ tool: 't', model: 'm', system: 's', user: 'u' })
    const b = cacheKey({ tool: 't', model: 'm', system: 's', user: 'u', temperature: undefined })
    const c = cacheKey({ tool: 't', model: 'm', system: 's', user: 'u', temperature: 0 })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('expired entries are treated as misses (TTL)', () => {
    vi.useFakeTimers()
    const key = cacheKey({ tool: 't', model: 'm', system: 's', user: 'u' })
    cacheSet(key, 'v')
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1)
    expect(cacheGet(key).hit).toBe(false)
  })

  it('evicts the oldest entry when the cap is reached', () => {
    const keys: string[] = []
    for (let i = 0; i < 50; i++) {
      const k = cacheKey({ tool: 't', model: 'm', system: 's', user: `u${i}` })
      keys.push(k)
      cacheSet(k, i)
    }
    // Inserting #51 evicts keys[0] (oldest, never re-read)
    cacheSet(cacheKey({ tool: 't', model: 'm', system: 's', user: 'overflow' }), 'x')
    expect(cacheGet(keys[0]).hit).toBe(false)
    expect(cacheGet(keys[1]).hit).toBe(true)
  })
})
