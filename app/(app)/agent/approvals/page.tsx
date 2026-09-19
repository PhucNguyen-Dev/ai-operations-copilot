import { requireUser, canViewAutomation } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import SiteHeader from '@/components/site-header'
import NotAllowed from '@/components/not-allowed'
import { timeAgo } from '@/lib/format'
import ApprovalsInbox from './ApprovalsInbox'

// =============================================================
// 9.6 — Human approval inbox. Pending agent approvals surfaced as
// decidable cards, with the decision history below. Data flows through
// the caller's RLS client (ops/admin see all runs' approvals); the
// decision endpoint still enforces every server-side rule — independent
// decider, immutable decisions, at-most-once resume — so this page is
// convenience over the same governed protocol, never a bypass.
// =============================================================

type ApprovalRow = {
  id: string
  run_id: string
  tool_name: string
  args_snapshot: Record<string, unknown> | null
  status: string
  requested_by: string
  requested_at: string
  decision_note: string | null
}

export default async function AgentApprovalsPage() {
  const { id: userId, role } = await requireUser()
  if (!canViewAutomation(role)) {
    return <NotAllowed role={role} what="The agent approval inbox" />
  }

  const supabase = await createClient()
  const { data: approvals, error } = await supabase
    .from('agent_approvals')
    .select('id, run_id, tool_name, args_snapshot, status, requested_by, requested_at, decision_note')
    .order('requested_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('[agent-approvals] query failed:', error.message)
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <SiteHeader title="Agent approvals" />
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          Could not load approvals — please try again. The issue has been logged.
        </div>
      </main>
    )
  }

  const rows = (approvals ?? []) as ApprovalRow[]
  const pending = rows.filter((a) => a.status === 'pending')
  const history = rows.filter((a) => a.status !== 'pending')

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <SiteHeader
        title="Agent approvals"
        subtitle="High-risk actions proposed by the governed agent wait here for an independent Operations/Admin decision. The requesting employee can never decide their own request."
      />

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Pending decisions{pending.length > 0 ? ` (${pending.length})` : ''}
        </h2>
        {pending.length === 0 ? (
          <p className="rounded-lg border bg-white px-4 py-6 text-center text-sm text-gray-500 shadow-sm">
            Nothing is waiting on a decision.
          </p>
        ) : (
          <ul className="space-y-3">
            {pending.map((a) => (
              <ApprovalsInbox key={a.id} approval={a} requesterIsSelf={a.requested_by === userId} />
            ))}
          </ul>
        )}
      </section>

      {history.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Recent decisions</h2>
          <ul className="divide-y rounded-lg border bg-white shadow-sm">
            {history.map((a) => (
              <li key={a.id} className="flex items-start gap-3 px-4 py-3">
                <span
                  className={`mt-0.5 rounded px-2 py-0.5 text-xs font-semibold ${
                    a.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}
                >
                  {a.status}
                </span>
                <div className="min-w-0 text-xs text-gray-600">
                  <p>
                    <span className="font-mono font-semibold text-gray-800">{a.tool_name}</span>
                    {` · run ${a.run_id.slice(0, 8)} · requested ${timeAgo(a.requested_at)}`}
                  </p>
                  {a.decision_note && (
                    <p className="mt-0.5 truncate italic text-gray-500" title={a.decision_note}>
                      “{a.decision_note}”
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
