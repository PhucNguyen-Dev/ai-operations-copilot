import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GUARDRAIL_LIMITS,
  activeRunTimeMs,
  clampTurnCalls,
  evaluateRunGuards,
  refusalFeedback,
} from '@/lib/agent/guardrails'

// 9.6 — bounded autonomy: step, time and token budgets; per-turn call
// caps; refusal feedback shape the model receives.
// =============================================================

const baseRun = {
  step_count: 0,
  tokens_in: 0,
  tokens_out: 0,
  max_steps: DEFAULT_GUARDRAIL_LIMITS.maxSteps,
  started_at: new Date().toISOString(),
}

describe('evaluateRunGuards (9.6)', () => {
  it('allows a fresh run', () => {
    expect(evaluateRunGuards(baseRun, DEFAULT_GUARDRAIL_LIMITS)).toEqual({ ok: true })
  })

  it('blocks at the step cap', () => {
    const r = evaluateRunGuards({ ...baseRun, step_count: 12 }, DEFAULT_GUARDRAIL_LIMITS)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('step_limit')
  })

  it('uses the run row max_steps, not the default config', () => {
    const r = evaluateRunGuards({ ...baseRun, step_count: 3, max_steps: 3 }, DEFAULT_GUARDRAIL_LIMITS)
    expect(r.ok).toBe(false)
  })

  it('blocks when the token budget is exceeded', () => {
    const r = evaluateRunGuards(
      { ...baseRun, tokens_in: 30_000, tokens_out: 31_000 },
      DEFAULT_GUARDRAIL_LIMITS
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('token_budget')
  })

  it('blocks after the wall-clock timeout', () => {
    const started = new Date(Date.now() - DEFAULT_GUARDRAIL_LIMITS.runTimeoutMs - 1_000).toISOString()
    const r = evaluateRunGuards({ ...baseRun, started_at: started }, DEFAULT_GUARDRAIL_LIMITS)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('timeout')
  })

  it('excludes accumulated human-wait time from the run budget', () => {
    const started = new Date(Date.now() - 180_000).toISOString()
    const waitStart = new Date(Date.now() - 120_000).toISOString()
    const r = evaluateRunGuards(
      { ...baseRun, started_at: started, approval_wait_ms: 0, approval_wait_started_at: waitStart },
      DEFAULT_GUARDRAIL_LIMITS
    )
    expect(r.ok).toBe(true)
  })

  it('excludes previously accumulated human-wait time from the run budget', () => {
    const started = new Date(Date.now() - 180_000).toISOString()
    const r = evaluateRunGuards(
      { ...baseRun, started_at: started, approval_wait_ms: 120_000 },
      DEFAULT_GUARDRAIL_LIMITS
    )
    expect(r.ok).toBe(true)
  })

  it('activeRunTimeMs stays non-negative across suspicious clocks', () => {
    expect(activeRunTimeMs({ started_at: new Date(Date.now() + 10_000).toISOString() })).toBe(0)
  })
})

describe('clampTurnCalls (9.6)', () => {
  it('keeps calls within the per-turn cap', () => {
    const calls = [1, 2, 3, 4, 5]
    const { honored, skipped } = clampTurnCalls(calls, DEFAULT_GUARDRAIL_LIMITS)
    expect(honored).toEqual([1, 2, 3])
    expect(skipped).toBe(2)
  })

  it('passes short turns through untouched', () => {
    expect(clampTurnCalls([1, 2], DEFAULT_GUARDRAIL_LIMITS)).toEqual({ honored: [1, 2], skipped: 0 })
  })
})

describe('refusalFeedback', () => {
  it('shapes a refusal the model can observe but never execute', () => {
    const fb = refusalFeedback('DENIED: nope')
    expect(fb.result.ok).toBe(false)
    expect(fb.result.refused).toBe(true)
    expect(fb.result.reason).toContain('DENIED')
  })
})
