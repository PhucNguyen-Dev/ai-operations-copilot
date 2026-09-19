import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authenticateExternalClient } from '@/lib/agent/external-server'
import { hasScope } from '@/lib/agent/external-auth'
import { rateLimiter } from '@/lib/rate-limit'
import {
  generateBriefing,
  briefingSessionId,
  findTodayBriefing,
  loadBriefingSteps,
} from '@/lib/agent/briefing'

// =============================================================
// Scheduled briefing front door (the "C" trigger).
//
// POST /api/external/briefing — an authenticated machine client
// (n8n cron) generates the operator's morning briefing. Security:
//   * credential = agent_api_clients (hashed, revocable, rate-limited)
//   * ONLY the 'briefing.generate' scope is accepted — this route
//     generates briefings and nothing else
//   * the target user must be an existing ACTIVE ops/admin user
//   * data access via compute_daily_briefing() (one narrow security
//     definer function) — base-table RLS untouched
//   * the run is attributed to the system principal with
//     user_role='system' and client_id set: the audit trail honestly
//     says the machine asked
// GET — the client's own briefing runs (audit visibility).
// =============================================================

const OPS_ADMIN_ROLES = new Set(['admin', 'operations'])

export async function POST(request: NextRequest) {
  const auth = await authenticateExternalClient(request)
  if ('response' in auth) return auth.response
  const { client } = auth

  if (!hasScope(client.scopes, 'briefing.generate')) {
    return NextResponse.json({ error: 'Client lacks the required scope "briefing.generate"' }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as { targetUserId?: unknown; force?: unknown } | null
  const targetUserId = typeof body?.targetUserId === 'string' ? body.targetUserId : ''
  if (!/^[0-9a-f-]{36}$/i.test(targetUserId)) {
    return NextResponse.json({ error: 'Field "targetUserId" (uuid of an ops/admin user) is required' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Target must be an existing ACTIVE ops/admin user — the route can
  // never be pointed at counselors or disabled accounts.
  const { data: target, error: targetError } = await admin.auth.admin.getUserById(targetUserId)
  if (targetError || !target?.user) {
    return NextResponse.json({ error: 'Unknown target user' }, { status: 404 })
  }
  const role = (target.user.app_metadata as Record<string, unknown> | null)?.role
  if (typeof role !== 'string' || !OPS_ADMIN_ROLES.has(role)) {
    return NextResponse.json({ error: 'Briefings can only be scheduled for admin/operations users' }, { status: 403 })
  }

  const limit = await rateLimiter.check(`ext-briefing:${client.client_id}`, 10, 3_600_000)
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Rate limit exceeded (10 briefings/hour) — retry after ${limit.retryAfterSec}s` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
    )
  }

  // Data via the narrow door; artifact write via service client
  // (system-attributed). Fresh-reuse still applies per target/day.
  const { data: snapshot, error: fnError } = await admin
    .rpc('compute_daily_briefing', { p_target_user: targetUserId })
    .single()
  if (fnError) {
    console.error('[api/external/briefing] compute failed:', fnError.message)
    return NextResponse.json({ error: 'Could not compute the briefing — the failure was logged.' }, { status: 500 })
  }

  if (!body?.force) {
    const sessionId = briefingSessionId(targetUserId)
    const existing = await findTodayBriefing(admin, targetUserId)
    if (existing?.session_id === sessionId && Date.now() - new Date(existing.started_at).getTime() < 30 * 60 * 1000) {
      const cached = await loadBriefingSteps(admin, existing.id)
      return NextResponse.json({ runId: existing.id, sessionId, reused: true, ...cached })
    }
  }

  try {
    const result = await generateBriefing(admin, targetUserId, 'system', { force: true, clientId: client.client_id })
    // Reconcile with the SQL snapshot: the function is the authority for
    // the scheduled path (the builder re-queried with service rights —
    // same rows, but keep one source of truth per surface).
    return NextResponse.json({
      runId: result.runId,
      sessionId: result.sessionId,
      reused: false,
      headline: result.headline,
      counts: (snapshot as { counts?: unknown } | null)?.counts ?? result.counts,
      priorityLeads: (snapshot as { priorityLeads?: unknown } | null)?.priorityLeads ?? result.priorityLeads,
    })
  } catch (e) {
    console.error('[api/external/briefing] generate failed:', e)
    return NextResponse.json({ error: 'Could not generate the briefing — the failure was logged.' }, { status: 500 })
  }
}

/** GET — the client's own scheduled briefings (audit visibility). */
export async function GET(request: NextRequest) {
  const auth = await authenticateExternalClient(request)
  if ('response' in auth) return auth.response
  const { client, admin } = auth

  const { data, error } = await admin
    .from('agent_runs')
    .select('id, goal, status, final_outcome, started_at')
    .eq('agent_id', 'briefing')
    .eq('client_id', client.client_id)
    .order('started_at', { ascending: false })
    .limit(50)
  if (error) {
    console.error('[api/external/briefing] GET failed:', error.message)
    return NextResponse.json({ error: 'Could not load briefing runs' }, { status: 500 })
  }
  return NextResponse.json({ count: data.length, briefings: data })
}
