import type { AgentRunRecord } from '@/lib/agent/types'

// =============================================================
// 9.6 — Guardrails: bounded autonomy. Pure functions evaluated at
// every loop iteration; the runtime treats a guard failure as a
// terminal condition (run failed, reason recorded in the trace).
// =============================================================

export type GuardrailLimits = {
  /** Hard cap on tool-call attempts (executed OR attempted) per run. */
  maxSteps: number
  /** Wall-clock budget for the whole run. */
  runTimeoutMs: number
  /** Total model tokens (in + out) the run may spend. */
  maxTokensPerRun: number
  /** Max tool calls the model may request in ONE turn — overflow is skipped and traced. */
  maxToolCallsPerTurn: number
}

export const DEFAULT_GUARDRAIL_LIMITS: GuardrailLimits = {
  maxSteps: 12,
  runTimeoutMs: 120_000,
  maxTokensPerRun: 60_000,
  maxToolCallsPerTurn: 3,
}

export type GuardFailure = { ok: false; reason: 'step_limit' | 'token_budget' | 'timeout'; message: string }
export type GuardResult = { ok: true } | GuardFailure

/**
 * Checked before every model turn. steps/tokens are compared against
 * the DURABLE run row — the loop can be killed or crash and the next
 * process re-evaluates from the same numbers.
 */
export function evaluateRunGuards(
  run: Pick<AgentRunRecord, 'step_count' | 'tokens_in' | 'tokens_out' | 'max_steps' | 'started_at'>,
  limits: GuardrailLimits,
  now: number = Date.now()
): GuardResult {
  if (run.step_count >= run.max_steps) {
    return { ok: false, reason: 'step_limit', message: `step limit reached (${run.max_steps})` }
  }
  const elapsed = now - new Date(run.started_at).getTime()
  if (elapsed > limits.runTimeoutMs) {
    return { ok: false, reason: 'timeout', message: `run timeout after ${Math.round(elapsed / 1000)}s` }
  }
  const tokens = run.tokens_in + run.tokens_out
  if (tokens > limits.maxTokensPerRun) {
    return { ok: false, reason: 'token_budget', message: `token budget exceeded (${tokens} > ${limits.maxTokensPerRun})` }
  }
  return { ok: true }
}

/** Split a model turn's requested calls into honored + skipped (traced, never silently dropped). */
export function clampTurnCalls<T>(calls: T[], limits: GuardrailLimits): { honored: T[]; skipped: number } {
  if (calls.length <= limits.maxToolCallsPerTurn) return { honored: calls, skipped: 0 }
  return { honored: calls.slice(0, limits.maxToolCallsPerTurn), skipped: calls.length - limits.maxToolCallsPerTurn }
}

/** The functionResponse the model receives for a call it made but the platform refused to honor. */
export function refusalFeedback(message: string): { result: { ok: false; refused: true; reason: string } } {
  return { result: { ok: false, refused: true, reason: message } }
}
