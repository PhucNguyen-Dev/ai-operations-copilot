import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  OPS_LEAD_SELECT,
  computeOpsCounts,
  rankPriorityLeads,
  briefingHeadline,
  startOfToday,
  type OpsLeadRow,
  type OpsPriorityLead,
} from '@/lib/ops/snapshot'

// =============================================================
// Morning briefing builder — the deterministic assistant artifact.
//
// Design invariants (see the approved plan):
//  * Numbers are computed by application code from real rows — ZERO
//    model calls anywhere in this path. A wrong number cannot happen
//    by generation; only by schema change.
//  * The briefing "wears" the existing agent_runs schema:
//      agent_id='briefing', status='completed', 0 tokens, and
//      system-kind steps whose result_summary carries the REAL leads
//      found. The session rail, rich LeadCards and Run Inspector all
//      render it through existing code paths — no new UI plumbing.
//  * Idempotent per user per day: a fresh briefing (< BRIEFING_FRESH_MS)
//    is reused; anything older is regenerated on demand.
//  * Reads run with the caller's client (session user OR the scoped
//    external principal) — RLS decides row visibility, so a counselor
//    briefing is counselor-scoped by construction.
// =============================================================

export const BRIEFING_AGENT_ID = 'briefing'
/** 30 minutes — inside this window today's briefing is reused as-is. */
export const BRIEFING_FRESH_MS = 30 * 60 * 1000

// agent_runs.session_id is uuid-typed, so the deterministic "one
// briefing session per user per UTC day" key is derived as a UUIDv5
// (namespace + userId + day) — stable across regenerations and
// restarts, unique per user and per day.
const BRIEFING_NS = '9f847c1e-5f2a-4b6e-9a3d-2c1b0a7e6d5f'

