import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'unit-test-placeholder')
  vi.stubEnv('RATE_LIMIT_BACKEND', 'postgres')
  vi.stubEnv('CACHE_BACKEND', 'postgres')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('Postgres fail-open behavior', () => {
  it.each(['returned', 'thrown'])('allows requests and logs a %s limiter error', async (mode) => {
    if (mode === 'returned') mocks.rpc.mockResolvedValue({ data: null, error: { message: 'database unavailable' } })
    else mocks.rpc.mockRejectedValue(new Error('database unavailable'))
    const { rateLimiter } = await import('@/lib/rate-limit')
    expect(await rateLimiter.check('client-1', 60, 60_000)).toEqual({ ok: true, retryAfterSec: 0, remaining: 60 })
    expect(mocks.rpc).toHaveBeenCalledWith('rate_limit_hit', { p_key: 'client-1', p_limit: 60, p_window_ms: 60_000 })
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('deliberately failing open'))
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('database unavailable'))
  })

  it('preserves successful backend limit decisions', async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: false, retry_after_sec: 30, remaining: 0 }, error: null })
    const { rateLimiter } = await import('@/lib/rate-limit')
    expect(await rateLimiter.check('client-1', 60, 60_000)).toEqual({ ok: false, retryAfterSec: 30, remaining: 0 })
    expect(console.error).not.toHaveBeenCalled()
  })

  it.each(['read', 'write', 'eviction'])('logs a returned cache %s error without blocking generation', async (operation) => {
    const failure = { data: null, error: { message: 'database unavailable' } }
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), delete: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(operation === 'eviction'
        ? { data: [{ value: 'old', expires_at: '2000-01-01T00:00:00Z' }], error: null } : failure),
      upsert: vi.fn().mockResolvedValue(failure),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(failure).then(resolve),
    }
    mocks.from.mockReturnValue(query)
    const { cacheGet, cacheSet } = await import('@/lib/ai/cache')
    if (operation === 'write') await expect(cacheSet('key', 'value')).resolves.toBeUndefined()
    else expect(await cacheGet('key')).toEqual({ hit: false })
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('deliberately failing open'))
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('database unavailable'))
  })

  it.each(['read', 'write'])('logs a thrown cache %s error and preserves fallback', async (operation) => {
    mocks.from.mockImplementation(() => { throw new Error('connection refused') })
    const { cacheGet, cacheSet } = await import('@/lib/ai/cache')
    if (operation === 'write') await expect(cacheSet('key', 'value')).resolves.toBeUndefined()
    else expect(await cacheGet('key')).toEqual({ hit: false })
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('deliberately failing open'))
  })
})
