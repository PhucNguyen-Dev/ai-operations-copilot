import { describe, expect, it } from 'vitest'
import {
  buildNarrativePrompt,
  validateNarrative,
} from '@/lib/agent/briefing'
import { cardsFromSteps } from '@/lib/chat/cards'
import { computeOpsCounts, startOfToday, type OpsLeadRow } from '@/lib/ops/snapshot'

// =============================================================
// Briefing v2 narrative — the model call is optional, guarded, and
// auditable. These tests pin the contract: fed only verified facts,
// validated output, honest absence on failure, card mapping.
// =============================================================

const T0 = startOfToday()
const iso = (ms: number) => new Date(ms).toISOString()

function lead(over: Partial<OpsLeadRow> = {}): OpsLeadRow {
  return {
    id: over.id ?? crypto.randomUUID(),
    name: 'Test Lead',
    email: 't@example.com',
    status: 'contacted',
    created_at: iso(T0 - 86_400_000),
    course_interest: 'IELTS',
    timeline: 'next month',
    budget: '1500',
    lead_analyses: over.lead_analyses ?? null,
    tasks: over.tasks ?? null,
    ...over,
  }
}

const counts = computeOpsCounts([lead({ lead_analyses: [{ score: 91, category: 'HOT', intent: 'HIGH', recommended_action: 'Call now' }] })], T0, 2)

describe('buildNarrativePrompt', () => {
  it('embeds the verified facts (counts + leads) in the prompt', () => {
    const p = buildNarrativePrompt(counts, [
      { id: 'l1', name: 'Emma', score: 91, category: 'HOT', overdueDueAt: iso(T0 - 1000), recommendedAction: 'Call now' },
    ] as never)
    expect(p).toContain('"needsAction"')
    expect(p).toContain('Emma')
    expect(p).toContain('"overdue":true')
  })

  it('caps the lead list at 5', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `l${i}`, name: `L${i}`, score: 50, category: 'WARM', overdueDueAt: null, recommendedAction: 'x' }))
    const p = buildNarrativePrompt(counts, many as never)
    expect(p).toContain('L4')
    expect(p).not.toContain('L5')
  })
})

describe('validateNarrative', () => {
  it('accepts a single clean sentence and trims wrapping quotes', () => {
    expect(validateNarrative('  "Start with Emma — 91, overdue."  ')).toBe('Start with Emma — 91, overdue.')
  })
  it('rejects empty, oversized, multiline, and markdown-ish output', () => {
    expect(validateNarrative('')).toBeNull()
    expect(validateNarrative('x'.repeat(221))).toBeNull()
    expect(validateNarrative('line one\nline two')).toBeNull()
    expect(validateNarrative('- bullet')).toBeNull()
    expect(validateNarrative('{"json":true}')).toBeNull()
    expect(validateNarrative(42 as unknown)).toBeNull()
  })
})

describe('briefing_narrative card mapping', () => {
  it('maps a narrative step to a narrative card', () => {
    const cards = cardsFromSteps([
      { tool_name: 'briefing_narrative', status: 'success', result_summary: { narrative: 'Start with Emma.', model: 'test' } },
    ])
    expect(cards).toEqual([{ type: 'narrative', narrative: 'Start with Emma.' }])
  })
  it('drops empty narratives', () => {
    const cards = cardsFromSteps([
      { tool_name: 'briefing_narrative', status: 'success', result_summary: { narrative: '' } },
    ])
    expect(cards).toEqual([])
  })
})
