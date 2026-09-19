'use client'

import { useRef, useState } from 'react'

// =============================================================
// 9.9 — Ask X chat client. Each user message starts one governed run
// (POST /api/agent/runs); the answer card shows the run's outcome and
// its full tool-call trace (GET /api/agent/runs/[id]) so an employee
// can see exactly what the agent did and why. Approval-required runs
// surface a clear "needs human approval" state (9.6).
// =============================================================

type TraceStep = {
  kind: 'tool_call' | 'system'
  step_index: number
  tool_name: string | null
  status: string
  permission_decision: string | null
  error: string | null
  result_summary: unknown
}

type Trace = {
  run: { status: string; final_outcome: string | null; error: string | null; tokens_in: number; tokens_out: number }
  steps: TraceStep[]
  approvals: { id: string; status: string }[]
}

type Message = {
  role: 'user' | 'assistant'
  text: string
  runId?: string
  status?: string
  pendingApproval?: boolean
  trace?: Trace
  refreshing?: boolean
  refreshError?: string
}

const STATUS_STYLE: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  escalated: 'bg-purple-100 text-purple-700',
  awaiting_approval: 'bg-amber-100 text-amber-700',
  running: 'bg-blue-100 text-blue-700',
}

const STEP_STYLE: Record<string, string> = {
  success: 'bg-green-50 text-green-700 border-green-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  denied: 'bg-orange-50 text-orange-700 border-orange-200',
  approval_required: 'bg-amber-50 text-amber-700 border-amber-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  skipped: 'bg-gray-50 text-gray-500 border-gray-200',
}

const SUGGESTIONS = [
  'Which of my leads need follow-up today?',
  'Summarize my hottest lead and what the SOP says to do next.',
  'What is the early-bird discount policy?',
]

