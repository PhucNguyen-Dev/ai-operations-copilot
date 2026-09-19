import type { ToolDefinition, ToolOutcome } from '@/lib/agent/types'
import { isNonEmptyStr, loadVisibleLead } from '@/lib/agent/tools/crm'

// =============================================================
// Control tools — the only two ways an agent run ENDS successfully
// (9.2 loop: complete / escalate). Completion is a tool call, not free
// text, so every termination is explicit, validated and traceable.
// The runtime intercepts these before execute() and applies the run
// transition itself; escalate_to_human still performs its own DB write
// (the escalation notification).
// =============================================================

const NAME = 'admissions-followup'

// -------------------------------------------------------------
// finish
// -------------------------------------------------------------

export type FinishArgs = { summary: string; verification: string }

export const finishTool: ToolDefinition<FinishArgs, Record<string, never>> = {
  name: 'finish',
  version: '1.0.0',
  description:
    'End the run because the goal is achieved. summary = what you did, factually. verification = how you confirmed the outcome (tool results you observed). Call exactly once, only when no further action is needed.',
  riskLevel: 'read',
  allowedAgents: [NAME, 'external-lead-support', 'reporting-agent'],
  allowedRoles: ['admissions', 'marketing', 'teacher', 'operations', 'external'],
  parameters: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Factual summary of what was done, 1-2000 chars' },
      verification: { type: 'string', description: 'How the outcome was verified, 1-500 chars' },
    },
    required: ['summary', 'verification'],
  },
  validateInput(args) {
    const a = (args ?? {}) as Partial<FinishArgs>
    if (!isNonEmptyStr(a.summary, 2000) || !isNonEmptyStr(a.verification, 500)) {
      return { ok: false, errors: ['summary (1-2000 chars) and verification (1-500 chars) are required'] }
    }
    return { ok: true, data: { summary: a.summary as string, verification: a.verification as string } }
  },
  validateOutput: () => ({ ok: true, data: {} }),
  timeoutMs: 1_000,
  idempotency: 'idempotent',
  control: 'finish',
  async execute(): Promise<ToolOutcome<Record<string, never>>> {
    // Never invoked — the runtime intercepts control tools.
    return { ok: true, result: {} }
  },
}

// -------------------------------------------------------------
// escalate_to_human
// -------------------------------------------------------------

export type EscalateArgs = { reason: string; lead_id: string | null }
export type EscalateResult = { notified_user_id: string }

export const escalateTool: ToolDefinition<EscalateArgs, EscalateResult> = {
  name: 'escalate_to_human',
  version: '1.0.0',
  description:
    'Hand the situation to a human and end the run. Use when you are blocked, an action was denied and no alternative is authorized, or the situation needs human judgment. The lead\'s counselor is notified (or you, the requester, when no lead is involved).',
  riskLevel: 'write',
  allowedAgents: [NAME, 'external-lead-support', 'reporting-agent'],
  allowedRoles: ['admissions', 'marketing', 'teacher', 'operations', 'external'],
  parameters: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'Why human help is needed, 1-500 chars' },
      lead_id: { type: 'string', description: 'Related lead id (uuid), when there is one' },
    },
    required: ['reason'],
  },
  validateInput(args) {
    const a = (args ?? {}) as Partial<EscalateArgs>
    if (!isNonEmptyStr(a.reason, 500)) return { ok: false, errors: ['reason is required (1-500 chars)'] }
    return { ok: true, data: { reason: a.reason, lead_id: a.lead_id ?? null } }
  },
  validateOutput: (v) => {
    const r = (v ?? {}) as Record<string, unknown>
    if (typeof r.notified_user_id !== 'string') return { ok: false, errors: ['result must include notified_user_id'] }
    return { ok: true, data: r as EscalateResult }
  },
  timeoutMs: 10_000,
  idempotency: 'non_idempotent',
  control: 'escalate',
  async checkResource(ctx, args) {
    if (!args.lead_id) return { ok: true }
    const visible = await loadVisibleLead(ctx, args.lead_id)
    return visible.ok ? { ok: true } : { ok: false, reason: visible.error }
  },
  async execute(ctx, args): Promise<ToolOutcome<EscalateResult>> {
    let recipient = ctx.userId
    if (args.lead_id) {
      const visible = await loadVisibleLead(ctx, args.lead_id)
      if (!visible.ok) return { ok: false, error: visible.error, retryable: false }
      recipient = (visible.lead.assigned_counselor_id as string | null) ?? ctx.userId
    }
    const { error } = await ctx.adminClient
      .from('notifications')
      .insert({
        recipient_id: recipient,
        lead_id: args.lead_id,
        type: 'system',
        title: `[${ctx.agentId}] agent escalation`,
        body: args.reason,
      })
      .select('id')
      .single()
    if (error) return { ok: false, error: `escalation notification failed: ${error.message}`, retryable: false }
    return { ok: true, result: { notified_user_id: recipient } }
  },
}

export const CONTROL_TOOLS = [finishTool, escalateTool]
