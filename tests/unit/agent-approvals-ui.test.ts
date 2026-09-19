import { afterEach, describe, expect, it, vi } from 'vitest'
import { decideApproval } from '@/app/(app)/agent/approvals/decide'

// 9.6 — the inbox's decision mapping must not drift from the decision
// endpoint's contract: 200 → resume outcome, 403 self/non-decider,
// 409 conflict, other errors → retryable message. The server remains
// the enforcement point; these tests pin what the client shows.
// =============================================================

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => vi.restoreAllMocks())

describe('decideApproval (approval inbox client helper)', () => {
  it('posts the decision and maps a successful approval with the resumed run status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { approval: { id: 'a1', status: 'approved' }, run: { status: 'completed' } })
    )
    const result = await decideApproval({ id: 'a1', decision: 'approved', note: ' looks good ' }, fetchImpl)

    expect(result).toEqual({ ok: true, status: 'approved', runStatus: 'completed', runError: undefined })
    expect(fetchImpl).toHaveBeenCalledWith('/api/agent/approvals/a1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Trimmed; undefined notes are omitted from the payload entirely.
      body: JSON.stringify({ decision: 'approved', note: 'looks good' }),
    })
  })

  it('omits an empty note instead of sending an empty string', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { approval: { status: 'rejected' } }))
    const result = await decideApproval({ id: 'a2', decision: 'rejected', note: '   ' }, fetchImpl)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.status).toBe('rejected')
    const init = (fetchImpl.mock.calls[0] as [string, RequestInit])[1]
    expect(JSON.parse(String(init.body)).note).toBeUndefined()
  })

  it('maps 403 to a forbidden result with the server message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(403, { error: 'The requesting employee cannot decide their own approval' })
    )
    const result = await decideApproval({ id: 'a3', decision: 'approved' }, fetchImpl)

    expect(result).toEqual({
      ok: false,
      kind: 'forbidden',
      message: 'The requesting employee cannot decide their own approval',
    })
  })

  it('maps 409 to a conflict result with a default message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, { error: 'Approval already decided' }))
    const result = await decideApproval({ id: 'a4', decision: 'rejected' }, fetchImpl)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('conflict')
      expect(result.message).toBe('Approval already decided')
    }
  })

  it('maps other HTTP failures to a retryable failure message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { error: 'boom' }))
    const result = await decideApproval({ id: 'a5', decision: 'approved' }, fetchImpl)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('failed')
      expect(result.message).toBe('boom')
    }
  })

  it('keeps a retryable message when a failure response carries no error body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(502, 'not json'))
    const result = await decideApproval({ id: 'a6', decision: 'approved' }, fetchImpl)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('failed')
      expect(result.message).toContain('try again')
    }
  })

  it('maps a thrown fetch to a network result', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'))
    const result = await decideApproval({ id: 'a7', decision: 'approved' }, fetchImpl)

    expect(result).toEqual({ ok: false, kind: 'network', message: 'Could not reach the server — try again.' })
  })
})
