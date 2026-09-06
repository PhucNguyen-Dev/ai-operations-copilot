import { requireUser, canUseTool, canViewAutomation, canSubmitLeads } from '@/lib/auth'
import Sidebar, { type SidebarGroup } from '@/components/sidebar'

/**
 * App shell for every authenticated page: fixed left sidebar (grouped by
 * department, collapsible) + content area. Login lives outside this group.
 * Permission gating mirrors the RLS model — the DB remains the enforcement.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { fullName, role } = await requireUser()

  const groups: SidebarGroup[] = [
    { label: 'Workspace', items: [{ href: '/', label: 'Dashboard', icon: '▦' }] },
  ]

  const toolGroup: SidebarGroup = { label: 'My AI tools', items: [] }
  if (canUseTool(role, 'F-020')) {
    toolGroup.items.push(
      { href: '/tools/content-generator', label: 'Content Generator', icon: '✎' },
      { href: '/tools/campaign-analyzer', label: 'Campaign Analyzer', icon: '◔' },
    )
  }
  if (canUseTool(role, 'F-022')) {
    toolGroup.items.push(
      { href: '/tools/lesson-planner', label: 'Lesson Planner', icon: '☰' },
      { href: '/tools/quiz-generator', label: 'Quiz Generator', icon: '?' },
    )
  }
  if (canUseTool(role, 'F-024')) {
    toolGroup.items.push({ href: '/tools/report-generator', label: 'Report Generator', icon: '▤' })
  }
  if (toolGroup.items.length > 0) groups.push(toolGroup)

  if (canSubmitLeads(role)) {
    groups.push({
      label: 'Admissions',
      items: [{
        href: '/leads/new',
        label: role === 'admin' ? 'Simulate incoming lead' : 'New Test Lead',
        icon: '＋',
      }],
    })
  }

  if (canViewAutomation(role)) {
    groups.push({
      label: 'Automation',
      items: [
        { href: '/runs', label: 'Automation Logs', icon: '⧉' },
        { href: '/admin', label: 'Overview', icon: '◈' },
      ],
    })
  }

  groups.push({
    label: role === 'admin' || role === 'operations' ? 'Governance' : 'AI Guidelines',
    items: [{
      href: role === 'admin' || role === 'operations' ? '/governance' : '/guidelines',
      label: role === 'admin' || role === 'operations' ? 'Governance' : 'AI Guidelines',
      icon: '§',
    }],
  })

  return (
    <>
      <Sidebar groups={groups} fullName={fullName} role={role} />
      <div className="app-content">{children}</div>
    </>
  )
}
