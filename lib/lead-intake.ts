// =============================================================
// Durable lead intake (migration 023). The lead-row insert is the
// commit point; everything downstream (counselor assignment + agent
// triage) is an outbox job the webhook no longer depends on.
//
//   * enqueueTriage — idempotent (unique (lead_id, kind)); a
//     re-delivery after a mid-crash re-inserts the lead and gets the
//     SAME job row back.
//   * processOutbox — claims due jobs, runs the downstream work,
//     releases with done/retry/dead-letter. Bounded retries with
//     exponential backoff; permanent failures dead-letter visibly.
//
// Trust model: service-role only (no RLS policies — same as the agent
// tables); processing claims are single-statement RPCs so concurrent
// workers can never double-claim.
// =============================================================
import type { SupabaseClient } from '@supabase/supabase-js'

export type OutboxJob = {
  id: string
  lead_id: string
  kind: 'triage'
  status: 'pending' | 'processing' | 'done' | 'dead_letter'
  attempts: number
  max_attempts: number
  last_error: string | null
}

export type OutboxAttemptOutcome = { ok: true } | { ok: false; error: string; retryable: boolean }

/** Enqueue downstream work for one accepted lead. Idempotent per (lead_id, kind). */
export async function enqueueTriage(admin: SupabaseClient, leadId: string): Promise<void> {
  const { error } = await admin
    .from('lead_intake_outbox')
    .upsert({ lead_id: leadId, kind: 'triage' }, { onConflict: 'lead_id,kind' })
  if (error) throw new Error(`outbox enqueue failed: ${error.message}`)
}

/**
 * Claim + process due jobs. Returns how many jobs were claimed
 * (even if some then failed — failures are released per the RPC's
 * retry policy). Concurrency-safe: claim_lead_intake_job serializes
 * workers on FOR UPDATE SKIP LOCKED.
 */
export async function processOutbox(
  admin: SupabaseClient,
  attempt: (job: OutboxJob) => Promise<OutboxAttemptOutcome>,
  batch = 1
): Promise<number> {
  const { data, error } = await admin.rpc('claim_lead_intake_job', { p_batch: batch })
  if (error) throw new Error(`outbox claim failed: ${error.message}`)
  const jobs = (data ?? []) as OutboxJob[]
  let claimed = 0
  for (const job of jobs) {
    claimed += 1
    let outcome: OutboxAttemptOutcome
    try {
      outcome = await attempt(job)
    } catch (e) {
      // A worker crash mid-attempt must behave like a transient failure:
      // the release call decides done vs retry vs dead-letter.
      outcome = { ok: false, error: String(e), retryable: true }
    }
    const rel = await admin.rpc('release_lead_intake_job', {
      p_job_id: job.id,
      p_ok: outcome.ok,
      p_error: outcome.ok ? null : outcome.error,
      p_retryable: outcome.ok ? true : outcome.retryable,
    })
    if (rel.error) console.error(`[lead-intake] release failed for job ${job.id}: ${rel.error.message}`)
  }
  return claimed
}

// -------------------------------------------------------------
// The downstream work a triage job performs — extracted verbatim from
// the webhook so the webhook's inline path and the worker path are
// the same code (the webhook keeps its inline best-effort call for
// latency; the outbox is the durability net).
// -------------------------------------------------------------

export async function firstAdminId(admin: SupabaseClient): Promise<string | null> {
  const { data } = await admin.from('profiles').select('id').eq('role', 'admin').limit(1)
  return ((data ?? [])[0] as { id: string } | undefined)?.id ?? null
}

/** Same deterministic rule as the n8n pipeline: hash the lead id over the sorted counselor list. */
export async function assignCounselor(admin: SupabaseClient, leadId: string): Promise<void> {
  const { data: counselors } = await admin.from('profiles').select('id').eq('role', 'admissions').order('id')
  if (!counselors?.length) return
  let hash = 0
  for (const c of leadId) hash = (hash * 31 + c.charCodeAt(0)) >>> 0
  const counselorId = counselors[hash % counselors.length].id as string
  const { error } = await admin.from('leads').update({ assigned_counselor_id: counselorId }).eq('id', leadId)
  if (error) throw new Error(`counselor assignment failed: ${error.message}`)
}

export function triageGoal(leadId: string, leadName: string, source: string): string {
  return `[lead-webhook:${source}] New lead arrived (id ${leadId}, ${leadName}). Review it with your tools and take the appropriate next action per the SOP.`
}

/** What callers must supply: the admin client + the agent store/model. Full runtime deps are built here. */
export type TriageDeps = {
  admin: SupabaseClient
  store: import('@/lib/agent/types').AgentStateStore
  model: import('@/lib/agent/model').AgentModel
  dryRunEmail?: boolean
}

export async function startTriageRun(
  deps: TriageDeps,
  input: { leadId: string; leadName: string; source: string; userId: string }
): Promise<import('@/lib/agent/runtime').AgentRunOutput> {
  const { startAgentRun } = await import('@/lib/agent/runtime')
  return startAgentRun(
    {
      store: deps.store,
      model: deps.model,
      userClient: deps.admin,
      adminClient: deps.admin,
      dryRunEmail: deps.dryRunEmail,
    },
    {
      agentId: 'admissions-followup',
      userId: input.userId,
      userRole: 'admin',
      goal: triageGoal(input.leadId, input.leadName, input.source),
    }
  )
}

/**
 * The outbox attempt: counselor assignment + governed triage run.
 * Assignment failures are retryable (RLS/DB hiccups heal); an agent
 * run that STARTED is a completed job even if it later fails —
 * the run's own audit trail owns that failure, and re-enqueueing
 * would double-act on the lead.
 */
export async function runTriageJob(admin: SupabaseClient, job: OutboxJob, runDeps: TriageDeps): Promise<OutboxAttemptOutcome> {
  try {
    await assignCounselor(admin, job.lead_id)
  } catch (e) {
    return { ok: false, error: `assignment: ${String(e)}`, retryable: true }
  }
  const { data: lead } = await admin.from('leads').select('name, source').eq('id', job.lead_id).limit(1)
  const row = (lead ?? [])[0] as { name?: string; source?: string } | undefined
  const adminId = await firstAdminId(admin)
  try {
    const output = await startTriageRun(runDeps, {
      leadId: job.lead_id,
      leadName: row?.name ?? 'unknown',
      source: row?.source ?? 'webhook',
      userId: process.env.AGENT_SYSTEM_USER_ID ?? adminId ?? '00000000-0000-0000-0000-000000000000',
    })
    if (output.status === 'failed') {
      // Retryable ONLY when nothing was persisted (no run row → no side
      // effects happened): retrying a PERSISTED failed run would spawn a
      // SECOND governed run and could double-act on the lead — that
      // failure is already audited in agent_runs, so the job dead-letters
      // and a human decides.
      const persisted = output.runId !== ''
      return { ok: false, error: `triage run: ${output.error}`, retryable: !persisted }
    }
    return { ok: true }
  } catch (e) {
    // An unexpected throw mid-drive means the run row likely EXISTS (the
    // runtime's own failures are returned, not thrown) — same rule: never
    // retry a possibly-executed run. Dead-letter visibly.
    return { ok: false, error: `triage run: ${String(e)}`, retryable: false }
  }
}
