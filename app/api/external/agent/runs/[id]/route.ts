import { NextRequest, NextResponse } from 'next/server'
import { authenticateExternalClient } from '@/lib/agent/external-server'

// GET /api/external/agent/runs/[id] — the client's own run with its
// full trace ("traceable result", 9.10 acceptance criterion). A client
// can only read runs it started itself (client_id match).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateExternalClient(request)
  if ('response' in auth) return auth.response
  const { client, admin } = auth

  const { id } = await params
  const { data: run, error } = await admin
    .from('agent_runs')
    .select('*')
    .eq('id', id)
    .eq('client_id', client.client_id)
    .limit(1)
  if (error) {
    console.error('[api/external/agent/runs/[id]] load failed:', error.message)
    return NextResponse.json({ error: 'Could not load the run' }, { status: 500 })
  }
  // Not found OR another client's run — indistinguishable on purpose.
  if (!run?.length) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }

  const [steps, approvals] = await Promise.all([
    admin.from('agent_run_steps').select('kind, step_index, tool_name, tool_version, permission_decision, status, error, latency_ms, started_at').eq('run_id', id).order('step_index'),
    admin.from('agent_approvals').select('id, tool_name, status, decision_note, requested_at, decided_at').eq('run_id', id).order('requested_at'),
  ])
  if (steps.error || approvals.error) {
    return NextResponse.json({ error: 'Could not load the run trace' }, { status: 500 })
  }
  return NextResponse.json({ run: run[0], steps: steps.data, approvals: approvals.data })
}