export default function AgentChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () =>
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }))

  async function send(text: string) {
    const goal = text.trim()
    if (!goal || busy) return
    setBusy(true)
    setInput('')
    setMessages((m) => [...m, { role: 'user', text: goal }, { role: 'assistant', text: 'Working…', status: 'running' }])
    scrollToBottom()

    try {
      const res = await fetch('/api/agent/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal, agentId: 'admissions-followup' }),
      })
      const out = await res.json().catch(() => ({}))

      if (!res.ok) {
        setMessages((m) => [...m.slice(0, -1), { role: 'assistant', text: out.error ?? 'The agent run failed to start.', status: 'failed' }])
        return
      }

      // Pull the durable trace so the answer card shows the real steps.
      let trace: Trace | undefined
      if (out.runId) {
        const t = await fetch(`/api/agent/runs/${out.runId}`)
        if (t.ok) trace = await t.json()
      }

      const answer =
        out.status === 'completed'
          ? out.finalOutcome ?? 'Done.'
          : out.status === 'awaiting_approval'
            ? 'This needs human approval before the action can be recorded — Operations/Admin can approve it. The proposed action is shown in the run trace below.'
            : out.status === 'escalated'
              ? `Escalated to a human: ${out.finalOutcome ?? 'see the run trace'}`
              : `The run failed: ${out.error ?? 'unknown error'} (the full trace was logged).`

      setMessages((m) => [...m.slice(0, -1), { role: 'assistant', text: answer, runId: out.runId, status: out.status, pendingApproval: out.status === 'awaiting_approval', trace }])
      scrollToBottom()
    } catch {
      setMessages((m) => [...m.slice(0, -1), { role: 'assistant', text: 'Could not reach the agent runtime — try again in a moment.', status: 'failed' }])
    } finally {
      setBusy(false)
    }
  }

  async function refreshRun(runId: string) {
    setMessages((m) => m.map((msg) => msg.runId === runId ? { ...msg, refreshing: true, refreshError: undefined } : msg))
    try {
      const res = await fetch(`/api/agent/runs/${runId}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Could not refresh the run trace. Try again.')
      const trace: Trace = await res.json()
      const status = trace.run.status
      setMessages((m) => m.map((msg) => msg.runId === runId ? {
        ...msg,
        trace,
        status,
        pendingApproval: status === 'awaiting_approval',
        text: status === 'awaiting_approval' ? msg.text
          : status === 'running' ? 'The approved run is still working. Refresh again for its result.'
            : status === 'failed' ? `The run failed: ${trace.run.error ?? 'unknown error'}`
              : trace.run.final_outcome ?? (status === 'completed' ? 'Done.' : `Run ${status}.`),
      } : msg))
    } catch {
      setMessages((m) => m.map((msg) => msg.runId === runId ? { ...msg, refreshError: 'Could not refresh the run trace. Try again.' } : msg))
    } finally {
      setMessages((m) => m.map((msg) => msg.runId === runId ? { ...msg, refreshing: false } : msg))
    }
  }

  return (
    <div className="rounded-lg border bg-white shadow-sm" data-testid="chat">
      <div ref={listRef} className="max-h-[26rem] space-y-4 overflow-y-auto p-4" aria-live="polite">
        {messages.length === 0 && (
          <div className="py-4 text-center text-sm text-gray-500">
            <p className="mb-3">Ask about your leads, tasks, SOPs or follow-ups. Examples:</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  disabled={busy}
                  className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) =>
          msg.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] rounded-lg rounded-br-sm bg-gray-900 px-3 py-2 text-sm text-white">{msg.text}</p>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className="max-w-[90%] space-y-2">
                <div className="flex items-start gap-2">
                  {msg.status && msg.status !== 'running' && (
                    <span className={`mt-0.5 rounded px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[msg.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {msg.status.replace('_', ' ')}
                    </span>
                  )}
                  <p className={`rounded-lg rounded-bl-sm px-3 py-2 text-sm ${msg.status === 'failed' ? 'bg-red-50 text-red-800' : 'bg-gray-100 text-gray-800'}`}>
                    {msg.text}
                  </p>
                </div>

                {msg.pendingApproval && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    ⏸ Awaiting human approval — the agent paused instead of acting on its own (run {msg.runId?.slice(0, 8)}).
                  </p>
                )}

                {msg.runId && (msg.pendingApproval || msg.status === 'running') && (
                  <button
                    type="button"
                    onClick={() => refreshRun(msg.runId!)}
                    disabled={msg.refreshing}
                    className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {msg.refreshing ? 'Refreshing…' : 'Refresh run trace'}
                  </button>
                )}
                {msg.refreshError && <p role="alert" className="text-xs text-red-600">{msg.refreshError}</p>}

                {msg.trace && msg.trace.steps.length > 0 && (
                  <details className="rounded-lg border text-sm" data-testid="run-trace">
                    <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50">
                      Run trace — {msg.trace.steps.filter((s) => s.kind === 'tool_call').length} step(s), {msg.trace.run.tokens_in + msg.trace.run.tokens_out} tokens
                    </summary>
                    <ol className="space-y-1 border-t p-3">
                      {msg.trace.steps.map((s) => (
                        <li key={s.step_index} className="flex items-start gap-2">
                          <span className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${STEP_STYLE[s.status] ?? 'border-gray-200 bg-gray-50 text-gray-600'}`}>
                            {s.status.replace('_', ' ')}
                          </span>
                          <div className="min-w-0 text-xs text-gray-700">
                            <span className="font-mono font-semibold">{s.tool_name ?? 'system'}</span>
                            {s.permission_decision && <span className="text-gray-400"> · {s.permission_decision}</span>}
                            {s.error && <span className="block text-red-600">{s.error}</span>}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </div>
            </div>
          )
        )}
      </div>

      <form
        className="flex gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={busy ? 'The agent is working…' : 'Ask about your leads, tasks or SOPs…'}
          disabled={busy}
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none disabled:bg-gray-50"
          aria-label="Ask the agent"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:opacity-40"
        >
          {busy ? 'Running…' : 'Ask'}
        </button>
      </form>
    </div>
  )
}
