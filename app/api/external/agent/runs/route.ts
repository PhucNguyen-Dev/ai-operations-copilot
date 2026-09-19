import { NextRequest, NextResponse } from 'next/server'
import { rateLimiter } from '@/lib/rate-limit'
import { getAgent } from '@/lib/agent/agents'
import { hasScope } from '@/lib/agent/external-auth'
import { authenticateExternalClient } from '@/lib/agent/external-server'
import { geminiAgentModel } from '@/lib/agent/model'
import { SupabaseAgentStateStore } from '@/lib/agent/store'
import { startAgentRun, type RuntimeDeps } from '@/lib/agent/runtime'

// =============================================================
// 9.10 — External API front door.
// POST /api/external/agent/runs — an authenticated external client
// starts a governed agent run. Chain: credentials → enabled → scope
// ('agent.run') → agent allowlist → per-client rate limit → THE SAME
// runtime/registry/permission-engine as internal runs. The external
// agent identity is read-only by construction; every step is traced
// and attributed to the client (agent_runs.client_id).
// =============================================================

export async function POST(request: NextRequest) {
  const auth = await authenticateExternalClient(request)
  if ('response' in auth) return auth.response
  const { client, admin } = auth

  const body = (await request.json().catch(() => null)) as { goal?: unknown; agentId?: unknown } | null
  const goal = typeof body?.goal === 'string' ? body.goal.trim() : ''
  const agentId = typeof body?.agentId === 'string' && body.agentId ? body.agentId : 'external-lead-support'
  if (goal.length < 5 || goal.length > 2000) {
    return NextResponse.json({ error: 'Field "goal" is required (5-2000 chars)' }, { status: 400 })
  }

  if (!hasScope(client.scopes, 'agent.run')) {
    return NextResponse.json({ error: `Client lacks the required scope "agent.run"` }, { status: 403 })
  }
  if (!client.allowed_agents.includes(agentId)) {
    return NextResponse.json({ error: `Client is not authorized for agent "${agentId}"` }, { status: 403 })
  }
  const agent = getAgent(agentId)
  if (!agent) return NextResponse.json({ error: `Unknown agent "${agentId}"` }, { status: 400 })

  if (!client.created_by) {
    console.error('[api/external/agent/runs] POST refused: client has no provisioning user (created_by is null)')
    return NextResponse.json({ error: 'Client configuration error: provisioning user is missing' }, { status: 500 })
  }

  const limit = await rateLimiter.check(`ext-agent-run:${client.client_id}`, client.max_runs_per_hour, 3_600_000)
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Rate limit exceeded (${client.max_runs_per_hour} runs/hour) — retry after ${limit.retryAfterSec}s` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
    )
  }

  // External runs have no employee session: reads execute with the
  // service client and the capability boundary IS the read-only tool
  // allowlist granted at provisioning. Runs are attributed to the
  // provisioning admin (agent_runs.user_id) and the client (client_id).
  const deps: RuntimeDeps = {
    store: new SupabaseAgentStateStore(admin),
    model: geminiAgentModel,
    userClient: admin,
    adminClient: admin,
    dryRunEmail: process.env.GMAIL_AGENT_DRY_RUN !== 'false',
  }

  try {
    const output = await startAgentRun(deps, {
      agentId,
      userId: client.created_by,
      userRole: 'external',
      goal,
      clientId: client.client_id,
    })
    return NextResponse.json(output, { status: 200 })
  } catch (e) {
    console.error('[api/external/agent/runs] POST failed:', e)
    return NextResponse.json({ error: 'The agent run failed unexpectedly — the run was logged.' }, { status: 500 })
  }
}

/** GET — the client's own runs (audit visibility), newest first. */
export async function GET(request: NextRequest) {
  const auth = await authenticateExternalClient(request)
  if ('response' in auth) return auth.response
  const { client, admin } = auth

  const limit = await rateLimiter.check(`ext-agent-read:${client.client_id}`, 60, 60_000)
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Rate limit exceeded (60 reads/minute) — retry after ${limit.retryAfterSec}s` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
    )
  }

  const { data, error } = await admin
    .from('agent_runs')
    .select('id, agent_id, goal, status, step_count, final_outcome, error, started_at, completed_at')
    .eq('client_id', client.client_id)
    .order('started_at', { ascending: false })
    .limit(50)
  if (error) {
    console.error('[api/external/agent/runs] GET failed:', error.message)
    return NextResponse.json({ error: 'Could not load runs' }, { status: 500 })
  }
  return NextResponse.json({ count: data.length, runs: data })
}
