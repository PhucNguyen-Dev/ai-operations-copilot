import { requireUser, canUseTool, canViewAutomation, canSubmitLeads } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import Sidebar, { type SidebarGroup } from '@/components/sidebar'
import AgentBubble from '@/components/chat/AgentBubble'

/** Roles whose requests the Ask-X agent accepts (mirrors lib/agent/agents.ts). */
function canAskAgent(role: string): boolean {
  return role === 'admissions' || role === 'admin'
}

/**
 * App shell for every authenticated page: fixed left sidebar (grouped by
 * department, collapsible) + content area. Login lives outside this group.
 * Permission gating mirrors the RLS model — the DB remains the enforcement.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { fullName, role } = await requireUser()

  // Pending agent approvals drive the sidebar badge (ops/admin only).
  // Count-only convenience over the governed protocol — the approvals
  // inbox is the source of truth; a failed count just means no badge.
  let pendingApprovals = 0
  if (canViewAutomation(role)) {
    const supabase = await createClient()
    const { count } = await supabase
      .from('agent_approvals')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
    pendingApprovals = count ?? 0
  }

  const groups: SidebarGroup[] = [
    { label: 'Workspace', items: [{ href: '/', label: 'Dashboard', icon: 'grid' }] },
  ]

  const toolGroup: SidebarGroup = { label: 'My AI tools', items: [] }
  if (canUseTool(role, 'F-020')) {
    toolGroup.items.push(
      { href: '/tools/content-generator', label: 'Content Generator', icon: 'pencil' },
      { href: '/tools/campaign-analyzer', label: 'Campaign Analyzer', icon: 'chart' },
    )
  }
  if (canUseTool(role, 'F-022')) {
    toolGroup.items.push(
      { href: '/tools/lesson-planner', label: 'Lesson Planner', icon: 'book' },
      { href: '/tools/quiz-generator', label: 'Quiz Generator', icon: 'quiz' },
    )
  }
  if (canUseTool(role, 'F-024')) {
    toolGroup.items.push({ href: '/tools/report-generator', label: 'Report Generator', icon: 'doc' })
  }
  if (toolGroup.items.length > 0) groups.push(toolGroup)

  if (canSubmitLeads(role)) {
    groups.push({
      label: 'Admissions',
      items: [{
        href: '/leads/new',
        label: role === 'admin' ? 'Simulate incoming lead' : 'New Test Lead',
        icon: 'plus',
      }],
    })
  }

  if (canAskAgent(role)) {
    groups.push({
      label: 'AI Assistant',
      items: [{ href: '/agent', label: 'Ask X', icon: 'chat' }],
    })
  }

  if (canViewAutomation(role)) {
    groups.push({
      label: 'Automation',
      items: [
        { href: '/runs', label: 'Automation Logs', icon: 'layers' },
        { href: '/agent/approvals', label: 'Agent Approvals', icon: 'check' },
        { href: '/admin', label: 'Overview', icon: 'gauge' },
      ],
    })
  }

  groups.push({
    label: role === 'admin' || role === 'operations' ? 'Governance' : 'AI Guidelines',
    items: [{
      href: role === 'admin' || role === 'operations' ? '/governance' : '/guidelines',
      label: role === 'admin' || role === 'operations' ? 'Governance' : 'AI Guidelines',
      icon: 'shield',
    }],
  })

  return (
    <>
      <Sidebar
        groups={groups}
        fullName={fullName}
        role={role}
        badges={pendingApprovals > 0 ? { '/agent/approvals': pendingApprovals } : {}}
      />
      <div className="app-content">{children}</div>
      <AgentBubble canUse={canAskAgent(role)} />
    </>
  )
}
