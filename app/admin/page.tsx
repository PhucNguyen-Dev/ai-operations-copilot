import { createClient } from '@/lib/supabase/server'
import { requireUser, canViewAutomation } from '@/lib/auth'
import { timeAgo } from '@/lib/format'
import SiteHeader from '@/components/site-header'
import NotAllowed from '@/components/not-allowed'
import CategoryBar from '@/components/category-bar'

function Stat({
  value,
  label,
  accent,
}: {
  value: string | number
  label: string
  accent?: 'red' | 'green'
}) {
  const ring =
    accent === 'red' ? 'border-red-300 bg-red-50' : accent === 'green' ? 'border-green-300 bg-green-50' : ''
  return (
    <div className={`rounded-lg border bg-white p-4 ${ring}`}>
      <p className={`text-2xl font-semibold ${accent === 'red' ? 'text-red-700' : accent === 'green' ? 'text-green-700' : ''}`}>
        {value}
      </p>
      <p className="text-sm text-gray-500">{label}</p>
    </div>
  )
}

/** Colored progress bar for the success rate (green >= 90, amber 70-89, red < 70). */
function RateBar({ rate }: { rate: number }) {
  const color = rate >= 90 ? 'bg-green-500' : rate >= 70 ? 'bg-amber-400' : 'bg-red-500'
  const textColor = rate >= 90 ? 'text-green-700' : rate >= 70 ? 'text-amber-700' : 'text-red-700'
  return (
    <div className="flex items-center gap-3">
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100" role="img" aria-label={`Success rate ${rate} percent`}>
        <div className={`h-full ${color}`} style={{ width: `${rate}%` }} />
      </div>
      <span className={`text-2xl font-semibold tabular-nums ${textColor}`}>{rate}%</span>
    </div>
  )
}

/** Last-7-days lead volume as pure-CSS bars (one column per day, height = share of max). */
function VolumeBars({ perDay }: { perDay: { label: string; count: number }[] }) {
  const max = Math.max(1, ...perDay.map((d) => d.count))
  return (
    <div className="flex h-24 items-end gap-2" role="img" aria-label={`Leads per day, last ${perDay.length} days, peak ${max}`}>
      {perDay.map((d) => (
        <div key={d.label} className="flex flex-1 flex-col items-center gap-1">
          <span className="text-xs font-medium tabular-nums text-gray-700">{d.count}</span>
          <div
            className={`w-full rounded-t ${d.count > 0 ? 'bg-gray-900' : 'bg-gray-200'}`}
            style={{ height: `${Math.max(4, (d.count / max) * 72)}px` }}
            title={`${d.label}: ${d.count} leads`}
          />
          <span className="text-[10px] uppercase tracking-wide text-gray-400">{d.label}</span>
        </div>
      ))}
    </div>
  )
}

const MAX_ROWS = 200

