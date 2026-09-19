import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireUser, canViewAutomation } from '@/lib/auth'
import { isUuid, timeAgo } from '@/lib/format'
import SiteHeader from '@/components/site-header'
import ScoreBar from '@/components/score-bar'
import ActionReview from '@/components/action-review'

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

/** Tiny provenance tag — reuses badge styling; distinguishes AI output from human/system actions. */
function AiTag() {
  return <span className="badge badge-dry_run">AI-generated</span>
}

type DecisionRow = {
  target: string
  decision: string
  decision_note: string | null
  created_at: string
  decided_by: string
  email_id: string | null
}

type TimelineEvent = { at: string; label: string; detail: string | null; ai: boolean }

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const operator = await requireUser()
  const { role } = operator
  const supabase = await createClient()

  // RLS decides visibility; the ops-only pipeline-run lookup is an
  // independent read and runs in parallel.
  const [leadResult, runResult] = await Promise.all([
    supabase
      .from('leads')
      .select(
        `id, name, email, phone, source, course_interest, budget, timeline,
         message, status, created_at, assigned_counselor_id,
         lead_analyses(score, category, intent, course, timeline, summary,
                       recommended_action, model, created_at),
         tasks(id, title, details, priority, status, due_at, created_at, created_by),
         sent_emails(id, to_address, subject, body, status, sent_at, created_at),
         profiles!leads_assigned_counselor_id_fkey(full_name, email)`
      )
      .eq('id', id)
      .maybeSingle(),
    canViewAutomation(role)
      ? supabase
          .from('automation_runs')
          .select('id')
          .eq('lead_id', id)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  const { data: lead, error } = leadResult
  const runId = canViewAutomation(role) ? ((runResult.data as { id: string } | null)?.id ?? null) : null

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

  // Approval history for this lead — latest decision per target gates the UI.
  const { data: decisionRows } = await supabase
    .from('lead_action_decisions')
    .select('target, decision, decision_note, created_at, decided_by, email_id')
    .eq('lead_id', id)
    .order('created_at', { ascending: false })
  const decisions: DecisionRow[] = decisionRows ?? []
  const latestDecision = (target: string) => decisions.find((d) => d.target === target) ?? null
  const recommendationDecision = latestDecision('recommended_action')

  // --- compact activity timeline: ONLY events with real timestamps ---
  const timeline: TimelineEvent[] = [
    { at: lead.created_at, label: 'Lead received', detail: `source: ${lead.source}`, ai: false },
    ...(analysis
      ? [{
          at: analysis.created_at,
          label: 'AI analyzed · classified',
          detail: `${analysis.category} · score ${analysis.score}${analysis.model ? ` · model ${analysis.model}` : ''}`,
          ai: true,
        }]
      : []),
    ...tasks.map((t) => ({
      at: t.created_at,
      label: 'Follow-up task created',
      detail: `${t.title} (${t.priority}, ${t.status})`,
      ai: false,
    })),
    ...emails.map((e) => ({
      at: e.created_at,
      label: 'Email draft recorded',
      detail: `${e.subject} · ${e.status}${e.sent_at ? ' · sent' : ''}`,
      ai: true,
    })),
    ...decisions.map((d) => ({
      at: d.created_at,
      label: `Human decision: ${d.decision}`,
      detail: `${d.target}${d.decision_note ? ` — "${d.decision_note}"` : ''}`,
      ai: false,
    })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <nav className="mb-3 text-xs text-gray-500" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-gray-800 hover:underline">Dashboard</Link>
        <span className="mx-1">/</span>
        <span className="text-gray-700">{lead.name}</span>
      </nav>

      {/* 1 — compact status context above the name */}
      <div className="mb-1 flex flex-wrap items-center gap-2">
        {analysis && (
          <>
            <span className={`badge badge-${analysis.category.toLowerCase()}`}>{analysis.category}</span>
            <span className="text-sm font-semibold text-gray-700">{analysis.score}</span>
            <span className="text-xs text-gray-500">· {analysis.intent} intent</span>
          </>
        )}
        <span className="text-xs text-gray-500">|</span>
        <span className="text-xs text-gray-600">Status: <span className={`badge badge-${lead.status}`}>{lead.status}</span></span>
        <span className="text-xs text-gray-600">· Assigned: {counselor?.full_name ?? '—'}</span>
      </div>
      <SiteHeader title={lead.name} subtitle={`Lead detail · received ${timeAgo(lead.created_at)}`} />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Lead record — unchanged structure */}
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

        {/* 2/6 — AI analysis split: Assessment (AI) + Recommended Action (human gate) */}
        <section className={`rounded-lg border bg-white border-l-4 p-6 ${analysis ? CATEGORY_BORDER[analysis.category] ?? 'border-l-gray-300' : ''}`}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">AI analysis</h2>
            {analysis && <AiTag />}
          </div>
          {analysis ? (
            <>
              {/* 2a — AI Assessment: reasoning + score kept as-is */}
              <div className="mb-4">
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
                {analysis.summary && <p className="text-sm text-gray-700">{analysis.summary}</p>}
                <p className="mt-4 text-xs text-gray-400">
                  model {analysis.model ?? 'unknown'} · analyzed {timeAgo(analysis.created_at)}
                </p>
              </div>

              {/* 2b — Recommended Action: pulled out, approval affordance */}
              <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Recommended action</p>
                <p className="mt-1 text-sm font-medium text-gray-900">
                  {analysis.recommended_action ?? 'No recommendation recorded'}
                </p>
                {analysis.recommended_action && !recommendationDecision && (
                  <ActionReview leadId={lead.id} target="recommended_action" />
                )}
                {recommendationDecision && (
                  <ActionReview
                    leadId={lead.id}
                    target="recommended_action"
                    existing={{
                      decision: recommendationDecision.decision,
                      decidedBy: recommendationDecision.decided_by === operator.id ? 'you' : 'another operator',
                      createdAt: recommendationDecision.created_at,
                      note: recommendationDecision.decision_note,
                    }}
                  />
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-500">Not analyzed yet.</p>
          )}
        </section>

        {/* Follow-up tasks — unchanged structure */}
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

        {/* Generated communication — same list, approval gate on dry_run drafts */}
        <section className="rounded-lg border bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Emails</h2>
            {emails.length > 0 && <AiTag />}
          </div>
          {emails.length === 0 ? (
            <p className="text-sm text-gray-500">No emails recorded for this lead.</p>
          ) : (
            <ul className="space-y-3">
              {emails.map((e) => {
                const emailDecision = decisions.find((d) => d.target === 'email_draft' && d.email_id === e.id) ?? null
                const dryRun = e.status === 'dry_run'
                return (
                  <li key={e.id} className="rounded border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{e.subject}</p>
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${dryRun ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-700'}`}>
                        {e.status}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">{e.body}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      to {e.to_address} · {e.sent_at ? `sent ${timeAgo(e.sent_at)}` : `recorded ${timeAgo(e.created_at)}`}
                    </p>
                    {dryRun && !e.sent_at && (
                      <ActionReview
                        leadId={lead.id}
                        target="email_draft"
                        emailId={e.id}
                        compact
                        body={e.body}
                        existing={
                          emailDecision
                            ? {
                                decision: emailDecision.decision,
                                decidedBy: emailDecision.decided_by === operator.id ? 'you' : 'another operator',
                                createdAt: emailDecision.created_at,
                                note: emailDecision.decision_note,
                              }
                            : null
                        }
                      />
                    )}
                    {e.sent_at && (
                      <p className="mt-2 text-xs font-medium text-green-700">✓ Email sent · {new Date(e.sent_at).toLocaleString()}</p>
                    )}
                  </li>
                )
              })}
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

      {/* 5 — compact activity timeline: only real, timestamped events */}
      <section aria-label="Activity timeline" className="mt-6 rounded-lg border bg-white p-6">
        <h2 className="mb-4 font-semibold">Activity timeline</h2>
        <ol className="space-y-0">
          {timeline.map((event, i) => (
            <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
              <div className="flex flex-col items-center">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${event.ai ? 'bg-indigo-400' : 'bg-gray-400'}`} title={event.ai ? 'AI-generated' : 'Human/system action'} />
                {i < timeline.length - 1 && <span className="w-px flex-1 bg-gray-200" />}
              </div>
              <div className="min-w-0 pb-0.5">
                <p className="text-sm text-gray-800">
                  {event.label} {event.ai && <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-500">AI</span>}
                </p>
                {event.detail && <p className="text-xs text-gray-500">{event.detail}</p>}
                <p className="text-xs text-gray-400">{new Date(event.at).toLocaleString()}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}
