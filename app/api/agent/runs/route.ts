import { NextRequest, NextResponse } from 'next/server'
import { getApiUser } from '@/lib/auth-server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimiter } from '@/lib/rate-limit'
import { geminiAgentModel } from '@/lib/agent/model'
import { getAgent } from '@/lib/agent/agents'
import { SupabaseAgentStateStore } from '@/lib/agent/store'
import { startAgentRun, type RuntimeDeps } from '@/lib/agent/runtime'

// =============================================================
// 9.2/9.9 — Agent Runtime front door.
// POST /api/agent/runs — start a governed agent run for a business
// goal. GET /api/agent/runs — the caller's runs (RLS: own; ops/admin:
// all). No direct database access happens from agent requests: every
// capability flows through the registry + permission engine.
// =============================================================

function buildDeps(userClient: Awaited<ReturnType<typeof createClient>>): RuntimeDeps | { error: NextResponse } {
  let adminClient
  try {
    adminClient = createAdminClient()
  } catch {
    return {
      error: NextResponse.json(
        { error: 'Agent runtime is not configured on the server (missing service-role key).' },
        { status: 500 }
      ),
    }
  }
  return {
    store: new SupabaseAgentStateStore(adminClient),
    model: geminiAgentModel,
    userClient,
    adminClient,
    dryRunEmail: process.env.GMAIL_AGENT_DRY_RUN !== 'false',
  }
}

export async function POST(request: NextRequest) {
  const session = await getApiUser(request)
  if ('response' in session) return session.response
  const { userId, role } = session

  const body = (await request.json().catch(() => null)) as {
    goal?: unknown
    agentId?: unknown
    requireApproval?: unknown
  } | null
  const goal = typeof body?.goal === 'string' ? body.goal.trim() : ''
  const agentId = typeof body?.agentId === 'string' && body.agentId ? body.agentId : 'admissions-followup'
  // Requesters may opt INTO the approval gate (real-send mode) for
  // high-risk tools — a flag that can only ADD governance, never
  // remove it (the default stays dry-run-allowed).
  const requireApproval = body?.requireApproval === true
  if (goal.length < 5 || goal.length > 2000) {
    return NextResponse.json({ error: 'Field "goal" is required (5-2000 chars)' }, { status: 400 })
  }

  // Agent-level role gate (9.5): whose requests this agent accepts.
  const agent = getAgent(agentId)
  if (!agent) {
    return NextResponse.json({ error: `Unknown agent "${agentId}"` }, { status: 400 })
  }
  if (role !== 'admin' && !agent.allowedRoles.includes(role)) {
    return NextResponse.json(
      { error: `Your role (${role}) is not allowed to use the ${agent.displayName}.` },
      { status: 403 }
    )
  }

  // Guardrail: bounded number of runs per user per window (9.6).
  const limit = rateLimiter.check(`agent-run:${userId}`, 5, 60_000)
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Too many agent runs — try again in ${limit.retryAfterSec}s.` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
    )
  }

  const supabase = await createClient()
  const deps = buildDeps(supabase)
  if ('error' in deps) return deps.error

  try {
    const output = await startAgentRun(
      { ...deps, dryRunEmail: !requireApproval },
      { agentId, userId, userRole: role, goal }
    )
    return NextResponse.json(output, { status: 200 })
  } catch (e) {
    console.error('[api/agent/runs] POST failed:', e)
    return NextResponse.json({ error: 'The agent run failed unexpectedly — the run trace was logged.' }, { status: 500 })
  }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('agent_runs')
    .select('id, agent_id, goal, status, step_count, final_outcome, error, started_at, completed_at')
    .order('started_at', { ascending: false })
    .limit(50)
  if (error) {
    console.error('[api/agent/runs] GET failed:', error.message)
    return NextResponse.json({ error: 'Could not load agent runs' }, { status: 500 })
  }
  return NextResponse.json({ count: data.length, runs: data })
}
