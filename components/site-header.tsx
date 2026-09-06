import { requireUser, canViewAutomation, canSubmitLeads, canUseTool } from '@/lib/auth'
import LogoutButton from '@/components/logout-button'

const NAV_LINK = 'rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100'

/**
 * Role-aware shared navigation. Renders on every authed page.
 * Links are permission-gated in the UI; the database enforces the real
 * policy (RLS) — a hidden link is cosmetic defense-in-depth only.
 */
export default async function SiteHeader({
  title,
  subtitle,
}: {
  title: string
  subtitle?: string
}) {
  const { fullName, role } = await requireUser()

  return (
    <div className="mb-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
        </div>
        <LogoutButton />
      </div>

      <p className="mt-1 text-sm text-gray-500">
        Signed in as <span className="font-medium text-gray-900">{fullName}</span>
        {' · role: '}
        <span className="inline-block rounded bg-gray-900 px-1.5 py-0.5 font-mono text-xs text-white">{role}</span>
      </p>

      <nav className="mt-4 flex flex-wrap items-center gap-1 border-b pb-3">
        <a href="/" className={NAV_LINK}>Dashboard</a>
        {(role === 'admin' || role === 'operations') ? (
          <a href="/governance" className={NAV_LINK}>Governance</a>
        ) : (
          <a href="/guidelines" className={NAV_LINK}>AI Guidelines</a>
        )}
        {canUseTool(role, 'F-020') && (
          <>
            <a href="/tools/content-generator" className={NAV_LINK}>Content Generator</a>
            <a href="/tools/campaign-analyzer" className={NAV_LINK}>Campaign Analyzer</a>
          </>
        )}
        {canUseTool(role, 'F-022') && (
          <>
            <a href="/tools/lesson-planner" className={NAV_LINK}>Lesson Planner</a>
            <a href="/tools/quiz-generator" className={NAV_LINK}>Quiz Generator</a>
          </>
        )}
        {canUseTool(role, 'F-024') && (
          <a href="/tools/report-generator" className={NAV_LINK}>Report Generator</a>
        )}
        {canViewAutomation(role) && (
          <>
            <a href="/runs" className={NAV_LINK}>Automation Logs</a>
            <a href="/admin" className={NAV_LINK}>Overview</a>
          </>
        )}
        {canSubmitLeads(role) && (
          <a href="/leads/new" className={NAV_LINK}>
            {role === 'admin' ? 'Simulate incoming lead' : '+ New Test Lead'}
          </a>
        )}
      </nav>
    </div>
  )
}
