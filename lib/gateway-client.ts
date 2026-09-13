import type { AiError, AiResult, GenerateJsonOptions } from '@/lib/gemini'
import { cacheGet, cacheKey, cacheSet } from '@/lib/ai/cache'

// =============================================================
// AI Gateway consumer adapter (platform service #1).
// When AI_GATEWAY_URL + AI_GATEWAY_KEY are set, generateJSON() dispatches
// here instead of calling Gemini directly. All Copilot conventions hold:
//   - schema gate runs TWICE: the Gateway enforces the consumer-declared
//     JSON Schema (metering truth), and the local validator re-checks the
//     result (defense in depth — e.g. quiz answer_index cross-field rule).
//   - every failure is an ok:false result with a client-safe message.
//     Never throws.
// Static switch only — no runtime auto-failover to direct (deliberate:
// a Gateway outage surfaces as a clean retryable AI_UNREACHABLE instead
// of silently double-spending direct calls). See docs RISKS.
// =============================================================

const TIMEOUT_MS = 35_000
const DEFAULT_PROMPT_VERSION = 'v1'

/** Error-code mapping: Gateway envelope -> Copilot AiError codes. */
export const CODE_MAP: Record<string, { code: AiError['code']; retryable: boolean }> = {
  UNAUTHORIZED: { code: 'AI_CONFIG', retryable: false },
  VALIDATION: { code: 'AI_CONFIG', retryable: false },
  RATE_LIMITED: { code: 'AI_UNREACHABLE', retryable: true },
  AI_NOT_CONFIGURED: { code: 'AI_NOT_CONFIGURED', retryable: false },
  AI_CONFIG: { code: 'AI_CONFIG', retryable: false },
  AI_UNREACHABLE: { code: 'AI_UNREACHABLE', retryable: true },
  AI_BAD_OUTPUT: { code: 'AI_BAD_OUTPUT', retryable: false },
  AI_SCHEMA_MISMATCH: { code: 'AI_SCHEMA_MISMATCH', retryable: false },
  INTERNAL: { code: 'AI_UNREACHABLE', retryable: false },
}

export function gatewayConfigured(): boolean {
  return Boolean(process.env.AI_GATEWAY_URL && process.env.AI_GATEWAY_KEY)
}

/**
 * Call the AI Gateway's /v1/generate and return a normalized AiResult.
 * Sends the tool's JSON Schema (if provided) for Gateway-side enforcement
 * and runs the local validator on the returned data as the second gate.
 */
export async function gatewayGenerate<T>(
  opts: GenerateJsonOptions<T> & { schema?: object; promptVersion?: string }
): Promise<AiResult<T>> {
  const startedAt = Date.now()
  const fail = (error: AiError): AiResult<T> => ({
    ok: false,
    error: clientSafeError(error),
    durationMs: Date.now() - startedAt,
  })

  const url = process.env.AI_GATEWAY_URL
  const apiKey = process.env.AI_GATEWAY_KEY
  if (!url || !apiKey) {
    return fail({ code: 'AI_NOT_CONFIGURED', message: 'missing gateway env', retryable: false })
  }

  // --- Copilot-side response cache still applies (saves the network hop
  // for identical repeat calls, same as the direct path) ---
  const cacheId = `gateway:${process.env.AI_MODEL || 'default'}`
  const key = cacheKey({
    tool: opts.tool,
    model: cacheId,
    system: opts.system,
    user: opts.user,
    temperature: opts.temperature,
    maxOutputTokens: opts.maxOutputTokens,
  })
  const hit = await cacheGet(key)
  if (hit.hit) {
    return {
      ok: true,
      data: hit.value as T,
      model: 'gateway',
      durationMs: Date.now() - startedAt,
      cached: true,
    }
  }

  const body = {
    tool: opts.tool,
    prompt_version: opts.promptVersion ?? DEFAULT_PROMPT_VERSION,
    system: opts.system,
    user: opts.user,
    ...(opts.schema ? { schema: opts.schema } : {}),
    ...(opts.temperature !== undefined || opts.maxOutputTokens !== undefined || opts.maxAttempts !== undefined
      ? {
          options: {
            ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
            ...(opts.maxOutputTokens !== undefined ? { max_output_tokens: opts.maxOutputTokens } : {}),
            ...(opts.maxAttempts !== undefined ? { max_attempts: opts.maxAttempts } : {}),
          },
        }
      : {}),
  }

  let response: Response
  try {
    response = await fetch(`${url.replace(/\/+$/, '')}/v1/generate`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    // network error / timeout — transient, same as the direct path
    console.error(`[gateway:${opts.tool}] network error: ${String(e)}`)
    return fail({ code: 'AI_UNREACHABLE', message: String(e), retryable: true })
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300)
    console.error(`[gateway:${opts.tool}] HTTP ${response.status}: ${detail}`)
    // Prefer the Gateway's error envelope code (it carries retry semantics);
    // fall back to HTTP-status classification.
    let errorCode: string | null = null
    let errorMessage = `gateway HTTP ${response.status}`
    try {
      const errJson = JSON.parse(detail) as { error?: { code?: string; message?: string } }
      if (errJson?.error?.code) {
        errorCode = errJson.error.code
        if (errJson.error.message) errorMessage = errJson.error.message
      }
    } catch {
      // body wasn't JSON — keep the status-based fallback below
    }
    const mapped = (errorCode && CODE_MAP[errorCode]) || {
      code: 'AI_UNREACHABLE' as const,
      retryable: response.status === 429 || response.status >= 500,
    }
    return fail({ code: mapped.code, message: errorMessage, retryable: mapped.retryable })
  }

  let json: { data?: unknown; meta?: { model?: string; cached?: boolean } } | null = null
  try {
    json = await response.json()
  } catch {
    return fail({ code: 'AI_BAD_OUTPUT', message: 'unparseable gateway response', retryable: false })
  }
  if (!json || typeof json !== 'object' || !('data' in json)) {
    return fail({ code: 'AI_BAD_OUTPUT', message: 'gateway returned no data', retryable: false })
  }

  // --- second schema gate: the local validator owns the final word ---
  const local = opts.validate(json.data)
  if (!local.ok) {
    console.error(`[gateway:${opts.tool}] local schema mismatch: ${local.errors.join('; ')}`)
    return fail({ code: 'AI_SCHEMA_MISMATCH', message: local.errors.join('; '), retryable: false })
  }

  const result: AiResult<T> = {
    ok: true,
    data: local.data,
    model: json.meta?.model ?? 'gateway',
    durationMs: Date.now() - startedAt,
    cached: json.meta?.cached === true,
  }
  await cacheSet(key, result.data)
  return result
}

/** Same phrasing table as lib/gemini.ts — keep in sync. */
const CLIENT_MESSAGES: Record<AiError['code'], string> = {
  AI_NOT_CONFIGURED: 'AI is not configured on the server (missing GEMINI_API_KEY).',
  AI_CONFIG: 'The AI service is misconfigured (bad key or retired model) — contact the admin.',
  AI_UNREACHABLE: 'The AI service is unreachable or busy — try again in a moment.',
  AI_BAD_OUTPUT: 'The AI returned an unusable response — try again.',
  AI_SCHEMA_MISMATCH: 'The AI returned an unexpected response format — try again.',
}

function clientSafeError(error: AiError): AiError {
  return { ...error, message: CLIENT_MESSAGES[error.code] ?? error.message }
}
