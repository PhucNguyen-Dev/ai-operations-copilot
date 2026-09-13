import type { Role } from '@/lib/roles'
import type { AgentDefinition } from '@/lib/agent/agents'
import type { PermissionDecision, ToolContext, ToolDefinition } from '@/lib/agent/types'

// =============================================================
// 9.5 — Permission-aware execution. Evaluated server-side BEFORE any
// tool execution, on the axes: user identity (role of the invoking
// employee) × agent identity × tool × policy. The resource axis
// (which lead) is enforced inside the tools against the employee's
// RLS scope — see loadVisibleLead.
//
// The model can never self-grant: there is no code path from a model
// response to a permission decision. Decisions are pure and recorded
// verbatim in the execution trace.
// =============================================================

export type PermissionInput = {
  agent: AgentDefinition
  tool: ToolDefinition<never, never> | null
  /** Invoking employee's role ('admin' passes all role gates). */
  userRole: Role
  /** Live enabled flag from the registry store (absent row = enabled). */
  toolEnabled: boolean
  /** Model-supplied arguments (needed to consult requiresApproval). */
  args: unknown
  /** Execution context used only by requiresApproval policies. */
  ctx: ToolContext
}

export type PermissionDecisionResult = {
  decision: PermissionDecision
  /** Model-safe reason — also what the execution trace records. */
  reason: string
}

export function evaluateToolPermission(input: PermissionInput): PermissionDecisionResult {
  const { agent, tool, userRole, toolEnabled, args, ctx } = input

  if (!tool) return { decision: 'denied', reason: 'UNKNOWN_TOOL: not registered' }
  if (!toolEnabled) return { decision: 'denied', reason: `TOOL_DISABLED: ${tool.name} is disabled platform-wide` }

  if (!agent.allowedTools.includes(tool.name)) {
    return { decision: 'denied', reason: `AGENT_NOT_AUTHORIZED: ${agent.id} may not use ${tool.name}` }
  }
  if (!tool.allowedAgents.includes(agent.id)) {
    return { decision: 'denied', reason: `TOOL_NOT_FOR_AGENT: ${tool.name} is not exposed to ${agent.id}` }
  }
  if (userRole !== 'admin' && !tool.allowedRoles.includes(userRole)) {
    return { decision: 'denied', reason: `ROLE_NOT_AUTHORIZED: role ${userRole} may not use ${tool.name}` }
  }

  // 9.6: high-risk tools must pass through the approval protocol when
  // their policy says so. Approval itself is verified at execution time
  // (the run must be resumed on an approved decision).
  if (
    (tool.riskLevel === 'external_side_effect' || tool.riskLevel === 'destructive') &&
    tool.requiresApproval?.(args as never, ctx)
  ) {
    return { decision: 'approval_required', reason: `APPROVAL_REQUIRED: ${tool.name} is ${tool.riskLevel}` }
  }

  return { decision: 'allowed', reason: 'allowed by policy' }
}
