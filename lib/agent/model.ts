import { generateAgentTurn } from '@/lib/gemini'
import type { FunctionDeclaration } from '@/lib/agent/types'

// =============================================================
// Model adapter for the agent loop (9.2). The runtime never talks to
// a provider directly — it depends on this interface, which makes the
// whole governed loop unit-testable with a scripted fake model and
// swappable if the provider changes.
// =============================================================

/** One conversation entry, provider-agnostic in shape (Gemini v1beta REST). */
export type AgentContent = {
  role: 'user' | 'model'
  parts: Record<string, unknown>[]
}

export type AgentFunctionCall = { name: string; args: Record<string, unknown> }

export type AgentTurnRequest = {
  system: string
  contents: AgentContent[]
  declarations: FunctionDeclaration[]
}

export type AgentTurnOutput =
  | {
      ok: true
      calls: AgentFunctionCall[]
      /** Raw requestable parts of the WHOLE model turn (preserves thought_signature etc.). */
      turnParts: Record<string, unknown>[]
      text: string | null
      model: string
      durationMs: number
      usage: { tokensIn: number | null; tokensOut: number | null } | null
    }
  | { ok: false; error: string; retryable: boolean; durationMs: number }

export interface AgentModel {
  turn(req: AgentTurnRequest): Promise<AgentTurnOutput>
}

/** Production adapter — one Gemini function-calling turn. */
export const geminiAgentModel: AgentModel = {
  async turn(req: AgentTurnRequest): Promise<AgentTurnOutput> {
    const result = await generateAgentTurn({
      tool: 'agent-runtime',
      system: req.system,
      contents: req.contents,
      declarations: req.declarations,
    })
    if (!result.ok) {
      return { ok: false, error: `${result.error.code}: ${result.error.message}`, retryable: result.error.retryable, durationMs: result.durationMs }
    }
    return {
      ok: true,
      calls: result.calls,
      turnParts: result.turnParts,
      text: result.text,
      model: result.model,
      durationMs: result.durationMs,
      usage: result.usage
        ? { tokensIn: result.usage.promptTokens, tokensOut: result.usage.completionTokens }
        : null,
    }
  },
}

// -------------------------------------------------------------
// Conversation building helpers. The runtime persists the FULL raw
// parts of each model turn (thought_signature included) plus the
// exact function responses in each step's feedback_snapshot, so a
// resumed run rebuilds the conversation byte-for-byte faithfully.
// NOTE: function responses ride on role 'user' in the v1beta REST
// (roles are user|model only); this is the documented pattern.
// -------------------------------------------------------------

export type FeedbackPayload = {
  /** Raw requestable parts of the model turn these steps belong to. */
  modelParts?: Record<string, unknown>[]
  /** Identifies the model turn — steps of one turn share it. */
  turnId?: string
  /** The functionResponse payload the model received (or will receive). */
  response: unknown
}

export function userTextPart(text: string): AgentContent {
  return { role: 'user', parts: [{ text }] }
}

export function modelPartsContent(parts: Record<string, unknown>[]): AgentContent {
  return { role: 'model', parts }
}

export function functionResponsePart(toolName: string, response: unknown): AgentContent {
  return {
    role: 'user',
    parts: [{ functionResponse: { name: toolName, response: response as Record<string, unknown> } }],
  }
}
