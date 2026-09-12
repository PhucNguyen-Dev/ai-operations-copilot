// =============================================================
// PromptLedger run tracing (fire-and-forget). After every owned AI
// call the route handler posts one run record to the registry:
// which prompt version was served, the model, latency, and outcome.
// This is what turns the eval panel from curated A/B inputs into a
// view fed by real production traffic.
//
// Deployment pin (lazy, once per prompt version): each trace names the
// deployment snapshot that served it, so an incident is traceable from
// deployment -> exact prompt versions -> every run. The pin is resolved
// before the trace POST and cached per (prompt, version) — one
// deployment per version-combination, never per execution. Fail-open
// twice over: a pin failure logs loudly and the run still traces
// without deployment_id; a trace failure is logged and swallowed.
// Contract: traceAiRun NEVER throws and never blocks the response.
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
const PIN_TIMEOUT_MS = 3_000

/** Pin cache: "name:v<N>" -> deployment id (module-level, per process). */
const pinCache = new Map<string, number>()

/** Test helper — clear the pin cache between unit tests. */
export function resetDeploymentPins(): void {
  pinCache.clear()
}

type DeploymentSummary = {
  id: number
  status: string
  items: Array<{ prompt_name: string; prompt_version: number }>
}

async function ensureDeploymentId(
  name: string,
  promptVersion: number | null
): Promise<number | null> {
  const url = process.env.PROMPTLEDGER_URL
  if (!url || promptVersion == null) return null

  const cacheKey = `${name}:v${promptVersion}`
  const hit = pinCache.get(cacheKey)
  if (hit != null) return hit

  const base = url.replace(/\/+$/, '')
  const apiKey = process.env.PROMPTLEDGER_API_KEY
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
  }
  const signal = AbortSignal.timeout(PIN_TIMEOUT_MS)

  try {
    // Reuse the workflow's ACTIVE deployment when it already pins this
    // version (cache misses stay idempotent — no duplicate rows).
    const listRes = await fetch(
      `${base}/api/deployments?workflow=${encodeURIComponent(name)}`,
      { headers, signal }
    )
    if (!listRes.ok) throw new Error(`list HTTP ${listRes.status}`)
    const list = (await listRes.json()) as DeploymentSummary[]
    const active = Array.isArray(list)
      ? list.find(
          (d) =>
            d.status === 'active' &&
            (d.items || []).some(
              (it) => it.prompt_name === name && it.prompt_version === promptVersion
            )
        )
      : null
    if (active) {
      pinCache.set(cacheKey, active.id)
      return active.id
    }
    // New version combo: create the deployment (supersedes the previous).
    const createRes = await fetch(`${base}/api/deployments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        workflow_name: name,
        items: [{ prompt_name: name, prompt_version: promptVersion }],
        note: 'auto-pin: served version snapshot',
      }),
      signal,
    })
    if (!createRes.ok) throw new Error(`create HTTP ${createRes.status}`)
    const dep = (await createRes.json()) as { id: number }
    pinCache.set(cacheKey, dep.id)
    return dep.id
  } catch (e) {
    console.error(`[runtrace] deployment pin failed (continuing without): ${String(e)}`)
    return null
  }
}

export function traceAiRun(trace: RunTrace): void {
  const url = process.env.PROMPTLEDGER_URL
  if (!url) return // unconfigured: committed prompts still work, tracing is simply off

  ensureDeploymentId(trace.name, trace.promptVersion).then((deploymentId) => {
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
      deployment_id: deploymentId ?? null,
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
  })
}
