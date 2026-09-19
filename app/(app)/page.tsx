import { createClient } from '@/lib/supabase/server'
import SiteHeader from '@/components/site-header'
import CategoryBar from '@/components/category-bar'
import { parseLeadFilters, LEAD_CATEGORIES, LEAD_PERIODS } from '@/lib/filters'
import { requireUser, canViewAutomation } from '@/lib/auth'
import PriorityActions from '@/components/priority-actions'
import {
  OPS_LEAD_SELECT,
  computeOpsCounts,
  computeCategoryMix,
  rankPriorityLeads,
  signalPhrase,
  missingSignals,
  startOfToday,
  INTENT_PHRASE,
  type OpsLeadRow,
} from '@/lib/ops/snapshot'

// =============================================================
// Lead Dashboard — operations command center (not a lead database).
// All operational metrics come from lib/ops/snapshot — the SAME
// definitions the Ask X morning briefing uses, so the two surfaces
// can never drift. No invented urgency copy, no fabricated states.
// =============================================================

function filterHref(active: { category: string | null; periodKey: string; q: string }, category: string | null, periodKey: string) {
  const qs = new URLSearchParams()
  if (category) qs.set('category', category)
  if (periodKey !== 'all') qs.set('days', periodKey)
  if (active.q) qs.set('q', active.q)
  const s = qs.toString()
  return s ? `/?${s}` : '/'
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { role } = await requireUser()
  const supabase = await createClient()
  const params = await searchParams
  const { category, period } = parseLeadFilters(params)
  const q = typeof params.q === 'string' ? params.q.trim().slice(0, 100) : ''
  const todayStart = startOfToday()

  let query = supabase
    .from('leads')
      .select(OPS_LEAD_SELECT)
    .order('created_at', { ascending: false })
    .limit(50)

  if (category) query = query.filter('lead_analyses.category', 'eq', category)
  if (period.days !== null) {
    query = query.gte('created_at', new Date(Date.now() - period.days * 86_400_000).toISOString())
  }
  if (q) query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%`)

  // Pending human approvals (ops/admin only) — real governance state
  // from the agent approval protocol; links into the decisions inbox.
  const showApprovals = canViewAutomation(role)
  const [leadResult, approvalsResult] = await Promise.all([
    query,
    showApprovals
      ? supabase.from('agent_approvals').select('id', { count: 'exact', head: true }).eq('status', 'pending')
      : Promise.resolve({ count: 0, error: null }),
  ])

  const { data, error } = leadResult
  const pendingApprovals = approvalsResult.count ?? 0

  if (error) {
    console.error('[dashboard] leads query failed:', error.message)
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <SiteHeader title="Lead Dashboard" />
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          Could not load leads — please try again. The issue has been logged.
        </div>
      </main>
    )
  }

  // Postgres string-array columns come back as parsed arrays via the
  // supabase-js types; a malformed payload surfaces as GenericStringError.
  // Normalize: supabase-js types a malformed string-array payload as
  // {error:true}&String — drop those and keep only real lead rows.
  const rawRows = data as unknown[]
  const rows: OpsLeadRow[] = (rawRows ?? []).filter(
    (r): r is OpsLeadRow =>
      Boolean(r) && typeof r === 'object' && 'id' in (r as Record<string, unknown>)
  )
  const active = { category, periodKey: period.key, q }
  const byCategory = computeCategoryMix(rows)
  const counts = computeOpsCounts(rows, todayStart, pendingApprovals)
  const urgent = rankPriorityLeads(rows, todayStart)

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <SiteHeader
        title="Lead Dashboard"
        subtitle="What needs attention right now — every metric derived from live lead, task and approval data (RLS-enforced)."
      />

      {/* Filter controls — unchanged */}
      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-white p-4">
        <form method="get" action="/" className="mr-2 flex min-w-[220px] flex-1 items-center gap-2" role="search">
          {category && <input type="hidden" name="category" value={category} />}
          {period.key !== 'all' && <input type="hidden" name="days" value={period.key} />}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search name or email…"
            aria-label="Search leads by name or email"
            className="field max-w-[280px]"
          />
          <button type="submit" className="btn btn-secondary">Search</button>
          {q && <a href={filterHref({ ...active, q: '' }, category, period.key)} className="pill">Clear</a>}
        </form>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Category</span>
          <a href={filterHref(active, null, period.key)} className={`pill ${category === null ? 'active' : ''}`}>All</a>
          {LEAD_CATEGORIES.map((c) => (
            <a key={c} href={filterHref(active, c, period.key)} className={`pill ${category === c ? 'active' : ''}`}>
              {c}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Created</span>
          {LEAD_PERIODS.map((p) => (
            <a key={p.key} href={filterHref(active, category, p.key)} className={`pill ${period.key === p.key ? 'active' : ''}`}>
              {p.label}
            </a>
          ))}
        </div>
      </div>

      {/* Operational KPIs */}
      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-5">
        <div className={`rounded-lg border bg-white p-4 ${counts.needsAction > 0 ? 'border-amber-300' : ''}`}>
          <p className="text-2xl font-semibold">{counts.needsAction}</p>
          <p className="text-sm text-gray-500">needs action</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-2xl font-semibold">{counts.followUpsDue}</p>
          <p className="text-sm text-gray-500">follow-ups due today</p>
        </div>
        <div className={`rounded-lg border bg-white p-4 ${counts.atRisk > 0 ? 'border-red-300 bg-red-50' : ''}`}>
          <p className={`text-2xl font-semibold ${counts.atRisk > 0 ? 'text-red-700' : ''}`}>{counts.atRisk}</p>
          <p className="text-sm text-gray-500">at risk (overdue)</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-2xl font-semibold">{counts.total}</p>
          <p className="text-sm text-gray-500">total leads visible</p>
        </div>
        {showApprovals && (
          <a href="/agent/approvals" className={`block rounded-lg border bg-white p-4 transition hover:border-[var(--brand)] ${counts.pendingApprovals > 0 ? 'border-amber-300' : ''}`}>
            <p className="text-2xl font-semibold">{counts.pendingApprovals}</p>
            <p className="text-sm text-gray-500 underline decoration-dotted underline-offset-4">pending approvals →</p>
          </a>
        )}
      </div>

      <div className="mb-6 rounded-lg border bg-white p-4">
        <p className="mb-3 text-sm font-medium text-gray-700">Category mix (in current view)</p>
        <CategoryBar counts={byCategory} />
      </div>

      {/* Priority Actions — the operational queue */}
      {urgent.length > 0 && (
        <section aria-label="Priority actions" className="mb-8 rounded-lg border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700">Priority actions</p>
            <p className="text-xs text-gray-400">overdue follow-ups → unactioned hot leads → score</p>
          </div>
          <PriorityActions
            items={urgent.map((u) => ({
              leadId: u.id,
              name: u.name,
              category: u.category,
              score: u.score,
              signal: INTENT_PHRASE[u.intent ?? ''] ?? null,
              missing: u.missing,
              recommendedAction: u.recommendedAction,
              overdueDueAt: u.overdueDueAt,
            }))}
          />
        </section>
      )}

      {/* Operational table */}
      <div className="table-card mb-8">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th scope="col">Lead</th>
              <th scope="col">AI Signal</th>
              <th scope="col">Next Action</th>
              <th scope="col">Status</th>
              <th scope="col" className="text-right">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  {q
                    ? `No leads match "${q}".`
                    : category || period.days !== null
                      ? 'No leads match these filters.'
                      : 'No leads visible — this is correct for marketing/teacher roles (RLS).'}
                </td>
              </tr>
            )}
            {rows.map((lead) => {
              const analysis = lead.lead_analyses?.[0] ?? null
              const missing = missingSignals(lead)
              return (
                <tr key={lead.id} className="align-top">
                  <td className="px-4 py-3">
                    <a href={`/leads/${lead.id}`} className="font-medium text-[var(--brand)] hover:underline">{lead.name}</a>
                    <p className="mt-0.5 max-w-[220px] truncate text-xs text-gray-400">{lead.email}</p>
                    {missing.length > 0 && (
                      <p className="mt-0.5 text-xs text-amber-600" title={missing.join(', ')}>⚠ {missing[0]}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {analysis ? (
                      <span className="text-xs font-semibold text-gray-700">{signalPhrase(analysis)}</span>
                    ) : (
                      <span className="text-xs text-gray-400">not analyzed</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {analysis?.recommended_action ? (
                      <span className="text-xs text-gray-700">→ {analysis.recommended_action}</span>
                    ) : analysis ? (
                      <span className="text-xs text-gray-400">no recommendation recorded</span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3"><span className={`badge badge-${lead.status}`}>{lead.status}</span></td>
                  <td className="px-4 py-3 text-right text-gray-500">
                    {new Date(lead.created_at).toLocaleString()}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-gray-400">
        Expected: counselor → assigned leads only; admin/operations → all leads + runs visible;
        marketing/teacher → 0 leads, runs blocked.
      </p>
    </main>
  )
}