export default async function AdminPage() {
  const { role } = await requireUser()
  if (!canViewAutomation(role)) return <NotAllowed role={role} what="The operations overview" />

  const supabase = await createClient()

  // Bounded recent-window queries; aggregates computed in JS. The counts are
  // labeled "recent" so the numbers stay honest once data exceeds the cap.
  const [{ data: leads, error: leadsError }, { data: runs, error: runsError }] = await Promise.all([
    supabase
      .from('leads')
      .select('id, status, created_at, lead_analyses(category, score)')
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS),
    supabase
      .from('automation_runs')
      .select('id, status, started_at, finished_at, error_summary, lead_id')
      .order('started_at', { ascending: false })
      .limit(MAX_ROWS),
  ])

  if (leadsError || runsError) {
    console.error('[admin] overview query failed:', leadsError?.message ?? runsError?.message)
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <SiteHeader title="Operations Overview" />
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          Could not load overview data — please try again. The issue has been logged.
        </div>
      </main>
    )
  }

  const leadRows = leads ?? []
  const runRows = runs ?? []
  const sevenDaysAgo = Date.now() - 7 * 86_400_000

  const leadsCapped = leadRows.length >= MAX_ROWS
  const runsCapped = runRows.length >= MAX_ROWS

  const byCategory = { HOT: 0, WARM: 0, COLD: 0 }
  let scored = 0
  let scoreSum = 0
  for (const lead of leadRows) {
    const a = lead.lead_analyses?.[0]
    if (a && a.category in byCategory) {
      byCategory[a.category as keyof typeof byCategory] += 1
      scored += 1
      scoreSum += a.score
    }
  }

  // Per-day buckets for the last 7 days (oldest -> today).
  const perDay = Array.from({ length: 7 }, (_, i) => {
    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)
    dayStart.setDate(dayStart.getDate() - (6 - i))
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)
    const count = leadRows.filter((l) => {
      const t = new Date(l.created_at).getTime()
      return t >= dayStart.getTime() && t < dayEnd.getTime()
    }).length
    return { label: dayStart.toLocaleDateString(undefined, { weekday: 'short' }), count }
  })

  const leads7d = leadRows.filter((l) => new Date(l.created_at).getTime() >= sevenDaysAgo).length
  const completed = runRows.filter((r) => r.status !== 'running')
  const failed7d = runRows.filter(
    (r) => r.status === 'failed' && new Date(r.started_at).getTime() >= sevenDaysAgo
  )
  const successRate =
    completed.length > 0
      ? Math.round((completed.filter((r) => r.status === 'success').length / completed.length) * 100)
      : null
  const durations = completed
    .filter((r) => r.finished_at && r.started_at)
    .map((r) => new Date(r.finished_at!).getTime() - new Date(r.started_at!).getTime())
  const avgDuration = durations.length
    ? `${Math.round(durations.reduce((s, ms) => s + ms, 0) / durations.length / 100) / 10}s`
    : '—'
  const lastFailed = runRows.find((r) => r.status === 'failed') ?? null

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <SiteHeader
        title="Operations Overview"
        subtitle={`Cross-department health check (F-025) · aggregates from the ${MAX_ROWS} most recent rows${leadsCapped || runsCapped ? ' — dataset exceeds the window, numbers are "recent", not all-time' : ''}.`}
      />

      <h2 className="mb-3 font-semibold">Lead volume</h2>
      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat value={leadRows.length} label={`leads (recent${leadsCapped ? ', capped' : ''})`} />
        <Stat value={leads7d} label="new in the last 7 days" />
        <Stat value={scored ? `${Math.round(scoreSum / scored)}` : '—'} label="avg score (recent)" />
        <Stat value={failed7d.length} label="failed runs, 7 days" accent={failed7d.length > 0 ? 'red' : 'green'} />
      </div>

      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-white p-4">
          <p className="mb-3 text-sm font-medium text-gray-700">Category mix (recent)</p>
          <CategoryBar counts={byCategory} />
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="mb-3 text-sm font-medium text-gray-700">Leads per day (last 7 days)</p>
          <VolumeBars perDay={perDay} />
        </div>
      </div>

      <h2 className="mb-3 font-semibold">Automation health</h2>
      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-white p-4">
          <p className="mb-3 text-sm font-medium text-gray-700">Success rate (recent, completed runs)</p>
          {successRate === null ? (
            <p className="text-sm text-gray-500">No completed runs yet.</p>
          ) : (
            <RateBar rate={successRate} />
          )}
        </div>
        <Stat value={avgDuration} label="avg run duration" />
      </div>
      {lastFailed && (
        <div className="mb-8 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <span className="font-medium">Last failure:</span>{' '}
          <a href={`/runs/${lastFailed.id}`} className="underline">
            {lastFailed.id.slice(0, 8)}
          </a>{' '}
          · {timeAgo(lastFailed.started_at)} · {lastFailed.error_summary ?? 'no summary recorded'}
        </div>
      )}

      <h2 className="mb-3 font-semibold">Department tool activity</h2>
      <div className="rounded-lg border border-dashed bg-white p-6 text-sm text-gray-500">
        Arrives with Phase 6 — Marketing / Academic / Operations AI tools will report usage here
        (generations per department, tool adoption). Nothing to show yet by design; no fake data.
      </div>
    </main>
  )
}
