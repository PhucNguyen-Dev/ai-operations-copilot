// =============================================================
// 9.6 — Client-side decision call for one pending agent approval,
// extracted from the card component so the error mapping is unit-testable
// without a DOM. Pure protocol mapping: every server-side rule (independent
// decider, immutable decisions, at-most-once resume) is enforced by the
// decision endpoint; this helper only translates its responses.
// =============================================================

export type ApprovalDecision = 'approved' | 'rejected'

export type DecisionResult =
  | { ok: true; status: ApprovalDecision; runStatus?: string; runError?: string }
  | { ok: false; kind: 'forbidden' | 'conflict' | 'network' | 'failed'; message: string }

type DecisionResponseBody = {
  error?: string
  approval?: { status?: string }
  run?: { status?: string; error?: string }
}

export async function decideApproval(
  { id, decision, note }: { id: string; decision: ApprovalDecision; note?: string },
  fetchImpl: typeof fetch = fetch
): Promise<DecisionResult> {
  let res: Response
  try {
    res = await fetchImpl(`/api/agent/approvals/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, note: note?.trim() || undefined }),
    })
  } catch {
    return { ok: false, kind: 'network', message: 'Could not reach the server — try again.' }
  }

  const body = (await res.json().catch(() => ({}))) as DecisionResponseBody

  if (res.status === 403) {
    return {
      ok: false,
      kind: 'forbidden',
      message: body.error ?? 'Only Operations/Admin can decide this request.',
    }
  }
  if (res.status === 409) {
    return {
      ok: false,
      kind: 'conflict',
      message: body.error ?? 'This request was already decided by someone else.',
    }
  }
  if (!res.ok || !body.approval?.status) {
    return {
      ok: false,
      kind: 'failed',
      message: body.error ?? 'The decision could not be recorded — try again.',
    }
  }
  return {
    ok: true,
    status: body.approval.status as ApprovalDecision,
    runStatus: body.run?.status,
    runError: body.run?.error,
  }
}
