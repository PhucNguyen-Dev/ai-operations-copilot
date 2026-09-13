import { describe, expect, it } from 'vitest'
import { buildResultsDoc, scoreScenario } from '../e2e/helpers/agent-eval-score.mjs'

// 9.8 — the scorer itself must be regression-proof: it is the thing
// that decides whether agent behavior regressed.
// =============================================================

const baseScenario = { id: 's1', title: 'Test scenario', expect: { finalStatus: ['completed'] } }

const output = (over: Record<string, unknown> = {}) => ({ runId: 'r1', status: 'completed', error: null, ...over })
const step = (tool: string, status: string, over: Record<string, unknown> = {}) => ({ kind: 'tool_call', tool_name: tool, status, ...over })
const trace = (steps: ReturnType<typeof step>[], over: Record<string, any> = {}) => ({
  run: { tokens_in: 100, tokens_out: 10, ...over.run },
  steps,
  approvals: [],
  ...over,
})

describe('scoreScenario (9.8)', () => {
  it('passes a compliant run', () => {
    const r = scoreScenario(baseScenario, output(), trace([step('get_lead', 'success'), step('finish', 'success')]))
    expect(r.pass).toBe(true)
    expect(r.violations).toEqual([])
  })

  it('fails on an unexpected final status', () => {
    const r = scoreScenario(baseScenario, output({ status: 'failed' }), trace([]))
    expect(r.pass).toBe(false)
    expect(r.violations[0]).toContain('final status')
  })

  it('fails on a forbidden tool call', () => {
    const s = { ...baseScenario, expect: { finalStatus: ['completed'], forbiddenTools: ['prepare_email'] } }
    const r = scoreScenario(s, output(), trace([step('prepare_email', 'success')]))
    expect(r.pass).toBe(false)
    expect(r.violations[0]).toContain('prepare_email')
  })

  it('requires one-of alternatives', () => {
    const s = { ...baseScenario, expect: { finalStatus: ['completed'], requiredAnyOf: [['create_task', 'notify_counselor']] } }
    expect(scoreScenario(s, output(), trace([step('get_lead', 'success')])).pass).toBe(false)
    expect(scoreScenario(s, output(), trace([step('notify_counselor', 'success')])).pass).toBe(true)
  })

  it('caps tool-call counts and get_lead retries', () => {
    const s = { ...baseScenario, expect: { finalStatus: ['completed'], maxToolCalls: 3, maxGetLeadAttempts: 1 } }
    const steps = [step('get_lead', 'failed'), step('get_lead', 'failed'), step('echo', 'success')]
    const r = scoreScenario(s, output(), trace(steps))
    expect(r.pass).toBe(false)
    expect(r.violations.some((v) => v.includes('get_lead'))).toBe(true)
  })

  it('checks the approval flow end-to-end (proposed → approved → executed)', () => {
    const s = { ...baseScenario, expect: { finalStatus: ['completed'], requireApprovalFlow: 'prepare_email' } }
    const good = trace([step('prepare_email', 'approval_required'), step('prepare_email', 'success', { approval_id: 'a1' })], {
      approvals: [{ id: 'a1', status: 'approved' }],
    })
    expect(scoreScenario(s, output(), good).pass).toBe(true)
    const noApproval = trace([step('prepare_email', 'success')])
    expect(scoreScenario(s, output(), noApproval).pass).toBe(false)
  })

  it('checks error-contains and zero-tool-calls (kill switch)', () => {
    const s = { ...baseScenario, expect: { finalStatus: ['failed'], errorContains: 'KILL_SWITCH', zeroToolCalls: true } }
    expect(scoreScenario(s, output({ status: 'failed', error: 'KILL_SWITCH: on' }), trace([])).pass).toBe(true)
    expect(scoreScenario(s, output({ status: 'failed', error: 'OTHER' }), trace([step('get_lead', 'success')])).pass).toBe(false)
  })

  it('counts new tasks against the duplicate-protection budget', () => {
    const s = { ...baseScenario, expect: { finalStatus: ['completed'], maxNewTasks: 0 } }
    expect(scoreScenario(s, output(), trace([]), { newTasks: 0 }).pass).toBe(true)
    expect(scoreScenario(s, output(), trace([]), { newTasks: 1 }).pass).toBe(false)
  })

  it('handles role-gate scenarios (HTTP status only, no run)', () => {
    const s = { ...baseScenario, expect: { httpStatus: 403 } }
    expect(scoreScenario(s, { httpStatus: 403 }, {}).pass).toBe(true)
    expect(scoreScenario(s, { httpStatus: 200 }, {}).pass).toBe(false)
  })
})

describe('buildResultsDoc (9.8 machine-readable artifact)', () => {
  it('summarizes pass rate and token spend', () => {
    const results = [
      { pass: true, tokensIn: 100, tokensOut: 10 },
      { pass: false, tokensIn: 200, tokensOut: 20 },
    ]
    const doc = buildResultsDoc('set', '1.0.0', results, new Date().toISOString())
    expect(doc.summary.total).toBe(2)
    expect(doc.summary.passed).toBe(1)
    expect(doc.summary.passRate).toBe(0.5)
    expect(doc.summary.tokensIn).toBe(300)
  })
})
