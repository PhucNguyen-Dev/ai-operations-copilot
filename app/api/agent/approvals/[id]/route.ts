import { NextRequest, NextResponse } from 'next/server'
import { getApiUser } from '@/lib/auth-server'
import { canViewAutomation } from '@/lib/roles'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { SupabaseAgentStateStore } from '@/lib/agent/store'
import { geminiAgentModel } from '@/lib/agent/model'
import { resumeAgentRun, type RuntimeDeps } from '@/lib/agent/runtime'

// =============================================================
// 9.6 — Approval protocol endpoint: proposed → pending →
// approved/rejected → execute. Operations/Admin decide (the requesting
// employee cannot approve their own agent's high-risk action —
// self-approval would defeat the control). On approval the run is
// resumed through the governed runtime; on rejection the run continues
// and the model must re-plan or escalate.
// =============================================================

/** One phrasing per situation: a stopped run is not a stale decision. */
const CANCELLED_RUN_MESSAGE = 'This run was cancelled — the approval can no longer execute.'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getApiUser(request)
  if ('response' in session) return session.response
  const { userId, role } = session

  if (!canViewAutomation(role)) {
    return NextResponse.json(
      { error: `Only Operations/Admin can decide agent approvals (your role: ${role}).` },
      { status: 403 }
    )
  }

  const body = (await request.json().catch(() => null)) as { decision?: unknown; note?: unknown } | null
  const decision = body?.decision
  const note = typeof body?.note === 'string' ? body.note.slice(0, 500) : null
  if (decision !== 'approved' && decision !== 'rejected') {
    return NextResponse.json({ error: 'Field "decision" must be "approved" or "rejected"' }, { status: 400 })
  }

  const { id } = await params
  const userClient = await createClient()
  const { data: pending } = await userClient
    .from('agent_approvals')
    .select('id, run_id, status, requested_by')
    .eq('id', id)
    .limit(1)
  if (!pending?.length) {
    return NextResponse.json({ error: 'Approval not found' }, { status: 404 })
  }
  if (pending[0].requested_by === userId) {
    return NextResponse.json(
      { error: 'The requesting employee cannot decide their own approval' },
      { status: 403 }
    )
  }
  const priorStatus = pending[0].status as 'pending' | 'approved' | 'rejected'

  let adminClient
  try {
    adminClient = createAdminClient()
  } catch {
    return NextResponse.json(
      { error: 'Agent runtime is not configured on the server (missing service-role key).' },
      { status: 500 }
    )
  }
  const store = new SupabaseAgentStateStore(adminClient)

  // Migration 024 — a stopped run answers first, in both shapes the
  // decision can arrive: a client still showing the approval as pending
  // (the row was withdrawn underneath it), or a client re-clicking a
  // decision made before the stop landed. Either way the reason is
  // stated: "already decided" would leave the reviewer guessing why
  // nothing executed, and resuming is what must never happen.
  if (priorStatus !== 'pending' && priorStatus !== decision) {
    const currentRun = await store.getRun(pending[0].run_id)
    if (currentRun?.status === 'cancelled') {
      return NextResponse.json({ error: CANCELLED_RUN_MESSAGE }, { status: 409 })
    }
    return NextResponse.json({ error: `Approval already decided (${priorStatus})` }, { status: 409 })
  }
  const deps: RuntimeDeps = {
    store,
    model: geminiAgentModel,
    userClient,
    adminClient,
    dryRunEmail: process.env.GMAIL_AGENT_DRY_RUN !== 'false',
  }

  const decided = await store.decideApproval(id, decision, userId, note)
  if (!decided) {
    // Migration 024: an operator stopped the run, which withdrew its
    // pending approval. This decision has nowhere to go, and the generic
    // "already decided" message would leave the reviewer guessing why
    // nothing executed.
    const currentRun = await store.getRun(pending[0].run_id)
    if (currentRun?.status === 'cancelled') {
      return NextResponse.json({ error: CANCELLED_RUN_MESSAGE }, { status: 409 })
    }
    if (priorStatus === decision) {
      const existing = await store.getApproval(id)
      return NextResponse.json({ approval: { id, status: priorStatus }, run: await resumeAgentRun(deps, { runId: existing!.run_id, approvalId: id }) })
    }
    return NextResponse.json({ error: 'Approval already decided' }, { status: 409 })
  }

  // Approved or rejected, the run resumes so the agent can execute the
  // frozen action or re-plan around the rejection, respectively. The
  // loop runs under the original requester's persisted principal.
  //
  // Migration 024: if a stop lands between the decision and this resume,
  // resumeAgentRun refuses and reports status 'cancelled' — the decision
  // is recorded (it really happened), and the body says plainly that
  // nothing executed.
  const output = await resumeAgentRun(deps, { runId: decided.run_id, approvalId: id })
  return NextResponse.json({ approval: { id: decided.id, status: decided.status }, run: output })
}
