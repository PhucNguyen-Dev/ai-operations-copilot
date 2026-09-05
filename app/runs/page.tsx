import { createClient } from '@/lib/supabase/server'
import { requireUser, canViewAutomation } from '@/lib/auth'
import { timeAgo } from '@/lib/format'
import SiteHeader from '@/components/site-header'
import NotAllowed from '@/components/not-allowed'

const PAGE_SIZE = 20
const STATUSES = ['running', 'success', 'failed'] as const
const PERIODS: { key: string; label: string; days: number | null }[] = [
  { key: 'all', label: 'All time', days: null },
  { key: '1', label: '24 hours', days: 1 },
  { key: '7', label: '7 days', days: 7 },
]

const STATUS_STYLE: Record<string, string> = {
  running: 'bg-blue-100 text-blue-700',
  success: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
}

function parseFilters(params: Record<string, string | string[] | undefined>) {
  const rawStatus = typeof params.status === 'string' ? params.status : ''
  const status = (STATUSES as readonly string[]).includes(rawStatus) ? rawStatus : null
  const rawPeriod = typeof params.days === 'string' ? params.days : 'all'
  const period = PERIODS.find((p) => p.key === rawPeriod) ?? PERIODS[0]
  const rawPage = Number.parseInt(typeof params.page === 'string' ? params.page : '1', 10)
  // Clamp: page 0 / -5 / "abc" / 99e9 all land on a sane page.
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.min(rawPage, 10_000) : 1
  return { status, period, page }
}

function href(active: { status: string | null; periodKey: string; page: number }, patch: Partial<{ status: string | null; periodKey: string; page: number }>) {
  const next = { ...active, ...patch }
  const qs = new URLSearchParams()
  if (next.status) qs.set('status', next.status)
  if (next.periodKey !== 'all') qs.set('days', next.periodKey)
  if (next.page > 1) qs.set('page', String(next.page))
  const s = qs.toString()
  return s ? `/runs?${s}` : '/runs'
}

const PILL = 'rounded-full border px-3 py-1 text-xs font-medium'
const PILL_ON = 'border-gray-900 bg-gray-900 text-white'
const PILL_OFF = 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { role } = await requireUser()
  if (!canViewAutomation(role)) return <NotAllowed role={role} what="The Automation Logs Viewer" />

  const supabase = await createClient()
  const params = await searchParams
  const { status, period, page } = parseFilters(params)

  let query = supabase
    .from('automation_runs')
    .select('id, workflow_name, trigger_source, lead_id, status, error_summary, started_at, finished_at', { count: 'exact' })
    .order('started_at', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

  if (status) query = query.eq('status', status)
  if (period.days !== null) {
    query = query.gte('started_at', new Date(Date.now() - period.days * 86_400_000).toISOString())
  }

  const { data: runs, count, error } = await query

  const totalPages = count !== null ? Math.max(1, Math.ceil(count / PAGE_SIZE)) : 1
  const active = { status, periodKey: period.key, page }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <SiteHeader
        title="Automation Logs"
        subtitle="Every pipeline execution recorded by the workflows themselves (F-012) — not n8n's internal store."
      />

      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-white p-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Status</span>
          <a href={href(active, { status: null, page: 1 })} className={`${PILL} ${status === null ? PILL_ON : PILL_OFF}`}>All</a>
          {STATUSES.map((s) => (
            <a key={s} href={href(active, { status: s, page: 1 })} className={`${PILL} ${status === s ? PILL_ON : PILL_OFF}`}>{s}</a>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Started</span>
          {PERIODS.map((p) => (
            <a key={p.key} href={href(active, { periodKey: p.key, page: 1 })} className={`${PILL} ${period.key === p.key ? PILL_ON : PILL_OFF}`}>{p.label}</a>
          ))}
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          Could not load runs: {error.message}
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-gray-500">
            {count ?? 0} run{count === 1 ? '' : 's'}
            {status && ` with status "${status}"`}
            {period.days !== null && ` in the last ${period.label.toLowerCase()}`}
          </p>

          <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Workflow</th>
                  <th className="px-4 py-3">Trigger</th>
                  <th className="px-4 py-3">Lead</th>
                  <th className="px-4 py-3">Started</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3">Error</th>
                </tr>
              </thead>
              <tbody>
                {(runs ?? []).length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">No runs match these filters.</td>
                  </tr>
                )}
                {(runs ?? []).map((run) => {
                  const duration =
                    run.finished_at && run.started_at
                      ? `${Math.max(1, Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000))}s`
                      : '—'
                  return (
                    <tr key={run.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <a href={`/runs/${run.id}`} className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[run.status] ?? 'bg-gray-100'}`}>
                          {run.status}
                        </a>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{run.workflow_name}</td>
                      <td className="px-4 py-3 text-gray-600">{run.trigger_source}</td>
                      <td className="px-4 py-3">
                        {run.lead_id ? <a className="underline" href={`/leads/${run.lead_id}`}>open</a> : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500" title={run.started_at ?? ''}>
                        {run.started_at ? timeAgo(run.started_at) : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{duration}</td>
                      <td className="max-w-xs truncate px-4 py-3 text-gray-500" title={run.error_summary ?? ''}>
                        {run.error_summary ?? '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-gray-500">
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <a href={href(active, { page: page - 1 })} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-gray-700 hover:bg-gray-100">
                  ← Previous
                </a>
              )}
              {page < totalPages && (
                <a href={href(active, { page: page + 1 })} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-gray-700 hover:bg-gray-100">
                  Next →
                </a>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  )
}
