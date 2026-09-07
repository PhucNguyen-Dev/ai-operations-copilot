import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getApiUser } from '@/lib/auth-server'
import { canUseTool, AI_TOOLS } from '@/lib/roles'
import { rateLimiter } from '@/lib/rate-limit'
import { generateJSON, logGeneration, type GenerateJsonOptions } from '@/lib/gemini'

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
  }) => Omit<GenerateJsonOptions<T>, 'tool'> & { inputSummary: Record<string, unknown> }
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
  const limit = rateLimiter.check(`ai:${userId}`, 10, 60_000)
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
  const { inputSummary, ...aiOptions } = spec
  const result = await generateJSON<T>({ ...aiOptions, tool: toolId })

  // --- generation log (best-effort; success and failure both recorded) ---
  const supabase = await createClient()
  await logGeneration(supabase, {
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
