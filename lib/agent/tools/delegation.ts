import type { ToolDefinition, ToolOutcome } from '@/lib/agent/types'
import type { ValidationResult } from '@/lib/gemini'

// =============================================================
// 9.12 — Multi-agent handoff, implemented as a registered tool. The
// tool itself is declarative: the runtime INJECTS the delegate
// capability (ToolContext.delegate) which starts a child run with
// parent/child correlation and returns its final outcome.
//
// Bounded by construction:
//   * allowedAgents lists only the parent agents permitted to delegate;
//   * child agents (e.g. reporting-agent) do NOT carry this tool, so
//     recursive delegation cannot happen;
//   * the child runs under the SAME requester principal and the same
//     guardrails/kill switch, fully traced as a correlated run.
// =============================================================

export type DelegateArgs = { agent_id: string; task: string }
export type DelegateResult = { child_run_id: string; status: string; outcome: string | null }

export const delegateToAgentTool: ToolDefinition<DelegateArgs, DelegateResult> = {
  name: 'delegate_to_agent',
  version: '1.0.0',
  description:
    'Hand a bounded sub-task to a specialized agent and wait for its final outcome. Use for tasks outside your own capability (e.g. a reporting/analysis request). The delegated run is fully traced and correlated with this one.',
  riskLevel: 'write',
  allowedAgents: ['admissions-followup'],
  allowedRoles: ['admissions', 'admin'],
  parameters: {
    type: 'object',
    properties: {
      agent_id: { type: 'string', enum: ['reporting-agent'], description: 'The specialist agent to delegate to' },
      task: { type: 'string', description: 'The bounded sub-task for the specialist agent, 10-1000 chars' },
    },
    required: ['agent_id', 'task'],
  },
  validateInput(args) {
    const a = (args ?? {}) as Partial<DelegateArgs>
    if (a.agent_id !== 'reporting-agent') {
      return { ok: false, errors: ['agent_id must be "reporting-agent" — no other delegation is authorized'] }
    }
    const task = a.task
    if (typeof task !== 'string' || task.trim().length < 10 || task.length > 1000) {
      return { ok: false, errors: ['task is required (10-1000 chars)'] }
    }
    return { ok: true, data: { agent_id: a.agent_id as string, task: task.trim() } }
  },
  validateOutput: (v) => {
    const r = (v ?? {}) as Record<string, unknown>
    if (typeof r.child_run_id !== 'string' || typeof r.status !== 'string') {
      return { ok: false, errors: ['result must include child_run_id and status'] }
    }
    return { ok: true, data: r as DelegateResult }
  },
  timeoutMs: 150_000,
  idempotency: 'non_idempotent',
  async execute(ctx, args): Promise<ToolOutcome<DelegateResult>> {
    if (!ctx.delegate) {
      return { ok: false, error: 'DELEGATION_UNAVAILABLE: this runtime does not expose delegation', retryable: false }
    }
    const child = await ctx.delegate({ agentId: args.agent_id, task: args.task })
    if (!child.ok) {
      return {
        ok: false,
        error: `DELEGATION_FAILED: child run ${child.childRunId} ended as ${child.status}${child.error ? ` (${child.error})` : ''}`,
        retryable: false,
      }
    }
    return {
      ok: true,
      result: { child_run_id: child.childRunId, status: child.status, outcome: child.outcome },
    }
  },
}

export const DELEGATION_TOOLS = [delegateToAgentTool]
