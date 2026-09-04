import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import LogoutButton from '@/components/logout-button'

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

export default async function Home() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const role = (user.app_metadata as Record<string, string> | undefined)?.role ?? 'unknown'

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', user.id)
    .single()

  const { data: leads } = await supabase
    .from('leads')
    .select('id, name, email, status, created_at, lead_analyses(score, category, intent)')
    .order('created_at', { ascending: false })
    .limit(50)

  // Ops/Admin-only table: this query FAILS silently for other roles —
  // which is exactly the RLS behavior this page exists to demonstrate.
  const { count: runCount } = await supabase
    .from('automation_runs')
    .select('id', { count: 'exact', head: true })

  const { count: notificationCount } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })

  const rows: LeadRow[] = leads ?? []

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Lead Dashboard (Phase 2 verification)</h1>
          <p className="mt-1 text-sm text-gray-500">
            Signed in as <span className="font-medium text-gray-900">{profile?.full_name ?? user.email}</span>
            {' · role: '}
            <span className="inline-block rounded bg-gray-900 px-1.5 py-0.5 font-mono text-xs text-white">{role}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(role === 'admissions' || role === 'admin') && (
            <a
              href="/leads/new"
              className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
            >
              + New Test Lead
            </a>
          )}
          <LogoutButton />
        </div>
      </div>

      <div className="mb-8 grid grid-cols-3 gap-4">
        <div className="rounded-lg border bg-white p-4">
          <p className="text-2xl font-semibold">{rows.length}</p>
          <p className="text-sm text-gray-500">leads visible to you</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-2xl font-semibold">{runCount ?? '—'}</p>
          <p className="text-sm text-gray-500">
            automation runs {runCount === null ? '(blocked by RLS)' : '(visible)'}
          </p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-2xl font-semibold">{notificationCount ?? 0}</p>
          <p className="text-sm text-gray-500">notifications for you</p>
        </div>
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
                  No leads visible — this is correct for marketing/teacher roles (RLS).
                </td>
              </tr>
            )}
            {rows.map((lead) => {
              const analysis = lead.lead_analyses?.[0]
              return (
                <tr key={lead.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">{lead.name}</td>
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
        Expected: counselor → 5 assigned leads; admin/operations → all 8 + runs visible;
        marketing/teacher → 0 leads, runs blocked. Full dashboard UI arrives in Phase 5.
      </p>
    </main>
  )
}
