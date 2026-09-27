import { afterEach, describe, expect, it, vi } from 'vitest'

// =============================================================
// Bundle B streaming layer, unit-tested at the boundaries:
//   * generateAgentTurnStream: SSE parse → identical resolved result
//     as the non-streamed turn; deltas emitted; retry never re-emits.
//   * run-stream-client: the reliability ladder (stream → poll →
//     fallback) against a mocked fetch.
// No network, no env — GEMINI key paths run against mocked fetch.
// =============================================================

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.stubGlobal('fetch', mocks.fetch)
vi.stubEnv('GEMINI_API_KEY', 'test-key')
vi.stubEnv('AI_MODEL', 'gemini-test')

import { generateAgentTurnStream } from '@/lib/gemini'

const sseResponse = (chunks: string[]) =>
  ({
    ok: true,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    body: {
      getReader: () => {
        let i = 0
        return {
          read: async () => (i < chunks.length ? { done: false, value: new TextEncoder().encode(chunks[i++]) } : { done: true, value: undefined }),
        }
      },
    },
  }) as unknown as Response

const jsonTurnResponse = (parts: Record<string, unknown>[], modelVersion = 'gemini-test-001', usage = { promptTokenCount: 10, candidatesTokenCount: 5 }) =>
  ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts } }], modelVersion, usageMetadata: usage }),
  }) as unknown as Response

const textPart = (t: string) => ({ text: t })
const callPart = { functionCall: { name: 'search_leads', args: { limit: 5 } } }

afterEach(() => {
  mocks.fetch.mockReset()
})

