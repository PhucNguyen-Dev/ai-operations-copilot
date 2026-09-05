// Integration test — calls the REAL Gemini API. Not part of `npm test`.
// Run explicitly: npm run test:integration (consumes free-tier quota).
import { describe, expect, it } from 'vitest'
import { generateJSON } from '@/lib/gemini'
import { validateLeadAnalysis } from '@/lib/ai/schemas'

// setupFiles (load-env.ts) has already populated process.env by the time
// this module is evaluated, so skipIf sees the real value at collection.
const hasKey = Boolean(process.env.GEMINI_API_KEY)

// The same contract the n8n pipeline's AI node enforces (F-004) — proves the
// convention's full request -> response -> validate -> normalize path.
const SYSTEM = [
  'You are the lead-qualification analyst for a mid-sized education and training company.',
  'Respond with ONLY a single JSON object with exactly these keys:',
  '{ "score": <integer 0-100, likelihood of conversion>, "category": "HOT"|"WARM"|"COLD", "intent": "HIGH"|"MEDIUM"|"LOW", "course": <string or null>, "timeline": <string or null>, "summary": <one-sentence summary of the lead>, "recommended_action": <concrete next action for the counselor> }',
].join('\n')

describe('generateJSON end-to-end (live Gemini)', () => {
  it.skipIf(!hasKey)('returns schema-valid normalized data for a HOT lead', async () => {
    const result = await generateJSON({
      tool: 'integration-test',
      system: SYSTEM,
      user: [
        'New lead received from test:',
        '- name: Integration Test',
        '- email: integration.test@example.com',
        '- phone: +84901234567',
        '- course of interest: IELTS',
        '- budget: 1500 USD',
        '- timeline: next 2 weeks',
        '- message: I need IELTS urgently for a scholarship deadline, please contact me.',
      ].join('\n'),
      validate: validateLeadAnalysis,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.score).toBeGreaterThanOrEqual(70) // HOT by our thresholds
      expect(result.data.category).toBe('HOT')
      expect(result.data.intent).toBe('HIGH')
      expect(typeof result.data.summary).toBe('string')
      expect(result.model).not.toContain('models/')
      expect(result.durationMs).toBeGreaterThan(0)
    }
  }, 60_000)

  it.skipIf(!hasKey)('maps a missing API key to a permanent AI_NOT_CONFIGURED error', async () => {
    const saved = process.env.GEMINI_API_KEY
    delete process.env.GEMINI_API_KEY
    try {
      const result = await generateJSON({
        tool: 'integration-test',
        system: 'x',
        user: 'x',
        validate: validateLeadAnalysis,
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('AI_NOT_CONFIGURED')
        expect(result.error.retryable).toBe(false)
      }
    } finally {
      process.env.GEMINI_API_KEY = saved
    }
  })

  it.skipIf(!hasKey)('maps a garbage key to a retryable=false AI_UNREACHABLE error', async () => {
    const saved = process.env.GEMINI_API_KEY
    process.env.GEMINI_API_KEY = 'invalid-key-for-error-path-test'
    try {
      const result = await generateJSON({
        tool: 'integration-test',
        system: 'x',
        user: 'x',
        validate: validateLeadAnalysis,
        maxAttempts: 1, // 401 is permanent — do not wait through backoff
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('AI_UNREACHABLE')
        expect(result.error.retryable).toBe(false)
        // R-03 discipline: the client-safe message must not contain the raw detail
        expect(result.error.message).toMatch(/^The AI service/)
      }
    } finally {
      process.env.GEMINI_API_KEY = saved
    }
  })
})
