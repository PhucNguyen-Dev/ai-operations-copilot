// =============================================================
// PromptLedger run tracing (fire-and-forget). After every owned AI
// call the route handler posts one run record to the registry:
// which prompt version was served, the model, latency, and outcome.
// This is what turns the eval panel from curated A/B inputs into a
// view fed by real production traffic.
//
// Contract: traceAiRun NEVER throws and never blocks the response —
// tracing must not be able to break a user request. Failures are
// logged loudly and swallowed (fail-open, like all telemetry).
// =============================================================

export type RunTrace = {
  app: string
  name: string
  promptVersion: number | null
  promptSource: string | null
  model: string | null
  /** Full user message sent to the model (full-capture policy). */
  input: string
  /** Serialized model output; empty string on failure. */
  output: string
  latencyMs: number | null
  ok: boolean
  /** Error code/message when ok=false. */
  error?: string | null
  /** Token usage when the provider reported it (Gemini usageMetadata). */
  tokensIn?: number | null
  tokensOut?: number | null
}

const TRACE_TIMEOUT_MS = 3_000

export function traceAiRun(trace: RunTrace): void {
  const url = process.env.PROMPTLEDGER_URL
  if (!url) return // unconfigured: committed prompts still work, tracing is simply off

  const apiKey = process.env.PROMPTLEDGER_API_KEY
  const body = JSON.stringify({
    name: trace.name,
    prompt_version: trace.promptVersion,
    prompt_source: trace.promptSource,
    model: trace.model,
    input: trace.input,
    output: trace.output,
    latency_ms: trace.latencyMs,
    tokens_in: trace.tokensIn ?? null,
    tokens_out: trace.tokensOut ?? null,
    ok: trace.ok,
    error: trace.error ?? null,
  })

  fetch(`${url.replace(/\/+$/, '')}/api/runs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
    body,
    signal: AbortSignal.timeout(TRACE_TIMEOUT_MS),
  }).then(
    (res) => {
      if (!res.ok) {
        console.error(`[runtrace] PromptLedger rejected the run trace (HTTP ${res.status})`)
      }
    },
    (e) => console.error('[runtrace] run trace failed (continuing):', String(e))
  )
}
