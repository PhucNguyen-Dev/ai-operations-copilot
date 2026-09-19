import type { SupabaseClient } from '@supabase/supabase-js'
import type { Role } from '@/lib/roles'
import type { ValidationResult } from '@/lib/gemini'

// =============================================================
// Phase 9 — Agentic Core shared types.
// Boundary the whole phase hangs on: the model proposes actions, the
// platform authorizes and executes them. Every type here is shaped so
// that a tool call that never passed the permission engine has no code
// path to a side effect.
// =============================================================

export type RiskLevel = 'read' | 'write' | 'external_side_effect' | 'destructive'

export type AgentRunStatus =
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'escalated'
  | 'cancelled'
  | 'clarification_required'

export type AgentStepStatus =
  | 'success'
  | 'failed'
  | 'denied'
  | 'approval_required'
  | 'rejected'
  | 'skipped'

export type PermissionDecision = 'allowed' | 'denied' | 'approval_required'

/** Every tool execution returns a structured result — no raw throws across the boundary. */
export type ToolOutcome<TResult> =
  | { ok: true; result: TResult }
  | { ok: false; error: string; retryable: boolean }

export type ToolContext = {
  runId: string
  agentId: string
  /** The employee whose request spawned this run (the principal, not the agent). */
  userId: string
  userRole: Role
  /** RLS-scoped client — reads see exactly what the employee sees. */
  userClient: SupabaseClient
  /** Service-role client — governed writes only, after explicit checks. */
  adminClient: SupabaseClient
  /** When false, the prepare_email tool requires human approval (real-send mode). */
  dryRunEmail: boolean
  requesterRead?: (operation: string, args: Record<string, unknown>) => Promise<unknown>
  /**
   * Runtime-injected delegation capability (9.12) — only present for
   * agents permitted to delegate; the runtime enforces the child
   * allowlist, the parent/child correlation and the depth bound.
   */
  delegate?: (input: { agentId: string; task: string }) => Promise<{
    ok: boolean
    childRunId: string
    status: string
    outcome: string | null
    error: string | null
  }>
}

/**
 * A registered capability. The registry (lib/agent/registry.ts) is the
 * single source of truth; nothing may execute that is not defined here.
 */
export type ToolDefinition<TArgs = Record<string, unknown>, TResult = unknown> = {
  name: string
  /** Recorded on every execution trace — behavior changes bump the version. */
  version: string
  /** Shown to the model as the function description. */
  description: string
  riskLevel: RiskLevel
  /** Agent identities allowed to invoke this tool (9.5 — agent is a principal). */
  allowedAgents: string[]
  /** Invoking-employee roles allowed to spawn runs that use it ('admin' always passes). */
  allowedRoles: Role[]
  /** Gemini function-declaration JSON Schema for the arguments. */
  parameters: object
  validateInput: (args: unknown) => ValidationResult<TArgs>
  validateOutput: (result: unknown) => ValidationResult<TResult>
  timeoutMs: number
  idempotency: 'idempotent' | 'non_idempotent'
  /**
   * Only consulted for external_side_effect/destructive tools — write and
   * read tools never require approval (9.6 approval protocol).
   */
  requiresApproval?: (args: TArgs, ctx: ToolContext) => boolean
  /**
   * Resource-level scope check against the REQUESTER's RLS client,
   * run before an approval suspension is created (9.5). Without it, a
   * requester could park an out-of-scope resource behind an approval
   * and the resumed execution would run under the approver's session.
   */
  checkResource?: (ctx: ToolContext, args: TArgs) => Promise<{ ok: true } | { ok: false; reason: string }>
  /**
   * Control tools terminate the run (finish/escalate). The runtime
   * intercepts them before execute() and applies the run transition.
   */
  control?: 'finish' | 'escalate' | 'clarify'
  execute: (ctx: ToolContext, args: TArgs) => Promise<ToolOutcome<TResult>>
}