describe('generateAgentTurnStream (B1)', () => {
  it('parses SSE chunks, emits deltas, and resolves to the same contract as generateAgentTurn', async () => {
    const chunks = [
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [textPart('Searching')] } }] })}\n\n`,
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [textPart(' the CRM…')] } }], modelVersion: 'gemini-test-001' })}\n\n`,
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [callPart] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } })}\n\n`,
    ]
    mocks.fetch.mockResolvedValueOnce(sseResponse(chunks))
    const deltas: string[] = []
    const result = await generateAgentTurnStream({ tool: 'agent-runtime', system: 'sys', contents: [], declarations: [], onDelta: (c) => deltas.push(c) })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(deltas).toEqual(['Searching', ' the CRM…'])
      expect(result.text).toBe('Searching the CRM…')
      expect(result.calls).toEqual([{ name: 'search_leads', args: { limit: 5 } }])
      expect(result.turnParts).toHaveLength(3)
      expect(result.model).toBe('gemini-test-001')
      expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5 })
    }
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(String(mocks.fetch.mock.calls[0][0])).toContain('streamGenerateContent')
  })

  it('excludes thought parts from deltas and from turnParts', async () => {
    const chunks = [`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'private thought', thought: true }, textPart('visible')] } }] })}\n\n`]
    mocks.fetch.mockResolvedValueOnce(sseResponse(chunks))
    const deltas: string[] = []
    const result = await generateAgentTurnStream({ tool: 'agent-runtime', system: 's', contents: [], declarations: [], onDelta: (c) => deltas.push(c) })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(deltas).toEqual(['visible'])
      expect(result.turnParts).toHaveLength(1)
      expect(result.text).toBe('visible')
    }
  })

  it('retries a transient stream failure non-streamed — deltas are never double-emitted', async () => {
    mocks.fetch
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'overloaded' } as unknown as Response)
      .mockResolvedValueOnce(jsonTurnResponse([textPart('recovered')]))
    const deltas: string[] = []
    const result = await generateAgentTurnStream({ tool: 'agent-runtime', system: 's', contents: [], declarations: [], onDelta: (c) => deltas.push(c) })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.text).toBe('recovered')
    expect(deltas).toEqual([])
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(String(mocks.fetch.mock.calls[1][0])).not.toContain('streamGenerateContent')
  })

  it('does not retry a permanent failure (4xx)', async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'bad key' } as unknown as Response)
    const result = await generateAgentTurnStream({ tool: 'agent-runtime', system: 's', contents: [], declarations: [] })
    expect(result.ok).toBe(false)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
})

describe('startStreamedRun reliability ladder (B4)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  const load = async () => (await import('@/lib/agent/run-stream-client')).startStreamedRun
  const S = async () => (await load()) as typeof import('@/lib/agent/run-stream-client').startStreamedRun

  it('resolves from the final event and surfaces the run output', async () => {
    const startStreamedRun = await S()
    const finalOutput = { runId: 'r1', status: 'completed', finalOutcome: 'Done', error: null, pendingApprovalId: null, stepCount: 3 }
    const events: unknown[] = []
    const stream = [
      `data: ${JSON.stringify({ type: 'run_started', runId: 'r1', stepCount: 0 })}\n\n`,
      `data: ${JSON.stringify({ type: 'turn_delta', text: 'Hel', stepCount: 0 })}\n\n`,
      `data: ${JSON.stringify({ final: finalOutput })}\n\n`,
    ]
    mocks.fetch.mockResolvedValueOnce(sseResponse(stream))
    const { output, fallbackUsed } = await startStreamedRun({ goal: 'hello' }, (e) => events.push(e))
    expect(fallbackUsed).toBe(false)
    expect(output).toEqual(finalOutput)
    expect(events).toHaveLength(2)
  })

  it('falls back to the JSON route when the stream route is unreachable', async () => {
    const startStreamedRun = await S()
    mocks.fetch
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce(Response.json({ runId: 'r2', status: 'completed', finalOutcome: 'ok', error: null, pendingApprovalId: null, stepCount: 1 }))
    const { output, fallbackUsed } = await startStreamedRun({ goal: 'hello' })
    expect(fallbackUsed).toBe(true)
    expect(output.runId).toBe('r2')
  })

  it('surfaces governance answers (403) without falling back', async () => {
    const startStreamedRun = await S()
    mocks.fetch.mockResolvedValueOnce(Response.json({ error: 'Your role (marketing) is not allowed.' }, { status: 403 }))
    const { output, fallbackUsed } = await startStreamedRun({ goal: 'hello' })
    expect(fallbackUsed).toBe(false)
    expect(output.status).toBe('failed')
    expect(output.error).toContain('role')
  })

  it('polls the durable run to terminal when the stream dies mid-run (never re-POSTs)', async () => {
    vi.useFakeTimers()
    try {
      const startStreamedRun = await S()
      // Stream starts, emits run_started, then the body throws mid-read.
      const brokenStream = {
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: {
          getReader: () => ({
            read: vi
              .fn()
              .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(`data: ${JSON.stringify({ type: 'run_started', runId: 'r3', stepCount: 0 })}\n\n`) })
              .mockRejectedValueOnce(new Error('socket hangup')),
          }),
        },
      } as unknown as Response
      mocks.fetch
        .mockResolvedValueOnce(brokenStream)
        // poll 1: still running; poll 2: completed
        .mockResolvedValueOnce(Response.json({ run: { status: 'running', final_outcome: null, error: null, step_count: 2 } }))
        .mockResolvedValueOnce(Response.json({ run: { status: 'completed', final_outcome: 'All done', error: null, step_count: 4 } }))
      const promise = startStreamedRun({ goal: 'hello' }, undefined, 1)
      await vi.advanceTimersByTimeAsync(10)
      const { output, fallbackUsed } = await promise
      expect(fallbackUsed).toBe(false)
      expect(output.runId).toBe('r3')
      expect(output.status).toBe('completed')
      expect(output.finalOutcome).toBe('All done')
      expect(mocks.fetch).toHaveBeenCalledTimes(3) // stream + 2 polls, NO second POST
    } finally {
      vi.useRealTimers()
    }
  })
})
