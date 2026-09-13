import { NextRequest, NextResponse } from 'next/server'
import { getApiUser } from '@/lib/auth-server'
import { createClient } from '@/lib/supabase/server'

// =============================================================
// 9.4 — Agent run inspection. GET /api/agent/runs/[id] returns the
// durable run + its full step trace + approvals, through the user's
// RLS client (employees: own runs; Operations/Admin: all). This is
// what a reviewer reads to answer: what goal, which tools, why
// allowed/blocked, what failed, how it recovered, why it ended.
// =============================================================

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getApiUser(request)
  if ('response' in session) return session.response

  const { id } = await params
  const supabase = await createClient()

  const { data: run, error } = await supabase
    .from('agent_runs')
    .select('*')
    .eq('id', id)
    .limit(1)
  if (error) {
    console.error('[api/agent/runs/[id]] run load failed:', error.message)
    return NextResponse.json({ error: 'Could not load the agent run' }, { status: 500 })
  }
  if (!run?.length) {
    // Not found OR outside the caller's RLS scope — indistinguishable on purpose.
    return NextResponse.json({ error: 'Agent run not found' }, { status: 404 })
  }

  const [steps, approvals] = await Promise.all([
    supabase.from('agent_run_steps').select('*').eq('run_id', id).order('step_index'),
    supabase.from('agent_approvals').select('*').eq('run_id', id).order('requested_at', { ascending: false }),
  ])
  if (steps.error || approvals.error) {
    console.error('[api/agent/runs/[id]] trace load failed:', steps.error?.message ?? approvals.error?.message)
    return NextResponse.json({ error: 'Could not load the run trace' }, { status: 500 })
  }

  return NextResponse.json({ run: run[0], steps: steps.data, approvals: approvals.data })
}
