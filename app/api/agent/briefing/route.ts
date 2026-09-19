import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireUser, canViewAutomation } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateBriefing, findTodayBriefing, loadBriefingSteps } from '@/lib/agent/briefing'

// =============================================================
// In-app morning briefing. Reads run under the CURRENT SESSION —
// no impersonation: RLS scopes the data to what this user can see.
// The artifact write goes through the service client — the platform's
// stated trust model (agent tables have NO user-write policies; the
// runtime/service role writes so the audit trail is tamper-proof).
// =============================================================

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const existing = await findTodayBriefing(supabase, user.id)
  if (!existing) return NextResponse.json({ error: 'No briefing yet today' }, { status: 404 })
  const snapshot = await loadBriefingSteps(supabase, existing.id)
  return NextResponse.json({
    runId: existing.id,
    sessionId: existing.session_id,
    reused: true,
    generatedAt: existing.started_at,
    ...snapshot,
  })
}

export async function POST(request: NextRequest) {
  const { role, id } = await requireUser()
  const supabase = await createClient()

  const body = (await request.json().catch(() => null)) as { force?: unknown } | null
  const force = body?.force === true

  // Briefings are an operator surface — marketing/teacher roles see no
  // leads, so a briefing would be permanently empty noise for them.
  if (!canViewAutomation(role)) {
    return NextResponse.json({ error: 'Briefings are available to admissions/operations/admin roles' }, { status: 403 })
  }

  try {
    // userClient: RLS-scoped reads (the security boundary)
    // adminClient: artifact write per the platform trust model
    const admin = createAdminClient()
    const result = await generateBriefing(supabase, id, role, { writeClient: admin, force })
    return NextResponse.json(result)
  } catch (e) {
    console.error('[api/agent/briefing] POST failed:', e)
    return NextResponse.json({ error: 'Could not generate the briefing — the failure was logged.' }, { status: 500 })
  }
}
