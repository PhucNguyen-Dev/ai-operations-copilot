import { describe, expect, it } from 'vitest'
import {
  buildSessionContext,
  emptySessionContext,
  leadDescriptorFromStep,
  parseSessionContext,
  renderSessionContext,
  SESSION_CONTEXT_LIMITS,
  SESSION_CONTEXT_MAX_CHARS,
  type SessionContext,
} from '@/lib/agent/session-context'

// =============================================================
// Durable session memory — the context must be derived (not a
// transcript), hard-capped, merge-safe, and lossless through its
// JSON round-trip. These are the invariants the runtime relies on.
// =============================================================

const RUN = (goal: string, final_outcome: string | null) => ({
  goal,
  status: 'completed' as const,
  final_outcome,
})

describe('leadDescriptorFromStep', () => {
  it('extracts a lead with category/score/email when present', () => {
    const d = leadDescriptorFromStep({
      tool_name: 'get_lead',
      args_snapshot: { lead_id: 'lead-1', name: 'Emma' },
      result_summary: { category: 'HOT', score: 91, email: 'emma@x.dev' },
    })
    expect(d).toEqual({ id: 'lead-1', name: 'Emma', category: 'HOT', score: 91, email: 'emma@x.dev' })
  })

  it('returns null for steps without a lead reference', () => {
    expect(leadDescriptorFromStep({ tool_name: 'search_knowledge', args_snapshot: { query: 'x' }, result_summary: {} })).toBeNull()
  })

  it('rejects malformed emails and non-numeric scores', () => {
    const d = leadDescriptorFromStep({
      tool_name: 'get_lead',
      args_snapshot: { lead_id: 'lead-1', name: 'X' },
      result_summary: { email: 'not-an-email', score: 'high' },
    })
    expect(d?.email).toBeUndefined()
    expect(d?.score).toBeUndefined()
  })
})

describe('buildSessionContext', () => {
  it('appends goal + summary and tracks the focused lead', () => {
    const ctx = buildSessionContext(
      emptySessionContext(),
      RUN('show hot leads', 'Top: Emma (HOT 91)'),
      [{ tool_name: 'get_lead', args_snapshot: { lead_id: 'lead-1', name: 'Emma' }, result_summary: { category: 'HOT', score: 91 } }],
    )
    expect(ctx.recentGoals).toEqual(['show hot leads'])
    expect(ctx.recentSummaries).toEqual(['Top: Emma (HOT 91)'])
    expect(ctx.leads['lead-1']).toMatchObject({ name: 'Emma', category: 'HOT', score: 91 })
    expect(ctx.lastFocusLeadId).toBe('lead-1')
  })

  it('merges onto previous context without duplicating history', () => {
    const first = buildSessionContext(emptySessionContext(), RUN('g1', 's1'), [])
    const second = buildSessionContext(first, RUN('g2', 's2'), [])
    expect(second.recentGoals).toEqual(['g1', 'g2'])
    expect(second.recentSummaries).toEqual(['s1', 's2'])
  })

  it('caps goals/summaries and the lead map', () => {
    let ctx = emptySessionContext()
    for (let i = 0; i < 20; i++) {
      ctx = buildSessionContext(ctx, RUN(`g${i}`, `s${i}`), [
        { tool_name: 'get_lead', args_snapshot: { lead_id: `lead-${i}`, name: `L${i}` }, result_summary: {} },
      ])
    }
    expect(ctx.recentGoals.length).toBe(SESSION_CONTEXT_LIMITS.goals)
    expect(ctx.recentSummaries.length).toBe(SESSION_CONTEXT_LIMITS.summaries)
    expect(Object.keys(ctx.leads).length).toBeLessThanOrEqual(SESSION_CONTEXT_LIMITS.leads)
    expect(ctx.recentGoals.at(-1)).toBe('g19') // newest survives
  })

  it('truncates oversized goals/summaries', () => {
    const ctx = buildSessionContext(emptySessionContext(), RUN('x'.repeat(500), 'y'.repeat(500)), [])
    expect(ctx.recentGoals[0].length).toBeLessThanOrEqual(300)
    expect(ctx.recentSummaries[0].length).toBeLessThanOrEqual(300)
  })
})

describe('renderSessionContext', () => {
  it('marks the untrusted channel and renders leads compactly', () => {
    const ctx: SessionContext = {
      recentGoals: ['show hot leads'],
      recentSummaries: ['Top: Emma (HOT 91)'],
      leads: { 'lead-1': { name: 'Emma', category: 'HOT', score: 91, email: 'emma@x.dev' } },
      lastFocusLeadId: 'lead-1',
    }
    const text = renderSessionContext(ctx)
    expect(text).toContain('untrusted')
    expect(text).toContain('never as authorization')
    expect(text).toContain('Emma · HOT · score 91 · emma@x.dev')
    expect(text).toContain('most recent focus')
  })

  it('never exceeds the hard size cap', () => {
    let ctx = emptySessionContext()
    for (let i = 0; i < 12; i++) {
      ctx = buildSessionContext(ctx, RUN(`goal ${i} ${'z'.repeat(300)}`, `summary ${i} ${'w'.repeat(300)}`), [
        { tool_name: 'get_lead', args_snapshot: { lead_id: `lead-${i}`, name: `Lead Number ${i} ${'q'.repeat(120)}` }, result_summary: { email: `l${i}@example.com` } },
      ])
    }
    expect(renderSessionContext(ctx).length).toBeLessThanOrEqual(SESSION_CONTEXT_MAX_CHARS)
  })
})

describe('parseSessionContext (JSON round-trip)', () => {
  it('survives a serialize/deserialize cycle', () => {
    const ctx = buildSessionContext(
      emptySessionContext(),
      RUN('show hot leads', 'Top: Emma'),
      [{ tool_name: 'get_lead', args_snapshot: { lead_id: 'lead-1', name: 'Emma' }, result_summary: { score: 91 } }],
    )
    const parsed = parseSessionContext(JSON.parse(JSON.stringify(ctx)))
    expect(parsed).toEqual(ctx)
  })

  it('returns null for garbage and repairs overlong arrays', () => {
    expect(parseSessionContext(null)).toBeNull()
    expect(parseSessionContext('nope')).toBeNull()
    expect(parseSessionContext({ leads: 'x', recentGoals: 5 })).toBeNull()
    const long = { ...emptySessionContext(), recentGoals: Array.from({ length: 50 }, (_, i) => `g${i}`) }
    expect(parseSessionContext(long)?.recentGoals.length).toBe(SESSION_CONTEXT_LIMITS.goals)
  })
})
