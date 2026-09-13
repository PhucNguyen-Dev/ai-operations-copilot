import type { SupabaseClient } from '@supabase/supabase-js'
import { cacheGet, cacheKey, cacheSet } from '@/lib/ai/cache'
import { gatewayConfigured, gatewayGenerate } from '@/lib/gateway-client'
import { TOOL_SCHEMAS } from '@/lib/ai/json-schemas'

// =============================================================
// R-02 — THE one AI-call convention. Every Gemini feature in this app
// (current and future) goes through this module: JSON mode, truncation
// detection, retry with backoff, per-tool schema validation, uniform
// error normalization, and generation logging. No feature may fetch()
// Gemini directly.
// n8n's pipeline keeps its own node-level equivalent (same policy:
// JSON mode, retry transient only, schema gate before persist).
// =============================================================

const DEFAULT_MODEL = 'gemini-3.5-flash-lite'
const TIMEOUT_MS = 30_000
const DEFAULT_MAX_ATTEMPTS = 3
const BACKOFF_MS = 2_000

export type AiErrorCode =
  | 'AI_NOT_CONFIGURED' // server has no GEMINI_API_KEY — permanent
  | 'AI_CONFIG' // bad key / retired model (401, 400, 404) — permanent, needs admin
  | 'AI_UNREACHABLE' // network error, 429, 5xx — transient
  | 'AI_BAD_OUTPUT' // empty / malformed / truncated response
  | 'AI_SCHEMA_MISMATCH' // parsed but failed the tool's validator — permanent

export type AiError = {
  code: AiErrorCode
  /** Client-safe message (no infrastructure detail — R-03). */
  message: string
  retryable: boolean
}

export type AiUsage = { promptTokens: number | null; completionTokens: number | null }

export type AiResult<T> =
  | { ok: true; data: T; model: string; durationMs: number; cached?: boolean; usage?: AiUsage | null }
  | { ok: false; error: AiError; durationMs: number }

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: string[] }

/** Client-safe phrasing per code — infrastructure detail stays in server logs. */
const CLIENT_MESSAGES: Record<AiErrorCode, string> = {
  AI_NOT_CONFIGURED: 'AI is not configured on the server (missing GEMINI_API_KEY).',
  AI_CONFIG: 'The AI service is misconfigured (bad key or retired model) — contact the admin.',
  AI_UNREACHABLE: 'The AI service is unreachable or busy — try again in a moment.',
  AI_BAD_OUTPUT: 'The AI returned an unusable response — try again.',
  AI_SCHEMA_MISMATCH: 'The AI returned an unexpected response format — try again.',
}

function clientSafe(error: AiError): AiError {
  return { ...error, message: CLIENT_MESSAGES[error.code] }
}

// -------------------------------------------------------------
// Pure helpers (exported for unit tests — no network, no env)
// -------------------------------------------------------------

/** A response is truncated when it does not end with a JSON terminator. */
export function isTruncated(text: string): boolean {
  const t = text.trim()
  return t.length > 0 && !t.endsWith('}') && !t.endsWith(']')
}

/** 429 and 5xx are transient; 400/401/403/404 are permanent config errors. */
export function classifyHttpStatus(status: number): { code: AiErrorCode; retryable: boolean } {
  if (status === 429 || status >= 500) return { code: 'AI_UNREACHABLE', retryable: true }
  if (status === 400 || status === 401 || status === 403 || status === 404) {
    return { code: 'AI_CONFIG', retryable: false }
  }
  return { code: 'AI_UNREACHABLE', retryable: false }
}

