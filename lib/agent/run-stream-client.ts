'use client'

import type { AgentRunOutput, RuntimeEvent } from '@/lib/agent/runtime'

// =============================================================
// Client half of Bundle B (streaming Ask X). Consumes
// POST /api/agent/runs/stream, calls onEvent per runtime event, and
// resolves to the SAME AgentRunOutput the JSON route returns.
//
// Reliability ladder (deliberately boring):
//   1. stream completes → final event resolves the run
//   2. stream errors mid-run → POLL /api/agent/runs/[id] until a
//      terminal status (the run itself is durable; never re-POST a
//      possibly-running goal)
//   3. route unreachable / non-stream response → ONE fallback POST to
//      the JSON route (identical payload; governance identical)
// =============================================================

export type RunStreamResult = { output: AgentRunOutput; fallbackUsed: boolean }

type TerminalStatus = 'completed' | 'failed' | 'escalated' | 'clarification_required' | 'cancelled'

const TERMINAL: ReadonlySet<string> = new Set<TerminalStatus>([
  'completed',
  'failed',
  'escalated',
  'clarification_required',
  'cancelled',
])

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function startStreamedRun(
  body: Record<string, unknown>,
  onEvent?: (event: RuntimeEvent) => void,
  /** Poll interval for the disconnect-resume ladder (tests shrink it; default 2s). */
  pollMs = 2_000
): Promise<RunStreamResult> {
  // --- attempt the stream ---
  let res: Response
  try {
    res = await fetch('/api/agent/runs/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    return fallback(body)
  }

  if (!res.ok || !res.body) {
    // 403/429/400 are governance answers, not stream failures: surface
    // them exactly as the JSON route would (message from the body).
    let error: string | null = null
    try {
      error = ((await res.json()) as { error?: string }).error ?? null
    } catch {
      /* non-JSON error body */
    }
    if (!error) return fallback(body)
    return {
      output: {
        runId: '',
        status: 'failed',
        finalOutcome: null,
        error,
        pendingApprovalId: null,
        stepCount: 0,
      },
      fallbackUsed: false,
    }
  }

  const ctype = res.headers.get('content-type') ?? ''
  if (!ctype.includes('text/event-stream')) {
    return fallback(body)
  }

  // --- consume the SSE stream ---
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let final: AgentRunOutput | null = null
  let lastRunId: string | null = null

  const parseEvent = (payload: string): void => {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(payload) as Record<string, unknown>
    } catch {
      return
    }
    if (typeof parsed.final === 'object' && parsed.final !== null) {
      final = parsed.final as AgentRunOutput
      return
    }
    if (typeof parsed.error === 'string') {
      final = {
        runId: lastRunId ?? '',
        status: 'failed',
        finalOutcome: null,
        error: parsed.error,
        pendingApprovalId: null,
        stepCount: 0,
      }
      return
    }
    if (typeof parsed.type === 'string') {
      if (parsed.type === 'run_started' && typeof parsed.runId === 'string') lastRunId = parsed.runId
      onEvent?.(parsed as unknown as RuntimeEvent)
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        parseEvent(line.slice(5).trim())
        if (final) return { output: final, fallbackUsed: false }
      }
    }
  } catch {
    // Stream broke mid-run — fall through to polling.
  }

  if (final) return { output: final, fallbackUsed: false }

  // --- stream ended without a final: resume from the durable run ---
  if (lastRunId) {
    const resumed = await pollRunToTerminal(lastRunId, 180_000, pollMs)
    if (resumed) return { output: resumed, fallbackUsed: false }
  }

  // No run ever started (e.g. stream died before run_started) and no
  // clean error arrived — the one legitimate re-POST.
  return fallback(body)
}

async function pollRunToTerminal(runId: string, timeoutMs = 180_000, pollMs = 2_000): Promise<AgentRunOutput | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(pollMs)
    try {
      const res = await fetch(`/api/agent/runs/${runId}`, { cache: 'no-store' })
      if (!res.ok) continue
      const trace = (await res.json()) as { run?: { status: string; final_outcome: string | null; error: string | null; step_count: number } }
      const run = trace.run
      if (!run) continue
      if (TERMINAL.has(run.status)) {
        return {
          runId,
          status: run.status as AgentRunOutput['status'],
          finalOutcome: run.final_outcome,
          error: run.error,
          pendingApprovalId: null,
          stepCount: run.step_count,
        }
      }
    } catch {
      /* transient — keep polling until the deadline */
    }
  }
  return null
}

async function fallback(body: Record<string, unknown>): Promise<RunStreamResult> {
  const res = await fetch('/api/agent/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const output = (await res.json().catch(() => ({}))) as AgentRunOutput & { error?: string }
  if (!res.ok) {
    return {
      output: {
        runId: '',
        status: 'failed',
        finalOutcome: null,
        error: output.error ?? 'The agent run failed.',
        pendingApprovalId: null,
        stepCount: 0,
      },
      fallbackUsed: true,
    }
  }
  return { output, fallbackUsed: true }
}
