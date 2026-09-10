import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getSystemPrompt,
  promptLedgerConfigured,
  committedPrompt,
  PromptLedgerError,
  resetPromptLedgerCache,
} from '@/lib/promptledger'
import committedReportGenerator from '@/prompts/report-generator.json'
import committedCampaignAnalyzer from '@/prompts/campaign-analyzer.json'
import committedContentGenerator from '@/prompts/content-generator.json'
import committedLessonPlanner from '@/prompts/lesson-planner.json'
import committedQuizGenerator from '@/prompts/quiz-generator.json'

// PromptLedger adapter with mocked fetch — verifies error-code mapping
// (fail closed when configured), the committed fallback when unconfigured,
// and the 60s TTL cache (same conventions as gateway-client.test.ts).

const okLiveResponse = (overrides = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({ version: 3, status: 'live', text: 'LIVE PROMPT TEXT', ...overrides }),
})

beforeEach(() => {
  process.env.PROMPTLEDGER_URL = 'http://localhost:4747'
  process.env.PROMPTLEDGER_API_KEY = 'plk_test'
  resetPromptLedgerCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  delete process.env.PROMPTLEDGER_URL
  delete process.env.PROMPTLEDGER_API_KEY
})

describe('promptLedgerConfigured', () => {
  it('true only when PROMPTLEDGER_URL is set', () => {
    expect(promptLedgerConfigured()).toBe(true)
    delete process.env.PROMPTLEDGER_URL
    expect(promptLedgerConfigured()).toBe(false)
  })
})

describe('getSystemPrompt — configured (live)', () => {
  it('returns the live prompt with version and source', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okLiveResponse()))
    const result = await getSystemPrompt({ app: 'ops-copilot', name: 'report-generator' })
    expect(result).toEqual({ source: 'live', version: 3, text: 'LIVE PROMPT TEXT' })
    // request hit the live endpoint and carried the key
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe('http://localhost:4747/api/prompts/ops-copilot/report-generator/live')
    expect(call[1].headers['x-api-key']).toBe('plk_test')
  })

  it('maps 404 (no live version) to permanent PL_NO_LIVE', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, text: async () => '{}' })))
    await expect(getSystemPrompt({ app: 'ops-copilot', name: 'report-generator' })).rejects.toMatchObject({
      name: 'PromptLedgerError',
      code: 'PL_NO_LIVE',
      retryable: false,
    })
  })

  it('maps 401/403 to PL_AUTH', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, text: async () => '{}' })))
    await expect(getSystemPrompt({ app: 'ops-copilot', name: 'report-generator' })).rejects.toMatchObject({
      code: 'PL_AUTH',
      retryable: false,
    })
  })

  it('maps network errors to retryable PL_UNREACHABLE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      })
    )
    await expect(getSystemPrompt({ app: 'ops-copilot', name: 'report-generator' })).rejects.toMatchObject({
      code: 'PL_UNREACHABLE',
      retryable: true,
    })
  })

  it('maps 5xx to retryable PL_UNREACHABLE and 4xx to permanent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, text: async () => '' })))
    await expect(getSystemPrompt({ app: 'a', name: 'b' })).rejects.toMatchObject({ code: 'PL_UNREACHABLE', retryable: true })
    resetPromptLedgerCache()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, text: async () => '' })))
    await expect(getSystemPrompt({ app: 'a', name: 'b' })).rejects.toMatchObject({ code: 'PL_UNREACHABLE', retryable: false })
  })

  it('treats a malformed live payload as PL_UNREACHABLE (never returns empty text)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okLiveResponse({ text: '   ' })))
    await expect(getSystemPrompt({ app: 'a', name: 'b' })).rejects.toMatchObject({ code: 'PL_UNREACHABLE' })
  })

  it('serves repeat calls from the TTL cache without a second fetch, then refetches after expiry', async () => {
    const fetchMock = vi.fn(async () => okLiveResponse())
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()

    await getSystemPrompt({ app: 'ops-copilot', name: 'report-generator' })
    const second = await getSystemPrompt({ app: 'ops-copilot', name: 'report-generator' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second.source).toBe('live')

    await vi.advanceTimersByTimeAsync(61_000)
    await getSystemPrompt({ app: 'ops-copilot', name: 'report-generator' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('getSystemPrompt — unconfigured (committed fallback)', () => {
  it('falls back to the committed prompt with a loud warning and no fetch', async () => {
    delete process.env.PROMPTLEDGER_URL
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      const result = await getSystemPrompt({ app: 'ops-copilot', name: 'report-generator' })
      expect(fetchMock).not.toHaveBeenCalled()
      expect(result.source).toBe('committed')
      expect(result.version).toBeNull()
      expect(result.text).toBe(committedReportGenerator.system)
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy.mock.calls[0][0]).toContain('PROMPTLEDGER_URL not set')
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('the committed copy matches the seed script contract (same JSON file)', () => {
    // single source of truth: the fallback and the seeder both read
    // prompts/report-generator.json — the registered v1 is byte-identical
    expect(committedPrompt('report-generator')).toBe(committedReportGenerator.system)
  })

  it('throws PL_NO_LIVE for a name with no committed prompt', () => {
    delete process.env.PROMPTLEDGER_URL
    expect(() => committedPrompt('no-such-prompt')).toThrow(PromptLedgerError)
  })

  it('every owned tool has a non-empty committed prompt (all 5 routes wired)', () => {
    const owned = ['report-generator', 'campaign-analyzer', 'content-generator', 'lesson-planner', 'quiz-generator']
    for (const name of owned) {
      expect(committedPrompt(name), name).toBeTruthy()
      expect(committedPrompt(name).length, name).toBeGreaterThan(50)
    }
    expect(committedPrompt('campaign-analyzer')).toBe(committedCampaignAnalyzer.system)
    expect(committedPrompt('content-generator')).toBe(committedContentGenerator.system)
    expect(committedPrompt('lesson-planner')).toBe(committedLessonPlanner.system)
    expect(committedPrompt('quiz-generator')).toBe(committedQuizGenerator.system)
  })
})
