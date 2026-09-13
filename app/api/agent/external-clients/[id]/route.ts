import { NextRequest, NextResponse } from 'next/server'
import { getApiUser } from '@/lib/auth-server'
import { canViewAutomation } from '@/lib/roles'
import { createAdminClient } from '@/lib/supabase/admin'

// PATCH /api/agent/external-clients/[id] — enable/disable (revoke) a
// client. Disabled clients fail authentication immediately.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getApiUser(request)
  if ('response' in session) return session.response
  if (!canViewAutomation(session.role)) {
    return NextResponse.json({ error: 'Operations/Admin only.' }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as { enabled?: unknown } | null
  if (typeof body?.enabled !== 'boolean') {
    return NextResponse.json({ error: 'Field "enabled" (boolean) is required' }, { status: 400 })
  }

  const { id } = await params
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('agent_api_clients')
    .update({ enabled: body.enabled })
    .eq('id', id)
    .select('id, name, client_id, enabled')
    .single()
  if (error || !data) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }
  return NextResponse.json({ client: data })
}
