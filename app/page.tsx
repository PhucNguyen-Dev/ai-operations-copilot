import { createClient } from '@/lib/supabase/server'
import SiteHeader from '@/components/site-header'
import CategoryBar from '@/components/category-bar'

type LeadRow = {
  id: string
  name: string
  email: string
  status: string
  created_at: string
  lead_analyses: { score: number; category: string; intent: string }[] | null
}

const CATEGORY_STYLES: Record<string, string> = {
  HOT: 'bg-red-100 text-red-700',
  WARM: 'bg-amber-100 text-amber-700',
  COLD: 'bg-sky-100 text-sky-700',
}

const CATEGORIES = ['HOT', 'WARM', 'COLD'] as const
const PERIODS: { key: string; label: string; days: number | null }[] = [
  { key: 'all', label: 'All time', days: null },
  { key: '7', label: '7 days', days: 7 },
  { key: '30', label: '30 days', days: 30 },
]

/** Only known values survive; anything else falls back to "no filter". */
function parseFilters(params: Record<string, string | string[] | undefined>) {
  const rawCategory = typeof params.category === 'string' ? params.category.toUpperCase() : ''
  const category = (CATEGORIES as readonly string[]).includes(rawCategory) ? rawCategory : null
  const rawPeriod = typeof params.days === 'string' ? params.days : 'all'
  const period = PERIODS.find((p) => p.key === rawPeriod) ?? PERIODS[0]
  return { category, period }
}

function filterHref(active: { category: string | null; periodKey: string }, category: string | null, periodKey: string) {
  const qs = new URLSearchParams()
  if (category) qs.set('category', category)
  if (periodKey !== 'all') qs.set('days', periodKey)
  const s = qs.toString()
  return s ? `/?${s}` : '/'
}

const PILL = 'rounded-full border px-3 py-1 text-xs font-medium'
const PILL_ON = 'border-gray-900 bg-gray-900 text-white'
const PILL_OFF = 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const supabase = await createClient()
  const params = await searchParams
  const { category, period } = parseFilters(params)

  let query = supabase
    .from('leads')
    .select('id, name, email, status, created_at, lead_analyses(score, category, intent)')
    .order('created_at', { ascending: false })
    .limit(50)

  if (category) query = query.filter('lead_analyses.category', 'eq', category)
  if (period.days !== null) {
    query = query.gte('created_at', new Date(Date.now() - period.days * 86_400_000).toISOString())
  }

  const { data, error } = await query

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

  const rows: LeadRow[] = data ?? []
  const active = { category, periodKey: period.key }
  const byCategory = { HOT: 0, WARM: 0, COLD: 0 }
  for (const row of rows) {
    const c = row.lead_analyses?.[0]?.category
    if (c && c in byCategory) byCategory[c as keyof typeof byCategory] += 1
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <SiteHeader
        title="Lead Dashboard"
        subtitle="Every lead that is visible to your role (RLS-enforced by Supabase)."
      />

      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-white p-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Category</span>
          <a href={filterHref(active, null, period.key)} className={`${PILL} ${category === null ? PILL_ON : PILL_OFF}`}>All</a>
          {CATEGORIES.map((c) => (
            <a key={c} href={filterHref(active, c, period.key)} className={`${PILL} ${category === c ? PILL_ON : PILL_OFF}`}>
              {c}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Created</span>
          {PERIODS.map((p) => (
            <a key={p.key} href={filterHref(active, category, p.key)} className={`${PILL} ${period.key === p.key ? PILL_ON : PILL_OFF}`}>
              {p.label}
            </a>
          ))}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-4">
        <div className={`rounded-lg border bg-white p-4 ${byCategory.HOT > 0 ? 'border-red-300 bg-red-50' : ''}`}>
          <p className={`text-2xl font-semibold ${byCategory.HOT > 0 ? 'text-red-700' : ''}`}>{byCategory.HOT}</p>
          <p className="text-sm text-gray-500">hot (in current view)</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-2xl font-semibold">{rows.length}</p>
          <p className="text-sm text-gray-500">leads visible to you</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-2xl font-semibold">{rows.filter((r) => r.status === 'new').length}</p>
          <p className="text-sm text-gray-500">still untouched (status: new)</p>
        </div>
      </div>

      <div className="mb-8 rounded-lg border bg-white p-4">
        <p className="mb-3 text-sm font-medium text-gray-700">Category mix (in current view)</p>
        <CategoryBar counts={byCategory} />
      </div>

      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Intent</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  {category || period.days !== null
                    ? 'No leads match these filters.'
                    : 'No leads visible — this is correct for marketing/teacher roles (RLS).'}
                </td>
              </tr>
            )}
            {rows.map((lead) => {
              const analysis = lead.lead_analyses?.[0]
              return (
                <tr key={lead.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">
                    <a href={`/leads/${lead.id}`} className="hover:underline">{lead.name}</a>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{lead.email}</td>
                  <td className="px-4 py-3">
                    {analysis ? (
                      <span className={`rounded px-2 py-0.5 text-xs font-semibold ${CATEGORY_STYLES[analysis.category] ?? 'bg-gray-100'}`}>
                        {analysis.category}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">not analyzed</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{analysis?.score ?? '—'}</td>
                  <td className="px-4 py-3">{analysis?.intent ?? '—'}</td>
                  <td className="px-4 py-3">{lead.status}</td>
                  <td className="px-4 py-3 text-gray-500">
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
