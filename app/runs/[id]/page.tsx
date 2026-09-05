import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireUser, canViewAutomation } from '@/lib/auth'
import { isUuid, timeAgo } from '@/lib/format'
import SiteHeader from '@/components/site-header'
import NotAllowed from '@/components/not-allowed'

const STATUS_STYLE: Record<string, string> = {
  running: 'bg-blue-100 text-blue-700',
  success: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
}

const STEP_STYLE: Record<string, string> = {
  success: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  retried: 'bg-amber-100 text-amber-700',
  skipped: 'bg-gray-100 text-gray-600',
}

function Duration({ started, finished }: { started: string | null; finished: string | null }) {
  if (!started || !finished) return <>—</>
  const ms = new Date(finished).getTime() - new Date(started).getTime()
  return <>{ms < 1000 ? `${ms}ms` : `${Math.round(ms / 100) / 10}s`}</>
}

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const { role } = await requireUser()
  if (!canViewAutomation(role)) return <NotAllowed role={role} what="Automation run details" />

  const supabase = await createClient()

  // RLS hides other roles' data automatically; notFound() on empty.
  const { data: run, error } = await supabase
    .from('automation_runs')
    .select('id, workflow_name, trigger_source, lead_id, status, error_summary, started_at, finished_at')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[run-detail] query failed:', error.message)
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <SiteHeader title="Run detail" />
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          Could not load this run — please try again. The issue has been logged.
        </div>
      </main>
    )
  }
  if (!run) notFound()

  const { data: steps } = await supabase
    .from('automation_run_steps')
    .select('id, feature_id, step_name, status, attempt_count, payload_snapshot, error_detail, started_at, finished_at')
    .eq('run_id', run.id)
    .order('started_at', { ascending: true })

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <SiteHeader
        title={`Run ${run.id.slice(0, 8)}`}
        subtitle={`${run.workflow_name} · triggered by ${run.trigger_source}`}
      />

      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border bg-white p-4">
        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[run.status] ?? 'bg-gray-100'}`}>
          {run.status}
        </span>
        <span className="text-sm text-gray-600">
          started {run.started_at ? timeAgo(run.started_at) : '—'}
        </span>
        <span className="text-sm text-gray-600">
          · duration <Duration started={run.started_at} finished={run.finished_at} />
        </span>
        {run.lead_id && (
          <a href={`/leads/${run.lead_id}`} className="text-sm underline">open lead</a>
        )}
      </div>

      {run.error_summary && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <span className="font-medium">Error:</span> {run.error_summary}
        </div>
      )}

      <h2 className="mb-3 font-semibold">Steps ({(steps ?? []).length})</h2>
      {(steps ?? []).length === 0 ? (
        <p className="rounded-lg border bg-white p-6 text-sm text-gray-500">
          No step rows were recorded for this run — the workflow logs steps only after
          validation passes, or the run crashed before the logging node.
        </p>
      ) : (
        <ol className="space-y-2">
          {(steps ?? []).map((step) => (
            <li key={step.id} className="rounded-lg border bg-white p-4">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-3 text-sm">
                  <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STEP_STYLE[step.status] ?? 'bg-gray-100'}`}>
                    {step.status}
                  </span>
                  <span className="font-medium">{step.step_name}</span>
                  <span className="text-xs text-gray-400">{step.feature_id}</span>
                  <span className="text-xs text-gray-400">
                    ×{step.attempt_count} attempt{step.attempt_count === 1 ? '' : 's'}
                  </span>
                  <span className="text-xs text-gray-400">
                    <Duration started={step.started_at} finished={step.finished_at} />
                  </span>
                </summary>
                {step.error_detail && (
                  <p className="mt-2 rounded border border-red-200 bg-red-50 p-2 font-mono text-xs text-red-700">
                    {step.error_detail}
                  </p>
                )}
                {step.payload_snapshot !== null && step.payload_snapshot !== undefined && (
                  <pre className="mt-2 overflow-x-auto rounded border bg-gray-50 p-2 font-mono text-xs text-gray-700">
                    {JSON.stringify(step.payload_snapshot, null, 2)}
                  </pre>
                )}
              </details>
            </li>
          ))}
        </ol>
      )}
    </main>
  )
}