/** Model-facing function declaration (subset the API needs). */
export type FunctionDeclaration = {
  name: string
  description: string
  parameters: object
}

/** One persisted action attempt — the unit of the execution trace (9.4). */
export type AgentRunRecord = {
  id: string
  agent_id: string
  user_id: string
  /** Invoking employee's role at run start — resumes re-use this principal. */
  user_role: string
  /** External API client that started the run (null for employee runs). */
  client_id: string | null
  session_id: string | null
  goal: string
  status: AgentRunStatus
  current_state: Record<string, unknown>
  step_count: number
  max_steps: number
  tokens_in: number
  tokens_out: number
  final_outcome: string | null
  error: string | null
  started_at: string
  updated_at: string
  completed_at: string | null
  approval_wait_ms?: number
  approval_wait_started_at?: string | null
  pending_approval_id?: string | null
}

export type AgentStepRecord = {
  id: string
  run_id: string
  kind: 'tool_call' | 'system'
  step_index: number
  tool_name: string | null
  tool_version: string | null
  permission_decision: PermissionDecision | null
  status: AgentStepStatus
  approval_id: string | null
  args_snapshot: unknown
  result_summary: unknown
  /** Exact functionResponse payload the model saw — drives faithful resume. */
  feedback_snapshot: unknown
  error: string | null
  latency_ms: number | null
  tokens_in: number
  tokens_out: number
  started_at: string
  finished_at: string | null
}

export type AgentApprovalRecord = {
  id: string
  run_id: string
  step_id: string | null
  tool_name: string
  args_snapshot: unknown
  status: 'pending' | 'approved' | 'rejected'
  requested_by: string
  decided_by: string | null
  decision_note: string | null
  requested_at: string
  decided_at: string | null
  execution_claimed_at?: string | null
}

/**
 * Durable state boundary (9.3): the runtime holds no important state in
 * memory — every meaningful transition goes through this store, so a
 * run survives a process restart and can be reconstructed for resume.
 */
export interface AgentStateStore {
  createRun(run: Omit<AgentRunRecord, 'id' | 'started_at' | 'updated_at'>): Promise<AgentRunRecord>
  updateRun(runId: string, patch: Partial<Omit<AgentRunRecord, 'id'>>): Promise<void>
  getRun(runId: string): Promise<AgentRunRecord | null>

  /** step_index is assigned by the store (max+1 per run) to keep ordering durable. */
  recordStep(step: Omit<AgentStepRecord, 'id' | 'step_index' | 'started_at'>): Promise<AgentStepRecord>
  listSteps(runId: string): Promise<AgentStepRecord[]>

  createApproval(
    a: Pick<AgentApprovalRecord, 'run_id' | 'step_id' | 'tool_name' | 'args_snapshot' | 'requested_by'>
  ): Promise<AgentApprovalRecord>
  getApproval(id: string): Promise<AgentApprovalRecord | null>
  claimApproval(runId: string, approvalId: string): Promise<AgentRunRecord | null>
  requesterRead(runId: string, operation: string, args: Record<string, unknown>): Promise<unknown>
  decideApproval(id: string, decision: 'approved' | 'rejected', decidedBy: string, note: string | null): Promise<AgentApprovalRecord | null>

  /** Global kill switch (9.6) — checked at loop entry and before every step. */
  isKillSwitchOn(): Promise<boolean>
  /** Absent row = enabled. */
  isToolEnabled(toolName: string): Promise<boolean>

  /**
   * Durable session context (memory): the compact derived facts for one
   * chat session, written by the runtime after a run completes and read
   * at the start of follow-up runs. userId must match the row — the
   * user check is re-asserted here even though the store runs service
   * role (defense in depth; the route already validated ownership).
   */
  getSessionContext(sessionId: string, userId: string): Promise<import('./session-context').SessionContext | null>
  putSessionContext(sessionId: string, userId: string, context: import('./session-context').SessionContext): Promise<void>
}
