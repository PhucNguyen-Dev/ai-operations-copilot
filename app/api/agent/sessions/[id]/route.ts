import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: runs, error } = await supabase.from('agent_runs').select('id, session_id, goal, status, final_outcome, error, started_at, updated_at, completed_at, step_count, tokens_in, tokens_out').eq('session_id', id).order('started_at', { ascending: true })
  if (error) return NextResponse.json({ error: 'Could not load session' }, { status: 500 })
  if (!runs?.length) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  const traces = await Promise.all(runs.map(async run => {
    const [steps, approvals] = await Promise.all([
      supabase.from('agent_run_steps').select('*').eq('run_id', run.id).order('step_index'),
      supabase.from('agent_approvals').select('*').eq('run_id', run.id).order('requested_at', { ascending: false }),
    ])
    return { run, steps: steps.data ?? [], approvals: approvals.data ?? [] }
  }))
  return NextResponse.json({ session: { id, title: runs[0].goal, runCount: runs.length }, runs: traces })
}
