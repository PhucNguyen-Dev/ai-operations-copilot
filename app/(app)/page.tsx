import { createClient } from '@/lib/supabase/server'
import SiteHeader from '@/components/site-header'
import CategoryBar from '@/components/category-bar'
import { parseLeadFilters, LEAD_CATEGORIES, LEAD_PERIODS } from '@/lib/filters'

type LeadRow = {
  id: string
  name: string
  email: string
  status: string
  created_at: string
  lead_analyses: { score: number; category: string; intent: string }[] | null
}

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
  const supabase = await createClient()
  const params = await searchParams
  const { category, period } = parseLeadFilters(params)
  const q = typeof params.q === 'string' ? params.q.trim().slice(0, 100) : ''

  let query = supabase
    .from('leads')
    .select('id, name, email, status, created_at, lead_analyses(score, category, intent)')
    .order('created_at', { ascending: false })
    .limit(50)

  if (category) query = query.filter('lead_analyses.category', 'eq', category)
  if (period.days !== null) {
    query = query.gte('created_at', new Date(Date.now() - period.days * 86_400_000).toISOString())
  }
  if (q) query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%`)

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
  const active = { category, periodKey: period.key, q }
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

      <div className="table-card mb-8">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Category</th>
              <th scope="col">Score</th>
              <th scope="col">Intent</th>
              <th scope="col">Status</th>
              <th scope="col">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  {q
                    ? `No leads match "${q}".`
                    : category || period.days !== null
                      ? 'No leads match these filters.'
                      : 'No leads visible — this is correct for marketing/teacher roles (RLS).'}
                </td>
              </tr>
            )}
            {rows.map((lead) => {
              const analysis = lead.lead_analyses?.[0]
              return (
                <tr key={lead.id}>
                  <td className="px-4 py-3 font-medium">
                    <a href={`/leads/${lead.id}`} className="text-[var(--brand)] hover:underline">{lead.name}</a>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{lead.email}</td>
                  <td className="px-4 py-3">
                    {analysis ? (
                      <span className={`badge badge-${analysis.category.toLowerCase()}`}>{analysis.category}</span>
                    ) : (
                      <span className="text-xs text-gray-400">not analyzed</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{analysis?.score ?? '—'}</td>
                  <td className="px-4 py-3">{analysis?.intent ?? '—'}</td>
                  <td className="px-4 py-3"><span className={`badge badge-${lead.status}`}>{lead.status}</span></td>
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
