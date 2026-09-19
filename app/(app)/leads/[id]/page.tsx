import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireUser, canViewAutomation } from '@/lib/auth'
import { isUuid, timeAgo } from '@/lib/format'
import SiteHeader from '@/components/site-header'
import ScoreBar from '@/components/score-bar'

const CATEGORY_STYLES: Record<string, string> = {
  HOT: 'bg-red-100 text-red-700',
  WARM: 'bg-amber-100 text-amber-700',
  COLD: 'bg-sky-100 text-sky-700',
}

const CATEGORY_BORDER: Record<string, string> = {
  HOT: 'border-l-red-500',
  WARM: 'border-l-amber-400',
  COLD: 'border-l-sky-500',
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-0.5 text-sm text-gray-900">{value || '—'}</p>
    </div>
  )
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const { role } = await requireUser()
  const supabase = await createClient()

  // Single query: RLS decides visibility. Zero rows = either the lead does
  // not exist or the caller is not allowed to see it — same 404 for both
  // (no existence leak).
  const { data: lead, error } = await supabase
    .from('leads')
    .select(
      `id, name, email, phone, source, course_interest, budget, timeline,
       message, status, created_at, assigned_counselor_id,
       lead_analyses(score, category, intent, course, timeline, summary,
                     recommended_action, model, created_at),
       tasks(title, details, priority, status, due_at, created_at),
       sent_emails(to_address, subject, body, status, sent_at, created_at),
       profiles!leads_assigned_counselor_id_fkey(full_name, email)`
    )
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[lead-detail] query failed:', error.message)
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <nav className="mb-3 text-xs text-gray-500" aria-label="Breadcrumb">
          <Link href="/" className="hover:text-gray-800 hover:underline">Dashboard</Link>
          <span className="mx-1">/</span>
          <span className="text-gray-700">Lead Detail</span>
        </nav>
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          Could not load this lead — please try again. The issue has been logged.
        </div>
      </main>
    )
  }
  if (!lead) notFound()

  const analysis = lead.lead_analyses?.[0] ?? null
  const counselor = Array.isArray(lead.profiles) ? lead.profiles[0] : lead.profiles
  const tasks = (lead.tasks ?? []).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )
  const emails = (lead.sent_emails ?? []).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  // Runs link is ops/admin only (RLS would hide the data from everyone else).
  let runId: string | null = null
  if (canViewAutomation(role)) {
    const { data: run } = await supabase
      .from('automation_runs')
      .select('id')
      .eq('lead_id', lead.id)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    runId = run?.id ?? null
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <nav className="mb-3 text-xs text-gray-500" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-gray-800 hover:underline">Dashboard</Link>
        <span className="mx-1">/</span>
        <span className="text-gray-700">{lead.name}</span>
      </nav>
      <SiteHeader title={lead.name} subtitle={`Lead detail · status: ${lead.status}`} />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Lead record */}
        <section className="rounded-lg border bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Lead record</h2>
            <span className="text-xs text-gray-400">submitted {timeAgo(lead.created_at)}</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Email" value={lead.email} />
            <Field label="Phone" value={lead.phone} />
            <Field label="Source" value={lead.source} />
            <Field label="Course interest" value={lead.course_interest} />
            <Field label="Budget" value={lead.budget} />
            <Field label="Timeline" value={lead.timeline} />
            <Field label="Assigned counselor" value={counselor?.full_name ?? null} />
            <Field label="Status" value={lead.status} />
          </div>
          {lead.message && (
            <div className="mt-4 rounded border bg-gray-50 p-3 text-sm text-gray-700">
              “{lead.message}”
            </div>
          )}
        </section>

        {/* AI analysis */}
        <section className={`rounded-lg border bg-white border-l-4 p-6 ${analysis ? CATEGORY_BORDER[analysis.category] ?? 'border-l-gray-300' : ''}`}>
          <h2 className="mb-4 font-semibold">AI analysis</h2>
          {analysis ? (
            <>
              <div className="mb-3 flex items-center gap-3">
                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${CATEGORY_STYLES[analysis.category] ?? 'bg-gray-100'}`}>
                  {analysis.category}
                </span>
                <span className="text-sm text-gray-500">intent {analysis.intent}</span>
              </div>
              <div className="mb-4">
                <ScoreBar score={analysis.score} category={analysis.category} />
                <p className="mt-1 text-xs text-gray-400">conversion likelihood, out of 100</p>
              </div>
              <p className="text-sm text-gray-700">{analysis.summary}</p>
              <p className="mt-3 text-sm">
                <span className="font-medium">Recommended action:</span> {analysis.recommended_action}
              </p>
              <p className="mt-4 text-xs text-gray-400">
                model {analysis.model ?? 'unknown'} · analyzed {timeAgo(analysis.created_at)}
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-500">Not analyzed yet.</p>
          )}
        </section>

        {/* Follow-up tasks (F-010) */}
        <section className="rounded-lg border bg-white p-6">
          <h2 className="mb-4 font-semibold">Follow-up tasks</h2>
          {tasks.length === 0 ? (
            <p className="text-sm text-gray-500">No tasks for this lead.</p>
          ) : (
            <ul className="space-y-3">
              {tasks.map((t, i) => (
                <li key={i} className="rounded border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{t.title}</p>
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${t.priority === 'high' ? 'bg-red-100 text-red-700' : t.priority === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                      {t.priority}
                    </span>
                  </div>
                  {t.details && <p className="mt-1 text-sm text-gray-600">{t.details}</p>}
                  <p className="mt-1 text-xs text-gray-400">
                    {t.status} · due {t.due_at ? timeAgo(t.due_at) : '—'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Sent emails (F-009) */}
        <section className="rounded-lg border bg-white p-6">
          <h2 className="mb-4 font-semibold">Emails</h2>
          {emails.length === 0 ? (
            <p className="text-sm text-gray-500">No emails recorded for this lead.</p>
          ) : (
            <ul className="space-y-3">
              {emails.map((e, i) => (
                <li key={i} className="rounded border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{e.subject}</p>
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${e.status === 'dry_run' ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-700'}`}>
                      {e.status}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">{e.body}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    to {e.to_address} · {e.sent_at ? `sent ${timeAgo(e.sent_at)}` : `recorded ${timeAgo(e.created_at)}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {canViewAutomation(role) && (
            <p className="mt-4 text-xs text-gray-400">
              {runId
                ? <>Pipeline run: <Link className="underline" href={`/runs/${runId}`}>view execution log</Link></>
                : 'No pipeline run linked to this lead.'}
            </p>
          )}
        </section>
      </div>
    </main>
  )
}