/** Gemini generateContent response -> joined text of all candidate parts. */
export function extractText(response: unknown): string {
  const r = response as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  return (r?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
}

// -------------------------------------------------------------
// Core call
// -------------------------------------------------------------

export type GenerateJsonOptions<T> = {
  /** Tool id for logs, e.g. 'F-020'. */
  tool: string
  system: string
  user: string
  /** Per-tool schema gate — mirrors the n8n "Schema check" node. */
  validate: (parsed: unknown) => ValidationResult<T>
  /** Total attempts (first try + retries). Default 3. */
  maxAttempts?: number
  temperature?: number
  maxOutputTokens?: number
}

/**
 * Call Gemini in JSON mode and return a validated, normalized result.
 * Never throws — every failure is an `ok: false` result whose `message`
 * is safe to show to a user. Full detail goes to server logs.
 */
// Health-endpoint observability (A3): last generation's latency so
// "is AI smooth right now?" is answerable with one curl to /api/health.
let lastGeneration: { tool: string; ok: boolean; durationMs: number; cached: boolean; at: string } | null = null
export function getLastGeneration() {
  return lastGeneration
}

export async function generateJSON<T>(opts: GenerateJsonOptions<T>): Promise<AiResult<T>> {
  const startedAt = Date.now()
  const fail = (error: AiError): AiResult<T> => {
    lastGeneration = { tool: opts.tool, ok: false, durationMs: Date.now() - startedAt, cached: false, at: new Date().toISOString() }
    return { ok: false, error: clientSafe(error), durationMs: Date.now() - startedAt }
  }

  // --- AI Gateway dispatch (platform service #1): when configured, the
  // Gateway owns routing/retries/metering; the local validator still runs
  // as the final gate inside gatewayGenerate. Static switch, no runtime
  // auto-failover (deliberate — see lib/gateway-client.ts). ---
  if (gatewayConfigured()) {
    const result = await gatewayGenerate({ ...opts, schema: TOOL_SCHEMAS[opts.tool] })
    lastGeneration = {
      tool: opts.tool,
      ok: result.ok,
      durationMs: result.durationMs,
      cached: result.ok && result.cached === true,
      at: new Date().toISOString(),
    }
    return result
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return fail({ code: 'AI_NOT_CONFIGURED', message: 'missing key', retryable: false })

  const model = process.env.AI_MODEL || DEFAULT_MODEL

  // --- response cache: identical repeat calls skip the network entirely
  // (free-tier per-model daily quota is the real constraint) ---
  const key = cacheKey({
    tool: opts.tool,
    model,
    system: opts.system,
    user: opts.user,
    temperature: opts.temperature,
    maxOutputTokens: opts.maxOutputTokens,
  })
  const hit = await cacheGet(key)
  if (hit.hit) {
    const durationMs = Date.now() - startedAt
    lastGeneration = { tool: opts.tool, ok: true, durationMs, cached: true, at: new Date().toISOString() }
    return {
      ok: true,
      data: hit.value as T,
      model,
      durationMs,
      cached: true,
    }
  }

  const maxAttempts = Math.max(1, opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: 'user', parts: [{ text: opts.user }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.maxOutputTokens !== undefined ? { maxOutputTokens: opts.maxOutputTokens } : {}),
    },
  })

  let lastError: AiError = { code: 'AI_BAD_OUTPUT', message: 'no attempts made', retryable: false }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // --- transient? wait, then retry ---
    if (attempt > 1) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS * (attempt - 1)))
    }

    let response: Response
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }
      )
    } catch (e) {
      // network error / timeout — transient
      lastError = { code: 'AI_UNREACHABLE', message: String(e), retryable: true }
      continue
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300)
      const cls = classifyHttpStatus(response.status)
      console.error(`[ai:${opts.tool}] HTTP ${response.status} on attempt ${attempt}: ${detail}`)
      lastError = { ...cls, message: `Gemini HTTP ${response.status}` }
      if (!cls.retryable) break
      continue
    }

    const json = (await response.json().catch(() => null)) as unknown
    const text = extractText(json)

    if (!text.trim()) {
      // Empty candidates (e.g. safety block) — same prompt rarely changes it.
      lastError = { code: 'AI_BAD_OUTPUT', message: 'empty response', retryable: false }
      break
    }

    if (isTruncated(text)) {
      // Cut-off JSON — the same prompt with one more attempt may complete.
      lastError = { code: 'AI_BAD_OUTPUT', message: 'truncated response', retryable: true }
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      // Well-terminated but not parseable — permanent garbage.
      lastError = { code: 'AI_BAD_OUTPUT', message: 'unparseable JSON', retryable: false }
      break
    }

    const result = opts.validate(parsed)
    if (!result.ok) {
      // Schema mismatch is permanent — retrying would return the same garbage
      // (same policy as the n8n Schema-check node).
      console.error(`[ai:${opts.tool}] schema mismatch on attempt ${attempt}: ${result.errors.join('; ')}`)
      lastError = { code: 'AI_SCHEMA_MISMATCH', message: result.errors.join('; '), retryable: false }
      break
    }

    const modelVersion = (json as { modelVersion?: string })?.modelVersion ?? model
    const usageMeta = (json as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } })
      ?.usageMetadata
    const usage: AiUsage | null = usageMeta
      ? {
          promptTokens: typeof usageMeta.promptTokenCount === 'number' ? usageMeta.promptTokenCount : null,
          completionTokens: typeof usageMeta.candidatesTokenCount === 'number' ? usageMeta.candidatesTokenCount : null,
        }
      : null
    const result2 = {
      ok: true as const,
      data: result.data,
      model: modelVersion.replace(/^models\//, ''),
      durationMs: Date.now() - startedAt,
      usage,
    }
    lastGeneration = { tool: opts.tool, ok: true, durationMs: result2.durationMs, cached: false, at: new Date().toISOString() }
    await cacheSet(key, result2.data)
    return result2
  }

  return fail(lastError)
}

