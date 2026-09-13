import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getApiUser } from '@/lib/auth-server'
import { canUseTool, AI_TOOLS } from '@/lib/roles'
import { rateLimiter } from '@/lib/rate-limit'
import { generateJSON, logGeneration, type GenerateJsonOptions } from '@/lib/gemini'
import { traceAiRun } from '@/lib/runtrace'

/** Run-trace identity supplied by each route (which registry prompt this call used). */
export type RunTraceInfo = {
  /** Registry prompt name, e.g. 'report-generator'. */
  name: string
  /** Version served by getSystemPrompt (null when on the committed fallback). */
  promptVersion: number | null
  /** 'live' | 'committed' — which source served the text. */
  promptSource: string | null
}

/**
 * Shared handler for every Phase 6 AI tool route. Encapsulates the
 * non-AI concerns once: session, role gate (server-enforced), rate limit,
 * generation logging — so each tool route only supplies its validator,
 * prompt and input parsing.
 */
export async function runAiTool<T>(
  request: NextRequest,
  toolId: string,
  build: (input: {
    userId: string
    /** Parsed JSON body of the request. */
    body: Record<string, unknown>
  }) => Omit<GenerateJsonOptions<T>, 'tool'> & {
    inputSummary: Record<string, unknown>
    /** Optional PromptLedger run-trace identity (omitted = no trace). */
    trace?: RunTraceInfo
  }
) {
  const startedAt = Date.now()

  // --- session + role gate (server-enforced, UI gating is cosmetic) ---
  const session = await getApiUser(request)
  if ('response' in session) return session.response
  const { userId, role } = session

  if (!canUseTool(role, toolId)) {
    return NextResponse.json(
      { error: `Your role (${role}) is not allowed to use ${toolId} (${AI_TOOLS[toolId]?.department ?? 'unknown'}).` },
      { status: 403 }
    )
  }

  // --- rate limit (R-05): every AI call is a paid Gemini request ---
  const limit = await rateLimiter.check(`ai:${userId}`, 10, 60_000)
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Too many generations — try again in ${limit.retryAfterSec}s.` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
    )
  }

  // --- input ---
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const spec = build({ userId, body })
  const { inputSummary, trace, ...aiOptions } = spec
  const result = await generateJSON<T>({ ...aiOptions, tool: toolId })

  // --- PromptLedger run trace (fire-and-forget; records the exact prompt
  // version served, model, latency, outcome — full input/output capture).
  // Never throws, never blocks the response. ---
  traceAiRun({
    app: 'ops-copilot',
    name: trace?.name ?? toolId,
    promptVersion: trace?.promptVersion ?? null,
    promptSource: trace?.promptSource ?? null,
    model: result.ok ? result.model : null,
    input: aiOptions.user,
    output: result.ok ? JSON.stringify(result.data) : '',
    latencyMs: result.ok ? result.durationMs : Date.now() - startedAt,
    ok: result.ok,
    error: result.ok ? null : `${result.error.code}: ${result.error.message}`,
    tokensIn: result.ok ? (result.usage?.promptTokens ?? null) : null,
    tokensOut: result.ok ? (result.usage?.completionTokens ?? null) : null,
  })

  // --- generation log (best-effort; success and failure both recorded) ---
  const supabase = await createClient()
    await logGeneration(supabase, {
      userId,
      tool: toolId,
      department: AI_TOOLS[toolId].department,
      model: result.ok ? result.model : 'n/a',
      status: result.ok ? 'success' : 'failed',
      errorCode: result.ok ? null : result.error.code,
      durationMs: result.ok ? result.durationMs : Date.now() - startedAt,
      inputSummary: spec.inputSummary,
    })

  if (!result.ok) {
    // error.message is already client-safe (H1 convention).
    return NextResponse.json(
      { error: result.error.message, code: result.error.code },
      { status: 502 }
    )
  }

  return NextResponse.json({ data: result.data, model: result.model, durationMs: result.durationMs, cached: result.cached === true })
}
