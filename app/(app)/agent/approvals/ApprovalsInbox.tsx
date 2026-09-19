'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { timeAgo } from '@/lib/format'
import { decideApproval } from './decide'

// =============================================================
// 9.6 — Decision card for one pending agent approval. Pure UI: the
// decision endpoint remains the sole enforcement point (independent
// decider, immutable decisions, at-most-once resume). Client checks
// exist only to fail fast with clearer guidance, and every state is
// rendered regardless of whether the client would show controls.
// =============================================================

type Approval = {
  id: string
  run_id: string
  tool_name: string
  args_snapshot: Record<string, unknown> | null
  requested_at: string
}

export default function ApprovalsInbox({
  approval,
  requesterIsSelf,
}: {
  approval: Approval
  requesterIsSelf: boolean
}) {
  const router = useRouter()
  const [state, setState] = useState<
    | { phase: 'idle' }
    | { phase: 'deciding' }
    | { phase: 'done'; status: 'approved' | 'rejected'; runStatus?: string; runError?: string }
    | { phase: 'error'; message: string }
  >({ phase: 'idle' })
  const [note, setNote] = useState('')
  const [showNote, setShowNote] = useState(false)

  async function decide(decision: 'approved' | 'rejected') {
    if (requesterIsSelf || state.phase === 'deciding' || state.phase === 'done') return
    setState({ phase: 'deciding' })
    const result = await decideApproval({ id: approval.id, decision, note })
    if (result.ok) {
      setState({ phase: 'done', status: result.status, runStatus: result.runStatus, runError: result.runError })
      router.refresh()
    } else {
      setState({ phase: 'error', message: result.message })
    }
  }

  const decided = state.phase === 'done'
  const blocked = requesterIsSelf

  return (
    <li className="rounded-lg border bg-white p-4 shadow-sm" data-testid="approval-card">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">pending</span>
        <span className="font-mono text-sm font-semibold text-gray-900">{approval.tool_name}</span>
        <span className="text-xs text-gray-400">run {approval.run_id.slice(0, 8)}</span>
        <span className="text-xs text-gray-400">· requested {timeAgo(approval.requested_at)}</span>
      </div>

      {approval.args_snapshot != null && (
        <pre
          className="mt-3 max-h-40 overflow-auto rounded-md bg-gray-50 p-3 text-xs text-gray-700"
          data-testid="approval-args"
        >
          {JSON.stringify(approval.args_snapshot, null, 2)}
        </pre>
      )}

      {blocked ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          You requested this action, so you cannot decide it — another Operations/Admin member must review it.
        </p>
      ) : decided ? (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
          <p className="font-semibold">
            {state.status === 'approved' ? '✅ Approved' : '🚫 Rejected'} — the run resumed server-side.
          </p>
          {state.runStatus === 'failed' && (
            <p className="mt-1 text-red-600">Resume failed: {state.runError ?? 'unknown error'} (full trace was logged).</p>
          )}
          {state.runStatus === 'awaiting_approval' && (
            <p className="mt-1 text-amber-700">The resumed run is waiting on another approval.</p>
          )}
          {state.runStatus === 'running' && (
            <p className="mt-1">The run is still executing — check the run trace for its result.</p>
          )}
          {state.runStatus === 'escalated' && (
            <p className="mt-1 text-purple-700">The agent escalated to a human instead of finishing.</p>
          )}
        </div>
      ) : state.phase === 'error' ? (
        <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {state.message}
        </p>
      ) : (
        <>
          {showNote && (
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder="Optional decision note (max 500 chars)"
              className="mt-3 w-full rounded-md border border-gray-300 px-3 py-1.5 text-xs focus:border-gray-900 focus:outline-none"
              aria-label="Decision note"
            />
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => decide('approved')}
              disabled={state.phase === 'deciding'}
              data-testid="approve-button"
              className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-gray-700 disabled:opacity-40"
            >
              {state.phase === 'deciding' ? 'Recording…' : 'Approve & resume'}
            </button>
            <button
              type="button"
              onClick={() => decide('rejected')}
              disabled={state.phase === 'deciding'}
              data-testid="reject-button"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-40"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={() => setShowNote((s) => !s)}
              className="text-xs text-gray-500 underline hover:text-gray-700"
            >
              {showNote ? 'Hide note' : 'Add note'}
            </button>
          </div>
        </>
      )}
    </li>
  )
}