// -------------------------------------------------------------
// Agent loop turn (Phase 9). Function-calling mode: the model picks
// among REGISTERED tool declarations; the agent runtime owns every
// execution decision. Deliberately NOT routed through the AI Gateway
// (it speaks JSON-mode only) and never cached (the conversation
// changes every turn) — same conventions otherwise: classification,
// retry transient only, uniform error normalization.
// -------------------------------------------------------------

export type GeminiFunctionCall = { name: string; args: Record<string, unknown> }

export type AgentTurnOptions = {
  /** Log/trace identity, e.g. 'agent:admissions-followup'. */
  tool: string
  system: string
  /** Full conversation so far (user/model turns with functionCall/functionResponse parts). */
  contents: unknown[]
  declarations: { name: string; description: string; parameters: object }[]
  temperature?: number
}

export type AgentTurnAiResult =
  | {
      ok: true
      calls: GeminiFunctionCall[]
      /**
       * Requestable raw parts of the model's turn (functionCall parts
       * plus plain text parts; thought-only parts excluded). These can
       * carry provider fields like thought_signature that MUST be
       * echoed back when the conversation is replayed — the runtime
       * persists the FULL turn parts and replays them verbatim, never
       * rebuilding model turns from name+args alone (signatures are
       * sometimes attached to sibling parts, not the functionCall).
       */
      turnParts: Record<string, unknown>[]
      text: string | null
      model: string
      durationMs: number
      usage: AiUsage | null
    }
  | { ok: false; error: AiError; durationMs: number }

/** Extract functionCall parts from a generateContent response. */
export function extractFunctionCalls(response: unknown): GeminiFunctionCall[] {
  const r = response as {
    candidates?: { content?: { parts?: { functionCall?: { name?: string; args?: Record<string, unknown> } }[] } }[]
  }
  const parts = r?.candidates?.[0]?.content?.parts ?? []
  return parts
    .filter((p) => p.functionCall && typeof p.functionCall.name === 'string')
    .map((p) => ({ name: p.functionCall!.name as string, args: p.functionCall!.args ?? {} }))
}

export async function generateAgentTurn(opts: AgentTurnOptions): Promise<AgentTurnAiResult> {
  const startedAt = Date.now()
  const fail = (error: AiError): AgentTurnAiResult => ({
    ok: false,
    error: clientSafe(error),
    durationMs: Date.now() - startedAt,
  })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return fail({ code: 'AI_NOT_CONFIGURED', message: 'missing key', retryable: false })
  const model = process.env.AI_MODEL || DEFAULT_MODEL

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: opts.contents,
    tools: [{ functionDeclarations: opts.declarations }],
    generationConfig: { temperature: opts.temperature ?? 0 },
  })

  // Loop turns are expensive; retry transient failures once, then stop.
  const maxAttempts = 2
  let lastError: AiError = { code: 'AI_BAD_OUTPUT', message: 'no attempts made', retryable: false }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, BACKOFF_MS))

    let response: Response
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }
      )
    } catch (e) {
      lastError = { code: 'AI_UNREACHABLE', message: String(e), retryable: true }
      continue
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300)
      const cls = classifyHttpStatus(response.status)
      console.error(`[ai:${opts.tool}] turn HTTP ${response.status} on attempt ${attempt}: ${detail}`)
      lastError = { ...cls, message: `Gemini HTTP ${response.status}` }
      if (!cls.retryable) break
      continue
    }

    const json = (await response.json().catch(() => null)) as unknown
    const rawParts = (
      (json as { candidates?: { content?: { parts?: Record<string, unknown>[] } }[] })?.candidates?.[0]?.content
        ?.parts ?? []
    ) as Record<string, unknown>[]
    // Requestable = has a functionCall, or is plain text (thought-only
    // parts must not be sent back in request history).
    const turnParts = rawParts.filter(
      (p) =>
        p &&
        typeof p === 'object' &&
        ((p as { functionCall?: unknown }).functionCall ||
          (typeof (p as { text?: unknown }).text === 'string' && !(p as { thought?: unknown }).thought))
    )
    const calls = extractFunctionCalls(json)
    const text = extractText(json)

    if (calls.length === 0 && !text?.trim()) {
      lastError = { code: 'AI_BAD_OUTPUT', message: 'empty response', retryable: false }
      break
    }

    const modelVersion = ((json as { modelVersion?: string })?.modelVersion ?? model).replace(/^models\//, '')
    const usageMeta = (
      json as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }
    )?.usageMetadata
    const usage: AiUsage | null = usageMeta
      ? {
          promptTokens: typeof usageMeta.promptTokenCount === 'number' ? usageMeta.promptTokenCount : null,
          completionTokens: typeof usageMeta.candidatesTokenCount === 'number' ? usageMeta.candidatesTokenCount : null,
        }
      : null
    return {
      ok: true,
      calls,
      turnParts,
      text: text?.trim() ? text : null,
      model: modelVersion,
      durationMs: Date.now() - startedAt,
      usage,
    }
  }

  return fail(lastError)
}

