// =============================================================
// Operational snapshot — the single source of truth for "what needs
// attention". The dashboard KPIs and the Ask X morning briefing both
// consume THESE definitions, so the two surfaces can never drift.
//
// Every number is computed from real rows (leads + lead_analyses +
// tasks + agent_approvals) — no model involvement, no invented states.
// =============================================================

export const OPS_LEAD_SELECT =
  'id, name, email, status, created_at, course_interest, timeline, budget, ' +
  'lead_analyses(score, category, intent, recommended_action), tasks(status, due_at, priority)'

export type AnalysisRow = {
  score: number
  category: string
  intent: string
  recommended_action: string | null
} | null

export type TaskRow = {
  status: string
  due_at: string | null
} | null

export type OpsLeadRow = {
  id: string
  name: string
  email: string
  status: string
  created_at: string
  course_interest: string | null
  timeline: string | null
  budget: string | null
  lead_analyses: AnalysisRow[] | null
  tasks: TaskRow[] | null
}

export type OpsCounts = {
  needsAction: number
  followUpsDue: number
  atRisk: number
  total: number
  pendingApprovals: number
}

export type OpsCategoryMix = { HOT: number; WARM: number; COLD: number }

export type OpsPriorityLead = {
  id: string
  name: string
  email: string
  status: string
  courseInterest: string | null
  category: string | null
  score: number | null
  intent: string | null
  recommendedAction: string | null
  overdueDueAt: string | null
  missing: string[]
}

export type OpsSnapshot = {
  generatedAt: string
  counts: OpsCounts
  byCategory: OpsCategoryMix
  priorityLeads: OpsPriorityLead[]
}

export const INTENT_PHRASE: Record<string, string> = {
  HIGH: 'High purchase intent',
  MEDIUM: 'Moderate purchase intent',
  LOW: 'Low purchase intent',
}

export function missingSignals(lead: OpsLeadRow): string[] {
  const out: string[] = []
  if (!lead.timeline) out.push('Timeline missing')
  if (!lead.budget) out.push('Budget missing')
  if (!lead.course_interest) out.push('Course not identified')
  return out
}

export function signalPhrase(a: NonNullable<AnalysisRow>): string {
  const intent = INTENT_PHRASE[a.intent] ?? null
  return [a.category, a.score != null ? String(a.score) : null, intent].filter(Boolean).join(' · ')
}

export function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

type OpenTaskInfo = {
  openTasks: { status: string; due_at: string | null }[]
  overdueDueAt: string | null
  dueToday: boolean
}

function openTaskInfo(lead: OpsLeadRow, todayStart: number): OpenTaskInfo {
  const tasks = (lead.tasks ?? []).filter((t): t is NonNullable<TaskRow> => t !== null)
  const openTasks = tasks.filter((t) => t.status !== 'done')
  let overdueDueAt: string | null = null
  let dueToday = false
  for (const t of openTasks) {
    if (!t.due_at) continue
    const due = new Date(t.due_at).getTime()
    if (due < todayStart) overdueDueAt = t.due_at
    else if (due < todayStart + 86_400_000) dueToday = true
  }
  return { openTasks, overdueDueAt, dueToday }
}

/** The KPI definitions — one place, consumed by dashboard AND briefing. */
export function computeOpsCounts(rows: OpsLeadRow[], todayStart: number, pendingApprovals: number): OpsCounts {
  let needsAction = 0
  let followUpsDue = 0
  let atRisk = 0
  for (const lead of rows) {
    const analysis = lead.lead_analyses?.[0] ?? null
    const { openTasks, overdueDueAt, dueToday } = openTaskInfo(lead, todayStart)
    if (analysis) {
      // Analyzed lead with no open follow-up work = the AI recommended
      // an action nobody has picked up yet.
      if (openTasks.length === 0) needsAction += 1
    } else if (lead.status === 'new') {
      needsAction += 1
    }
    if (dueToday) followUpsDue += 1
    if (overdueDueAt) atRisk += 1
  }
  return { needsAction, followUpsDue, atRisk, total: rows.length, pendingApprovals }
}

export function computeCategoryMix(rows: OpsLeadRow[]): OpsCategoryMix {
  const byCategory: OpsCategoryMix = { HOT: 0, WARM: 0, COLD: 0 }
  for (const row of rows) {
    const c = row.lead_analyses?.[0]?.category
    if (c && c in byCategory) byCategory[c as keyof OpsCategoryMix] += 1
  }
  return byCategory
}

/** Priority ranking — overdue follow-up → unactioned HOT → score. */
export function rankPriorityLeads(rows: OpsLeadRow[], todayStart: number, limit = 5): OpsPriorityLead[] {
  const ranked = rows
    .map((lead) => {
      const analysis = lead.lead_analyses?.[0] ?? null
      const { openTasks, overdueDueAt } = openTaskInfo(lead, todayStart)
      const unactioned = analysis && openTasks.length === 0
      let rank: 0 | 1 | 2 | null = null
      if (overdueDueAt) rank = 0
      else if (unactioned && analysis.category === 'HOT') rank = 1
      else if (unactioned) rank = 2
      if (rank === null) return null
      return { rank, score: analysis?.score ?? 0, lead, analysis, overdueDueAt }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.rank - b.rank || b.score - a.score)
    .slice(0, limit)
  return ranked.map(({ lead, analysis, overdueDueAt }) => ({
    id: lead.id,
    name: lead.name,
    email: lead.email,
    status: lead.status,
    courseInterest: lead.course_interest,
    category: analysis?.category ?? null,
    score: analysis?.score ?? null,
    intent: analysis?.intent ?? null,
    recommendedAction: analysis?.recommended_action ?? null,
    overdueDueAt,
    missing: missingSignals(lead),
  }))
}

/** Deterministic summary sentence for the briefing artifact. */
export function briefingHeadline(counts: OpsCounts): string {
  const parts: string[] = []
  if (counts.needsAction > 0) parts.push(`${counts.needsAction} lead${counts.needsAction === 1 ? '' : 's'} need action`)
  if (counts.followUpsDue > 0) parts.push(`${counts.followUpsDue} follow-up${counts.followUpsDue === 1 ? '' : 's'} due today`)
  if (counts.atRisk > 0) parts.push(`${counts.atRisk} at risk (overdue)`)
  if (counts.pendingApprovals > 0) parts.push(`${counts.pendingApprovals} approval${counts.pendingApprovals === 1 ? '' : 's'} waiting`)
  return parts.length
    ? `${counts.total} leads visible — ${parts.join(' · ')}`
    : `All clear — ${counts.total} leads visible, nothing needs attention right now.`
}
