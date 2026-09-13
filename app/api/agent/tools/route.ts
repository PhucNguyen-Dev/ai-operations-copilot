import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canViewAutomation } from '@/lib/roles'
import { AGENT_TOOLS } from '@/lib/agent/registry'
import { AGENTS } from '@/lib/agent/agents'

// =============================================================
// 9.1 — Registry introspection: every capability an agent can invoke,
// with its metadata. Authenticated staff can list it; the live
// enabled/kill-switch flags are Operations/Admin-only (they come from
// the runtime-control tables).
// =============================================================

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tools = Object.values(AGENT_TOOLS).map((t) => ({
    name: t.name,
    version: t.version,
    description: t.description,
    riskLevel: t.riskLevel,
    allowedAgents: t.allowedAgents,
    allowedRoles: t.allowedRoles,
    idempotency: t.idempotency,
    timeoutMs: t.timeoutMs,
    control: t.control ?? null,
  }))

  // Live flags: RLS restricts agent_tool_config/agent_runtime_config to
  // ops/admin; other roles simply get the static registry metadata.
  let enabledFlags: Record<string, boolean> | null = null
  let killSwitch: boolean | null = null
  if (canViewAutomation(((user.app_metadata as Record<string, string> | undefined)?.role ?? 'unknown') as Parameters<typeof canViewAutomation>[0])) {
    const [flagsRes, configRes] = await Promise.all([
      supabase.from('agent_tool_config').select('tool_name, enabled'),
      supabase.from('agent_runtime_config').select('kill_switch').eq('id', 1).limit(1),
    ])
    if (!flagsRes.error) {
      enabledFlags = Object.fromEntries((flagsRes.data ?? []).map((f) => [f.tool_name, f.enabled as boolean]))
    }
    if (!configRes.error) killSwitch = ((configRes.data ?? [])[0]?.kill_switch as boolean | undefined) ?? false
  }

  return NextResponse.json({
    agents: Object.values(AGENTS).map((a) => ({
      id: a.id,
      displayName: a.displayName,
      description: a.description,
      allowedRoles: a.allowedRoles,
      allowedTools: a.allowedTools,
    })),
    tools,
    enabledFlags,
    killSwitch,
  })
}