// -------------------------------------------------------------
// Embeddings (Phase 9 Milestone B — governed RAG). Same convention as
// every AI call in this app: this is the only module that talks to the
// provider, failures are normalized AiResults, transient errors retry
// once. Not cached (embedding lookups are cheap and queries differ).
// -------------------------------------------------------------

export const EMBEDDING_DIMENSIONS = 768

export type EmbeddingResult =
  | { ok: true; embedding: number[]; model: string; durationMs: number }
  | { ok: false; error: AiError; durationMs: number }

/** Embed one text (query or chunk) for vector retrieval. */
export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  const startedAt = Date.now()
  const fail = (error: AiError): EmbeddingResult => ({
    ok: false,
    error: clientSafe(error),
    durationMs: Date.now() - startedAt,
  })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return fail({ code: 'AI_NOT_CONFIGURED', message: 'missing key', retryable: false })
  // gemini-embedding-001 natively emits 3072 dims; outputDimensionality
  // truncates to the 768 the knowledge_chunks column was created with.
  const model = process.env.EMBEDDING_MODEL || 'gemini-embedding-001'

  // The embedding API rejects very long inputs; chunks are ~800 chars,
  // queries are short — this cap is only a safety net.
  const input = text.slice(0, 8_000)

  let lastError: AiError = { code: 'AI_BAD_OUTPUT', message: 'no attempts made', retryable: false }
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, BACKOFF_MS))
    let response: Response
    try {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${model}`,
          content: { parts: [{ text: input }] },
          outputDimensionality: EMBEDDING_DIMENSIONS,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (e) {
      lastError = { code: 'AI_UNREACHABLE', message: String(e), retryable: true }
      continue
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300)
      const cls = classifyHttpStatus(response.status)
      console.error(`[ai:embedding] HTTP ${response.status} on attempt ${attempt}: ${detail}`)
      lastError = { ...cls, message: `Gemini HTTP ${response.status}` }
      if (!cls.retryable) break
      continue
    }
    const json = (await response.json().catch(() => null)) as {
      embedding?: { values?: unknown }
    } | null
    const values = json?.embedding?.values
    if (!Array.isArray(values) || values.length === 0 || !values.every((v) => typeof v === 'number')) {
      lastError = { code: 'AI_BAD_OUTPUT', message: 'malformed embedding', retryable: false }
      break
    }
    return { ok: true, embedding: values as number[], model, durationMs: Date.now() - startedAt }
  }
  return fail(lastError)
}

// -------------------------------------------------------------
// Generation logging (H5 — ai_generations). Best-effort: a logging
// failure must never break the tool response.
// -------------------------------------------------------------

export type GenerationLog = {
  /** Row owner — required by the table (not null) and by RLS
   * (auth.uid() = user_id). Must be the calling user's id, passed
   * explicitly from the session. */
  userId: string
  tool: string
  department: 'marketing' | 'academic' | 'operations'
  model: string
  status: 'success' | 'failed'
  errorCode?: string | null
  durationMs?: number | null
  /** Sanitized tool inputs — keep it small, no long free text. */
  inputSummary?: Record<string, unknown> | null
}

/**
 * Persist one generation row as the calling user (RLS: insert own).
 * Call this from the tool route with the user's server client.
 */
export async function logGeneration(
  client: SupabaseClient,
  log: GenerationLog
): Promise<void> {
  const { error } = await client.from('ai_generations').insert({
    user_id: log.userId,
    tool_id: log.tool,
    department: log.department,
    model: log.model,
    status: log.status,
    error_code: log.errorCode ?? null,
    duration_ms: log.durationMs ?? null,
    input_summary: log.inputSummary ?? null,
  })
  if (error) console.error(`[ai:${log.tool}] generation log failed: ${error.message}`)
}
