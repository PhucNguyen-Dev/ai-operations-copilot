import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { gatewayGenerate, gatewayConfigured, CODE_MAP } from '@/lib/gateway-client'
import { resetCache } from '@/lib/ai/cache'
import { validateContentDraft } from '@/lib/ai/schemas'
import { CONTENT_DRAFT_SCHEMA } from '@/lib/ai/json-schemas'

// Gateway adapter with mocked fetch — verifies envelope mapping, error-code
// translation, and the double schema gate (Gateway schema + local validator).

const baseOpts = {
  tool: 'F-020',
  system: 's',
  user: 'u',
  validate: validateContentDraft,
}

const okGatewayResponse = (data: unknown, meta = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({
    data,
    meta: { request_id: 'req_x', model: 'gemini-test', tokens_in: 5, tokens_out: 5, latency_ms: 100, cached: false, ...meta },
  }),
})

beforeEach(() => {
  process.env.AI_GATEWAY_URL = 'http://localhost:3000'
  process.env.AI_GATEWAY_KEY = 'gw_live_test'
  resetCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('gatewayConfigured', () => {
  it('true only when both URL and key are set', () => {
    expect(gatewayConfigured()).toBe(true)
    delete process.env.AI_GATEWAY_KEY
    expect(gatewayConfigured()).toBe(false)
  })
})

describe('gatewayGenerate', () => {
  it('returns validated data + metadata on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okGatewayResponse({ headlines: ['a', 'b', 'c'], ad_copy: 'copy', ctas: ['x', 'y'] }))
    )
    const result = await gatewayGenerate({ ...baseOpts, schema: CONTENT_DRAFT_SCHEMA })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.model).toBe('gemini-test')
      expect(result.cached).toBe(false)
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    }
    // request body carried the tool schema + prompt_version
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const sent = JSON.parse(call[1].body)
    expect(sent.tool).toBe('F-020')
    expect(sent.prompt_version).toBe('v1')
    expect(sent.schema).toEqual(CONTENT_DRAFT_SCHEMA)
  })

  it('runs the LOCAL validator as the second gate (mismatch -> permanent)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okGatewayResponse({ wrong: 'shape' })))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const result = await gatewayGenerate({ ...baseOpts, schema: CONTENT_DRAFT_SCHEMA })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('AI_SCHEMA_MISMATCH')
        expect(result.error.retryable).toBe(false)
        // client-safe phrasing — the raw validator errors stay in logs
        expect(result.error.message).toBe('The AI returned an unexpected response format — try again.')
      }
    } finally {
      consoleSpy.mockRestore()
    }
  })

  it('maps 401 UNAUTHORIZED to permanent AI_CONFIG', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Invalid API key.', retryable: false } }),
      }))
    )
    const result = await gatewayGenerate(baseOpts)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('AI_CONFIG')
      expect(result.error.retryable).toBe(false)
      // client-safe phrasing — the raw "Invalid API key." detail stays server-side
      expect(result.error.message).toBe('The AI service is misconfigured (bad key or retired model) — contact the admin.')
    }
  })

  it('maps 429 RATE_LIMITED to retryable AI_UNREACHABLE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'slow down', retryable: true } }),
      }))
    )
    const result = await gatewayGenerate(baseOpts)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('AI_UNREACHABLE')
      expect(result.error.retryable).toBe(true)
    }
  })

  it('passes through Gateway AI_SCHEMA_MISMATCH', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 502,
        text: async () => JSON.stringify({ error: { code: 'AI_SCHEMA_MISMATCH', message: 'schema mismatch', retryable: false } }),
      }))
    )
    const result = await gatewayGenerate(baseOpts)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('AI_SCHEMA_MISMATCH')
  })

  it('treats network errors as transient AI_UNREACHABLE', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }))
    const result = await gatewayGenerate(baseOpts)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('AI_UNREACHABLE')
      expect(result.error.retryable).toBe(true)
    }
  })

  it('fails AI_NOT_CONFIGURED without a fetch when gateway env is missing', async () => {
    delete process.env.AI_GATEWAY_URL
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await gatewayGenerate(baseOpts)
    expect(fetchMock).not.toHaveBeenCalled()
    if (!result.ok) expect(result.error.code).toBe('AI_NOT_CONFIGURED')
  })

  it('serves identical repeat calls from the local cache without a second fetch', async () => {
    const fetchMock = vi.fn(
      async () => okGatewayResponse({ headlines: ['a', 'b', 'c'], ad_copy: 'copy', ctas: ['x', 'y'] })
    )
    vi.stubGlobal('fetch', fetchMock)
    const opts = { ...baseOpts, schema: CONTENT_DRAFT_SCHEMA }
    await gatewayGenerate(opts)
    const second = await gatewayGenerate(opts)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second.ok).toBe(true)
    if (second.ok) expect(second.cached).toBe(true)
  })
})

describe('error-code mapping table', () => {
  it('classifies auth/config as permanent, rate-limit/transient as retryable', () => {
    expect(CODE_MAP.UNAUTHORIZED).toMatchObject({ retryable: false })
    expect(CODE_MAP.VALIDATION).toMatchObject({ retryable: false })
    expect(CODE_MAP.RATE_LIMITED).toMatchObject({ retryable: true })
    expect(CODE_MAP.AI_UNREACHABLE).toMatchObject({ retryable: true })
    expect(CODE_MAP.AI_SCHEMA_MISMATCH).toMatchObject({ retryable: false })
  })
})
