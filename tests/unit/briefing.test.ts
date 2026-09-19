import { describe, expect, it } from 'vitest'
import {
  computeOpsCounts,
  computeCategoryMix,
  rankPriorityLeads,
  briefingHeadline,
  signalPhrase,
  missingSignals,
  startOfToday,
  type OpsLeadRow,
} from '@/lib/ops/snapshot'
import {
  briefingSessionId,
  uuidV5,
  BRIEFING_AGENT_ID,
} from '@/lib/agent/briefing'
import { inAppChannel, getChannel, type BriefingPayload } from '@/lib/delivery'

// =============================================================
// Deterministic briefing core — the numbers MUST be right. These
// tests pin the single source of truth shared by dashboard + briefing.
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

const hot = (score = 85): OpsLeadRow['lead_analyses'] =>
  [{ score, category: 'HOT', intent: 'HIGH', recommended_action: 'Call immediately' }]

describe('ops snapshot — counts', () => {
  it('analyzed lead with no open tasks = needs action', () => {
    const c = computeOpsCounts([lead({ lead_analyses: hot() })], T0, 0)
    expect(c.needsAction).toBe(1)
    expect(c.atRisk).toBe(0)
    expect(c.followUpsDue).toBe(0)
  })

  it('analyzed lead with an open task is NOT needs-action', () => {
    const c = computeOpsCounts(
      [lead({ lead_analyses: hot(), tasks: [{ status: 'pending', due_at: iso(T0 + 86_400_000) }] })],
      T0,
      0
    )
    expect(c.needsAction).toBe(0)
  })

  it('unanalyzed lead only counts when status=new', () => {
    expect(computeOpsCounts([lead({ status: 'new' })], T0, 0).needsAction).toBe(1)
    expect(computeOpsCounts([lead({ status: 'contacted' })], T0, 0).needsAction).toBe(0)
  })

  it('overdue open task = at risk; done tasks never count', () => {
    const overdue = [{ status: 'pending', due_at: iso(T0 - 86_400_000) }]
    expect(computeOpsCounts([lead({ tasks: overdue })], T0, 0).atRisk).toBe(1)
    expect(computeOpsCounts([lead({ tasks: [{ status: 'done', due_at: iso(T0 - 86_400_000) }] })], T0, 0).atRisk).toBe(0)
  })

  it('follow-up due today is counted separately from overdue', () => {
    const c = computeOpsCounts(
      [lead({ tasks: [{ status: 'pending', due_at: iso(T0 + 3_600_000) }] })],
      T0,
      0
    )
    expect(c.followUpsDue).toBe(1)
    expect(c.atRisk).toBe(0)
  })

  it('pending approvals pass through; total equals row count', () => {
    const c = computeOpsCounts([lead(), lead()], T0, 3)
    expect(c.total).toBe(2)
    expect(c.pendingApprovals).toBe(3)
  })
})

describe('ops snapshot — ranking (overdue → unactioned HOT → score)', () => {
  it('ranks overdue first, then unactioned HOT by score, then unactioned', () => {
    const rows = [
      lead({ id: 'plain-unactioned', lead_analyses: [{ score: 40, category: 'WARM', intent: 'MEDIUM', recommended_action: null }] }),
      lead({ id: 'hot-95', lead_analyses: hot(95) }),
      lead({ id: 'hot-85', lead_analyses: hot(85) }),
      lead({ id: 'overdue', tasks: [{ status: 'pending', due_at: iso(T0 - 172_800_000) }] }),
      lead({ id: 'actioned-not-urgent', lead_analyses: hot(90), tasks: [{ status: 'pending', due_at: iso(T0 + 86_400_000 * 5) }] }),
    ]
    const ranked = rankPriorityLeads(rows, T0)
    expect(ranked.map((r) => r.id)).toEqual(['overdue', 'hot-95', 'hot-85', 'plain-unactioned'])
    expect(ranked[0].overdueDueAt).toBeTruthy()
  })

  it('actioned leads are excluded entirely', () => {
    const ranked = rankPriorityLeads(
      [lead({ lead_analyses: hot(), tasks: [{ status: 'pending', due_at: iso(T0 + 86_400_000) }] })],
      T0
    )
    expect(ranked).toHaveLength(0)
  })

  it('respects the limit', () => {
    const rows = Array.from({ length: 8 }, (_, i) => lead({ id: `u${i}`, lead_analyses: hot(50 + i) }))
    expect(rankPriorityLeads(rows, T0, 5)).toHaveLength(5)
  })
})

describe('ops snapshot — presentation helpers', () => {
  it('signal phrase merges category · score · intent', () => {
    expect(signalPhrase({ score: 85, category: 'HOT', intent: 'HIGH', recommended_action: null })).toBe(
      'HOT · 85 · High purchase intent'
    )
  })

  it('missing signals derive only from real nulls', () => {
    expect(missingSignals(lead({ timeline: null, budget: null, course_interest: null }))).toEqual([
      'Timeline missing',
      'Budget missing',
      'Course not identified',
    ])
    expect(missingSignals(lead())).toEqual([])
  })

  it('category mix only counts known categories', () => {
    const mix = computeCategoryMix([lead({ lead_analyses: hot() }), lead(), lead()])
    expect(mix).toEqual({ HOT: 1, WARM: 0, COLD: 0 })
  })
})

describe('briefing headline — deterministic phrasing', () => {
  it('lists only non-zero facts', () => {
    expect(briefingHeadline({ needsAction: 3, followUpsDue: 0, atRisk: 2, total: 41, pendingApprovals: 1 })).toBe(
      '41 leads visible — 3 leads need action · 2 at risk (overdue) · 1 approval waiting'
    )
  })

  it('all-clear phrasing when nothing needs attention', () => {
    expect(briefingHeadline({ needsAction: 0, followUpsDue: 0, atRisk: 0, total: 41, pendingApprovals: 0 })).toBe(
      'All clear — 41 leads visible, nothing needs attention right now.'
    )
  })
})

describe('briefing artifact identity', () => {
  it('session id is a deterministic uuid per user per UTC day', () => {
    const a = briefingSessionId('u1', new Date('2026-09-22T09:00:00Z'))
    const b = briefingSessionId('u1', new Date('2026-09-22T23:59:59Z'))
    const c = briefingSessionId('u2', new Date('2026-09-22T09:00:00Z'))
    const nextDay = briefingSessionId('u1', new Date('2026-09-23T09:00:00Z'))
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).not.toBe(nextDay)
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('uuidV5 is RFC 4122 compliant and stable', () => {
    expect(uuidV5('x')).toBe(uuidV5('x'))
    expect(uuidV5('x')).not.toBe(uuidV5('y'))
  })

  it('uses the dedicated briefing agent id (zero tokens by schema)', () => {
    expect(BRIEFING_AGENT_ID).toBe('briefing')
  })
})

describe('delivery seam', () => {
  it('in_app channel confirms the artifact and never fails', async () => {
    const payload: BriefingPayload = {
      headline: 'h',
      counts: { needsAction: 0, followUpsDue: 0, atRisk: 0, total: 0, pendingApprovals: 0 },
      priorityLeads: [],
      runId: 'r1',
      sessionId: 's1',
    }
    const result = await inAppChannel.deliver(payload, 'u1')
    expect(result).toEqual({ channel: 'in_app', delivered: true, detail: expect.any(String) })
  })

  it('unknown channels are not resolvable (fail-closed)', () => {
    expect(getChannel('telegram' as never)).toBeNull()
    expect(getChannel('in_app')).not.toBeNull()
  })
})
