import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import SiteHeader from '@/components/site-header'
import NotAllowed from '@/components/not-allowed'
import AgentChat from './AgentChat'

/**
 * 9.9 — Employee "Ask X" interface: role-scoped conversational access
 * to the governed agent runtime. No direct database access from the
 * chat — every answer is produced by registered tools through the
 * same permission engine, guardrails and trace as any other run.
 */
export default async function AgentPage() {
  const { role } = await requireUser()
  if (role !== 'admissions' && role !== 'admin') {
    return <NotAllowed role={role} what="The Ask X agent" />
  }

  const supabase = await createClient()
  const { data: runs } = await supabase
    .from('agent_runs')
    .select('id, goal, status, step_count, final_outcome, error, started_at')
    .order('started_at', { ascending: false })
    .limit(8)

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <SiteHeader
        title="Ask X"
        subtitle="Ask operational questions in plain language. Answers are produced by the governed agent runtime — every tool call is authorized, executed and traced by the platform, never by the model."
      />
      <AgentChat />
      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Recent agent runs</h2>
        <ul className="divide-y rounded-lg border bg-white shadow-sm">
          {(runs ?? []).length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-gray-500">No agent runs yet.</li>
          )}
          {(runs ?? []).map((run) => (
            <li key={run.id} className="flex items-start gap-3 px-4 py-3">
              <span
                className={`mt-0.5 rounded px-2 py-0.5 text-xs font-semibold ${
                  run.status === 'completed'
                    ? 'bg-green-100 text-green-700'
                    : run.status === 'failed'
                      ? 'bg-red-100 text-red-700'
                      : run.status === 'awaiting_approval'
                        ? 'bg-amber-100 text-amber-700'
                        : run.status === 'escalated'
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-blue-100 text-blue-700'
                }`}
              >
                {run.status}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm text-gray-800" title={run.goal}>{run.goal}</p>
                <p className="text-xs text-gray-500">
                  {run.step_count} step{run.step_count === 1 ? '' : 's'}
                  {run.final_outcome ? ` · ${run.final_outcome}` : ''}
                  {run.error ? ` · ${run.error}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
