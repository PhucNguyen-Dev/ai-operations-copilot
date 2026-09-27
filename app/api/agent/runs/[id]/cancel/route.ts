import { NextRequest, NextResponse } from 'next/server'
import { getApiUser } from '@/lib/auth-server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimiter } from '@/lib/rate-limit'
import { canViewAutomation } from '@/lib/roles'
import { SupabaseAgentStateStore } from '@/lib/agent/store'

// =============================================================
// Migration 024 — operator stop. POST /api/agent/runs/[id]/cancel
//
// Who may stop what: the employee who started the run, or
// Operations/Admin for any run. Scope is decided by RLS first (the same
// read the GET route does — an out-of-scope run is 404, deliberately
// indistinguishable from a missing one), then the rule is stated
// explicitly for the write, so the authorization does not live only in
// a hidden policy.
//
// The write is one atomic RPC: it records the request, and for a run
// suspended on an approval it also ends the run and withdraws the
// pending approval in the same transaction (a suspended run has no loop
// to notice a flag). For a running run the flag is all it sets — the
// loop that is actually executing must be the one to write the terminal
// state and its trace step, or the trace would have a hole in it.
//
// Stopping something that is already stopped is not an error: a terminal
// run is reported back with its real status.
// =============================================================

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getApiUser(request)
  if ('response' in session) return session.response
  const { userId, role } = session

  const { id } = await params
  const userClient = await createClient()
  const { data: found, error } = await userClient
    .from('agent_runs')
    .select('id, user_id, status, cancel_requested_at')
    .eq('id', id)
    .limit(1)
  if (error) {
    console.error('[api/agent/runs/[id]/cancel] run load failed:', error.message)
    return NextResponse.json({ error: 'Could not load the agent run' }, { status: 500 })
  }
  if (!found?.length) {
    return NextResponse.json({ error: 'Agent run not found' }, { status: 404 })
  }

  const run = found[0]
  if (run.user_id !== userId && !canViewAutomation(role)) {
    return NextResponse.json(
      { error: `Only the requester or Operations/Admin can stop a run (your role: ${role}).` },
      { status: 403 }
    )
  }

  const limit = await rateLimiter.check(`agent-cancel:${userId}`, 20, 60_000)
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Too many stop requests — try again in ${limit.retryAfterSec}s.` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
    )
  }

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
  try {
    const result = await store.requestCancel(run.id, userId)
    if (!result.found) {
      return NextResponse.json({ error: 'Agent run not found' }, { status: 404 })
    }
    return NextResponse.json({
      run: {
        id: run.id,
        status: result.status ?? run.status,
        // True once a stop request exists (including a repeat request for
        // a run that was already asked to stop).
        cancelRequested: result.cancelRequested,
        // For a running run the status stays 'running' until the driving
        // loop reaches its next barrier — the client must not report a
        // completed stop before the trace says 'cancelled'.
        claimed: result.claimed,
        closedApprovalId: result.closedApprovalId ?? null,
      },
    })
  } catch (e) {
    console.error('[api/agent/runs/[id]/cancel] cancel failed:', e)
    return NextResponse.json({ error: 'Could not stop the agent run.' }, { status: 500 })
  }
}
