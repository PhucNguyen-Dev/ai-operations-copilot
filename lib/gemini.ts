import type { SupabaseClient } from '@supabase/supabase-js'

// =============================================================
// R-02 — THE one AI-call convention. Every Gemini feature in this app
// (current and future) goes through this module: JSON mode, truncation
// detection, retry with backoff, per-tool schema validation, uniform
// error normalization, and generation logging. No feature may fetch()
// Gemini directly.
// n8n's pipeline keeps its own node-level equivalent (same policy:
// JSON mode, retry transient only, schema gate before persist).
// =============================================================

const DEFAULT_MODEL = 'gemini-2.0-flash'
const TIMEOUT_MS = 30_000
const DEFAULT_MAX_ATTEMPTS = 3
const BACKOFF_MS = 2_000

export type AiErrorCode =
  | 'AI_NOT_CONFIGURED' // server has no GEMINI_API_KEY — permanent
  | 'AI_UNREACHABLE' // network error, 429, 5xx — transient
  | 'AI_BAD_OUTPUT' // empty / malformed / truncated response
  | 'AI_SCHEMA_MISMATCH' // parsed but failed the tool's validator — permanent

export type AiError = {
  code: AiErrorCode
  /** Client-safe message (no infrastructure detail — R-03). */
  message: string
  retryable: boolean
}

export type AiResult<T> =
  | { ok: true; data: T; model: string; durationMs: number }
  | { ok: false; error: AiError; durationMs: number }

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: string[] }

/** Client-safe phrasing per code — infrastructure detail stays in server logs. */
const CLIENT_MESSAGES: Record<AiErrorCode, string> = {
  AI_NOT_CONFIGURED: 'AI is not configured on the server (missing GEMINI_API_KEY).',
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

/** 429 and 5xx are transient; other HTTP statuses are permanent failures. */
export function classifyHttpStatus(status: number): { code: AiErrorCode; retryable: boolean } {
  if (status === 429 || status >= 500) return { code: 'AI_UNREACHABLE', retryable: true }
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
export async function generateJSON<T>(opts: GenerateJsonOptions<T>): Promise<AiResult<T>> {
  const startedAt = Date.now()
  const fail = (error: AiError): AiResult<T> => ({ ok: false, error: clientSafe(error), durationMs: Date.now() - startedAt })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return fail({ code: 'AI_NOT_CONFIGURED', message: 'missing key', retryable: false })

  const model = process.env.AI_MODEL || DEFAULT_MODEL
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
    return {
      ok: true,
      data: result.data,
      model: modelVersion.replace(/^models\//, ''),
      durationMs: Date.now() - startedAt,
    }
  }

  return fail(lastError)
}

// -------------------------------------------------------------
// Generation logging (H5 — ai_generations). Best-effort: a logging
// failure must never break the tool response.
// -------------------------------------------------------------

export type GenerationLog = {
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
