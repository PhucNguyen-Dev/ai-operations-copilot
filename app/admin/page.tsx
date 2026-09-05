import { createClient } from '@/lib/supabase/server'
import { requireUser, canViewAutomation } from '@/lib/auth'
import { timeAgo } from '@/lib/format'
import SiteHeader from '@/components/site-header'
import NotAllowed from '@/components/not-allowed'

const CATEGORY_STYLES: Record<string, string> = {
  HOT: 'bg-red-100 text-red-700',
  WARM: 'bg-amber-100 text-amber-700',
  COLD: 'bg-sky-100 text-sky-700',
}

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-sm text-gray-500">{label}</p>
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
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <SiteHeader title="Operations Overview" />
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          Could not load overview data: {leadsError?.message ?? runsError?.message}
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
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat value={leadRows.length} label={`leads (recent${leadsCapped ? ', capped' : ''})`} />
        <Stat value={leads7d} label="new in the last 7 days" />
        <Stat value={scored ? `${Math.round(scoreSum / scored)}` : '—'} label="avg score (recent)" />
        <div className="rounded-lg border bg-white p-4">
          <p className="mb-2 flex gap-2 text-sm">
            {(['HOT', 'WARM', 'COLD'] as const).map((c) => (
              <span key={c} className={`rounded px-2 py-0.5 text-xs font-semibold ${CATEGORY_STYLES[c]}`}>
                {c} {byCategory[c]}
              </span>
            ))}
          </p>
          <p className="text-sm text-gray-500">category mix (recent)</p>
        </div>
      </div>

      <h2 className="mb-3 font-semibold">Automation health</h2>
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat value={runRows.length} label={`runs (recent${runsCapped ? ', capped' : ''})`} />
        <Stat value={successRate === null ? '—' : `${successRate}%`} label="success rate (recent, completed)" />
        <Stat value={failed7d.length} label="failed in the last 7 days" />
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