export function uuidV5(name: string): string {
  const ns = Buffer.from(BRIEFING_NS.replace(/-/g, ''), 'hex')
  const hash = createHash('sha1').update(ns).update(name, 'utf8').digest()
  hash[6] = (hash[6] & 0x0f) | 0x50 // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80 // RFC 4122 variant
  const h = hash.subarray(0, 16).toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export type BriefingResult = {
  runId: string
  sessionId: string
  reused: boolean
  headline: string
  counts: ReturnType<typeof computeOpsCounts>
  priorityLeads: OpsPriorityLead[]
}

/** Today's deterministic session uuid (UTC day) for one user. */
export function briefingSessionId(userId: string, now = new Date()): string {
  const day = now.toISOString().slice(0, 10)
  return uuidV5(`${userId}:${day}`)
}

/** Fetch today's existing briefing run, if any. */
export async function findTodayBriefing(
  client: SupabaseClient,
  userId: string
): Promise<{ id: string; session_id: string | null; started_at: string } | null> {
  const sessionId = briefingSessionId(userId)
  const { data, error } = await client
    .from('agent_runs')
    .select('id, session_id, started_at')
    .eq('agent_id', BRIEFING_AGENT_ID)
    .eq('session_id', sessionId)
    .order('started_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(`briefing lookup failed: ${error.message}`)
  return (data ?? [])[0] ?? null
}

/**
 * Generate (or reuse) today's briefing for one user.
 * `client` MUST be the caller's own client — the user session client
 * for in-app generation, or a pre-authorized scoped client for the
 * scheduled path. Row visibility follows RLS on that client.
 */
export async function generateBriefing(
  client: SupabaseClient,
  userId: string,
  userRole: string,
  opts: { writeClient?: SupabaseClient; force?: boolean; clientId?: string } = {}
): Promise<BriefingResult> {
  const writeClient = opts.writeClient ?? client
  const sessionId = briefingSessionId(userId)

  if (!opts.force) {
    const existing = await findTodayBriefing(client, userId)
    if (existing && Date.now() - new Date(existing.started_at).getTime() < BRIEFING_FRESH_MS) {
      // Reuse — but the caller still gets the live counts shape.
      const steps = await loadBriefingSteps(client, existing.id)
      return {
        runId: existing.id,
        sessionId,
        reused: true,
        headline: steps.headline,
        counts: steps.counts,
        priorityLeads: steps.priorityLeads,
      }
    }
  }

  // --- deterministic data gathering (the ONLY source of numbers) ---
  const todayStart = startOfToday()
  const [{ data: leadRows, error: leadError }, { count: pendingApprovals, error: approvalError }] =
    await Promise.all([
      client.from('leads').select(OPS_LEAD_SELECT).order('created_at', { ascending: false }).limit(50),
      client.from('agent_approvals').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    ])
  if (leadError) throw new Error(`briefing leads query failed: ${leadError.message}`)
  if (approvalError) throw new Error(`briefing approvals query failed: ${approvalError.message}`)

  const rows: OpsLeadRow[] = ((leadRows ?? []) as unknown[]).filter(
    (r): r is OpsLeadRow => Boolean(r) && typeof r === 'object' && 'id' in (r as Record<string, unknown>)
  )
  const counts = computeOpsCounts(rows, todayStart, pendingApprovals ?? 0)
  const priorityLeads = rankPriorityLeads(rows, todayStart)
  const headline = briefingHeadline(counts)

  // --- write the artifact: one completed run + real system steps ---
  const { data: run, error: runError } = await writeClient
    .from('agent_runs')
    .insert({
      agent_id: BRIEFING_AGENT_ID,
      user_id: userId,
      user_role: userRole,
      client_id: opts.clientId ?? null,
      session_id: sessionId,
      goal: 'Morning briefing — what needs attention today (deterministic, zero model calls)',
      status: 'completed',
      current_state: { kind: 'briefing', generated_at: new Date().toISOString() },
      step_count: 0,
      max_steps: 0,
      tokens_in: 0,
      tokens_out: 0,
      final_outcome: headline,
    })
    .select('id')
    .single()
  if (runError) throw new Error(`briefing run insert failed: ${runError.message}`)

  const { error: stepError } = await writeClient.from('agent_run_steps').insert([
    {
      run_id: run.id,
      kind: 'system',
      step_index: 0,
      tool_name: 'ops_snapshot',
      tool_version: '1',
      permission_decision: 'allowed',
      status: 'success',
      args_snapshot: { scope: 'rls:user', user_id: userId },
      result_summary: { counts, headline },
      latency_ms: 0,
      tokens_in: 0,
      tokens_out: 0,
    },
    {
      run_id: run.id,
      kind: 'system',
      step_index: 1,
      // Named 'search_leads' deliberately: the chat card dispatcher maps
      // search_leads + result.leads[] → LeadCards, so the briefing's
      // priority queue renders as rich lead cards with zero new UI code.
      tool_name: 'search_leads',
      tool_version: '1',
      permission_decision: 'allowed',
      status: 'success',
      args_snapshot: { ranking: 'overdue → unactioned HOT → score', limit: priorityLeads.length },
      // LeadCard field mapping (name/course_interest/category) drives the
      // card content; snake_case mirrors the real search_leads payload.
      result_summary: {
        leads: priorityLeads.map((l) => ({
          id: l.id,
          name: l.name,
          email: l.email,
          status: l.status,
          course_interest: l.courseInterest,
          category: l.category,
          score: l.score,
          recommended_action: l.recommendedAction,
          overdue_due_at: l.overdueDueAt,
          missing: l.missing,
        })),
      },
      latency_ms: 0,
      tokens_in: 0,
      tokens_out: 0,
    },
  ])
  if (stepError) throw new Error(`briefing steps insert failed: ${stepError.message}`)

  return { runId: run.id, sessionId, reused: false, headline, counts, priorityLeads }
}

/** Read a briefing run's persisted snapshot back out (for reuse + API GET). */
export async function loadBriefingSteps(
  client: SupabaseClient,
  runId: string
): Promise<{ headline: string; counts: ReturnType<typeof computeOpsCounts>; priorityLeads: OpsPriorityLead[] }> {
  const steps = await client
    .from('agent_run_steps')
    .select('tool_name, result_summary')
    .eq('run_id', runId)
    .order('step_index', { ascending: true })
  if (steps.error) throw new Error(`briefing steps load failed: ${steps.error.message}`)
  const snap = (steps.data ?? []).find((s) => s.tool_name === 'ops_snapshot')?.result_summary as
    | { counts?: ReturnType<typeof computeOpsCounts>; headline?: string }
    | undefined
  const leads = (steps.data ?? []).find((s) => s.tool_name === 'search_leads')?.result_summary as
    | { leads?: Array<Record<string, unknown>> }
    | undefined
  return {
    headline: snap?.headline ?? 'Briefing unavailable',
    counts: snap?.counts ?? { needsAction: 0, followUpsDue: 0, atRisk: 0, total: 0, pendingApprovals: 0 },
    priorityLeads: (leads?.leads ?? []).map((l) => ({
      id: String(l.id ?? ''),
      name: String(l.name ?? ''),
      email: String(l.email ?? ''),
      status: String(l.status ?? ''),
      courseInterest: (l.course_interest as string | null) ?? null,
      category: (l.category as string | null) ?? null,
      score: (l.score as number | null) ?? null,
      intent: (l.intent as string | null) ?? null,
      recommendedAction: (l.recommended_action as string | null) ?? null,
      overdueDueAt: (l.overdue_due_at as string | null) ?? null,
      missing: Array.isArray(l.missing) ? (l.missing as string[]) : [],
    })),
  }
}
