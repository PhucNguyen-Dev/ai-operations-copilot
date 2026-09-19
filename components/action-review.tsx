'use client'
import { useState } from 'react'

// =============================================================
// ActionReview — the human approval gate on AI output (client island).
// Approve / Edit / Reject against POST /api/leads/[id]/decisions.
// Approval EXECUTES: the route dispatches approved email drafts
// (Brevo, or honest simulation when unconfigured) and creates tasks
// for approved recommendations. The execution outcome comes back in
// `execution` and renders as a second line — sent / simulated /
// failed states are all explicit, never implied.
// =============================================================

type Decision = { decision: string; decidedBy: string; createdAt: string; note: string | null }

export default function ActionReview({
  leadId,
  target,
  emailId = null,
  existing = null,
  body = null,
  compact = false,
}: {
  leadId: string
  target: 'recommended_action' | 'email_draft'
  emailId?: string | null
  existing?: Decision | null
  body?: string | null
  compact?: boolean
}) {
  const [decision, setDecision] = useState<Decision | null>(existing)
  const [execution, setExecution] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draftBody, setDraftBody] = useState(body ?? '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function decide(kind: 'approved' | 'rejected' | 'edited', editedBody?: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/leads/${leadId}/decisions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          kind === 'edited'
            ? { target, decision: kind, emailId, editedBody }
            : { target, decision: kind, note: note || null, emailId }
        ),
      })
      const out = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(out.error ?? 'Could not record the decision')
        return
      }
      setDecision({ decision: kind, decidedBy: 'you', createdAt: out.decidedAt, note: kind === 'edited' ? null : note || null })
      setExecution(typeof out.execution === 'string' ? out.execution : null)
      setEditing(false)
    } finally {
      setBusy(false)
    }
  }

  if (decision) {
    const at = new Date(decision.createdAt).toLocaleString()
    const label =
      decision.decision === 'approved' ? 'Approved'
      : decision.decision === 'rejected' ? 'Rejected'
      : 'Edited'
    return (
      <div className={compact ? 'mt-1' : 'mt-3'}>
        <p className="text-xs font-medium text-green-700">✓ {label} by {decision.decidedBy} · {at}</p>
        {execution && (
          <p className={`mt-0.5 text-xs font-medium ${
            execution.startsWith('Dispatch failed') ? 'text-red-700' : 'text-gray-700'
          }`}>{execution}</p>
        )}
        {decision.note && <p className="mt-0.5 text-xs text-gray-500">note: {decision.note}</p>}
      </div>
    )
  }

  if (editing) {
    return (
      <div className="mt-2 space-y-2">
        {target === 'email_draft' ? (
          <textarea
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            rows={6}
            className="field text-xs"
            aria-label="Edit email draft body"
          />
        ) : (
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Your edited action / note for the record…"
            className="field text-xs"
            aria-label="Edit note"
          />
        )}
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-primary !px-3 !py-1.5 text-xs"
            disabled={busy}
            onClick={() => decide('edited', target === 'email_draft' ? draftBody : undefined)}
          >
            {busy ? 'Saving…' : 'Save edit'}
          </button>
          <button type="button" className="btn btn-secondary !px-3 !py-1.5 text-xs" disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    )
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary !px-3 !py-1.5 text-xs" disabled={busy} onClick={() => decide('approved')}>
          Approve
        </button>
        <button type="button" className="btn btn-secondary !px-3 !py-1.5 text-xs" disabled={busy} onClick={() => setEditing(true)}>
          Edit
        </button>
        <button type="button" className="btn btn-danger !px-3 !py-1.5 text-xs" disabled={busy} onClick={() => decide('rejected')}>
          Reject
        </button>
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note for the audit trail…"
        className="field mt-2 text-xs"
        aria-label="Decision note"
      />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
