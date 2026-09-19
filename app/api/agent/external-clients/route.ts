import { NextRequest, NextResponse } from 'next/server'
import { getApiUser } from '@/lib/auth-server'
import { canViewAutomation } from '@/lib/roles'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateCredentials } from '@/lib/agent/external-auth'
import { getAgent } from '@/lib/agent/agents'

// =============================================================
// 9.10 — Client provisioning (Operations/Admin only). The secret is
// returned EXACTLY ONCE, at creation; only its sha256 hash is stored.
// =============================================================

export async function GET(request: NextRequest) {
  const session = await getApiUser(request)
  if ('response' in session) return session.response
  if (!canViewAutomation(session.role)) {
    return NextResponse.json({ error: 'Operations/Admin only.' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('agent_api_clients')
    .select('id, name, client_id, scopes, allowed_agents, max_runs_per_hour, enabled, created_at')
    .order('created_at', { ascending: false })
  if (error) {
    console.error('[api/agent/external-clients] GET failed:', error.message)
    return NextResponse.json({ error: 'Could not load clients' }, { status: 500 })
  }
  return NextResponse.json({ clients: data })
}

export async function POST(request: NextRequest) {
  const session = await getApiUser(request)
  if ('response' in session) return session.response
  const { userId, role } = session
  if (!canViewAutomation(role)) {
    return NextResponse.json({ error: 'Operations/Admin only.' }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as {
    name?: unknown
    allowedAgents?: unknown
    maxRunsPerHour?: unknown
    scopes?: unknown
  } | null
  const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 100) : ''
  if (!name) return NextResponse.json({ error: 'Field "name" is required' }, { status: 400 })

  // Scopes are an allowlist — a client can only ever hold a scope the
  // platform has defined. Unknown scope names are rejected outright.
  const KNOWN_SCOPES = ['agent.run', 'briefing.generate']
  if (body?.scopes !== undefined && (!Array.isArray(body.scopes) || body.scopes.some((s) => typeof s !== 'string'))) {
    return NextResponse.json({ error: 'scopes must be an array of scope strings' }, { status: 400 })
  }
  const scopes = Array.isArray(body?.scopes) && body.scopes.length
    ? (body.scopes as unknown[]).filter((s): s is string => typeof s === 'string')
    : ['agent.run']
  if (scopes.some((s) => !KNOWN_SCOPES.includes(s))) {
    return NextResponse.json({ error: `scopes must contain known scopes only: ${KNOWN_SCOPES.join(', ')}` }, { status: 400 })
  }

  if (body?.allowedAgents !== undefined && (!Array.isArray(body.allowedAgents) || body.allowedAgents.some((id) => typeof id !== 'string'))) {
    return NextResponse.json({ error: 'allowedAgents must be an array of registered agent IDs' }, { status: 400 })
  }
  const allowedAgents = Array.isArray(body?.allowedAgents) && body.allowedAgents.length
    ? (body.allowedAgents as unknown[]).filter((a): a is string => typeof a === 'string')
    : ['external-lead-support']
  if (allowedAgents.length === 0 || allowedAgents.some((id) => !getAgent(id))) {
    return NextResponse.json({ error: 'allowedAgents must contain registered agent IDs only' }, { status: 400 })
  }
  const maxRunsPerHour =
    typeof body?.maxRunsPerHour === 'number' && Number.isInteger(body.maxRunsPerHour) && body.maxRunsPerHour > 0
      ? Math.min(body.maxRunsPerHour, 100)
      : 10

  const { clientId, secret, secretHash } = generateCredentials()
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('agent_api_clients')
    .insert({ name, client_id: clientId, secret_hash: secretHash, scopes, allowed_agents: allowedAgents, max_runs_per_hour: maxRunsPerHour, created_by: userId })
    .select('id, name, client_id, scopes, allowed_agents, max_runs_per_hour, enabled, created_at')
    .single()
  if (error) {
    console.error('[api/agent/external-clients] POST failed:', error.message)
    return NextResponse.json({ error: 'Could not create the client' }, { status: 500 })
  }

  // The secret crosses the wire exactly once — it is never stored.
  return NextResponse.json({ client: data, secret }, { status: 201 })
}
