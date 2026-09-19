import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await supabase
    .from('agent_runs')
    .select('id, session_id, goal, status, final_outcome, started_at, updated_at, step_count')
    .not('session_id', 'is', null)
    .order('started_at', { ascending: false })
    .limit(200)
  if (error) return NextResponse.json({ error: 'Could not load sessions' }, { status: 500 })
  const groups = new Map<string, { id:string; title:string; runCount:number; lastActivity:string; latestStatus:string; runs: typeof data }>()
  for (const run of data ?? []) {
    if (!run.session_id) continue
    const current = groups.get(run.session_id)
    if (current) { current.runCount += 1; current.runs.push(run); continue }
    groups.set(run.session_id, { id: run.session_id, title: run.goal, runCount: 1, lastActivity: run.updated_at ?? run.started_at, latestStatus: run.status, runs: [run] })
  }
  return NextResponse.json({ sessions: [...groups.values()].map(({ runs: _runs, ...session }) => session) })
}
