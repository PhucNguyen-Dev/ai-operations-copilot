import type {
  AgentApprovalRecord,
  AgentRunRecord,
  AgentStateStore,
  AgentStepRecord,
  ToolContext,
  ToolDefinition,
} from '@/lib/agent/types'
import type { AgentContent, AgentFunctionCall, AgentModel, AgentTurnRequest } from '@/lib/agent/model'
import type { AgentDefinition } from '@/lib/agent/agents'
import type { SupabaseClient } from '@supabase/supabase-js'

// =============================================================
// Unit-test harness for the agent runtime: a memory AgentStateStore
// (the runtime depends only on the store contract, never on Supabase),
// a scripted fake AgentModel, and pure test tools — so the governed
// loop is exercised deterministically with zero network.
// =============================================================

export class MemoryAgentStore implements AgentStateStore {
  runs = new Map<string, AgentRunRecord>()
  steps: AgentStepRecord[] = []
  approvals = new Map<string, AgentApprovalRecord>()
  toolFlags = new Map<string, boolean>()
  killSwitch = false

  async createRun(run: Omit<AgentRunRecord, 'id' | 'started_at' | 'updated_at'>): Promise<AgentRunRecord> {
    const now = new Date().toISOString()
    const record: AgentRunRecord = { ...run, id: crypto.randomUUID(), started_at: now, updated_at: now }
    this.runs.set(record.id, record)
    return { ...record }
  }

  async updateRun(runId: string, patch: Partial<Omit<AgentRunRecord, 'id'>>): Promise<void> {
    const run = this.runs.get(runId)
    if (!run) throw new Error(`no run ${runId}`)
    this.runs.set(runId, { ...run, ...patch, updated_at: new Date().toISOString() })
  }

  async getRun(runId: string): Promise<AgentRunRecord | null> {
    const run = this.runs.get(runId)
    return run ? { ...run } : null
  }

  async recordStep(step: Omit<AgentStepRecord, 'id' | 'step_index' | 'started_at'>): Promise<AgentStepRecord> {
    const index = this.steps.filter((s) => s.run_id === step.run_id).length
    const record: AgentStepRecord = {
      ...step,
      id: crypto.randomUUID(),
      step_index: index,
      started_at: new Date().toISOString(),
    }
    this.steps.push(record)
    return { ...record }
  }

  async listSteps(runId: string): Promise<AgentStepRecord[]> {
    return this.steps.filter((s) => s.run_id === runId).map((s) => ({ ...s }))
  }

  async createApproval(
    a: Pick<AgentApprovalRecord, 'run_id' | 'step_id' | 'tool_name' | 'args_snapshot' | 'requested_by'>
  ): Promise<AgentApprovalRecord> {
    const record: AgentApprovalRecord = {
      ...a,
      id: crypto.randomUUID(),
      status: 'pending',
      decided_by: null,
      decision_note: null,
      requested_at: new Date().toISOString(),
      decided_at: null,
    }
    this.approvals.set(record.id, record)
    return { ...record }
  }

  async getApproval(id: string): Promise<AgentApprovalRecord | null> {
    const a = this.approvals.get(id)
    return a ? { ...a } : null
  }

  async decideApproval(
    id: string,
    decision: 'approved' | 'rejected',
    decidedBy: string,
    note: string | null
  ): Promise<AgentApprovalRecord | null> {
    const a = this.approvals.get(id)
    if (!a || a.status !== 'pending') return null
    const updated: AgentApprovalRecord = {
      ...a,
      status: decision,
      decided_by: decidedBy,
      decision_note: note,
      decided_at: new Date().toISOString(),
    }
    this.approvals.set(id, updated)
    return { ...updated }
  }

  async isKillSwitchOn(): Promise<boolean> {
    return this.killSwitch
  }

  async isToolEnabled(toolName: string): Promise<boolean> {
    return this.toolFlags.get(toolName) ?? true
  }
}

/** Scripted model: pops one turn per call; records every request for assertions. */
export class FakeAgentModel implements AgentModel {
  requests: AgentTurnRequest[] = []
  private script: Array<{ calls?: AgentFunctionCall[]; text?: string; usage?: { tokensIn: number | null; tokensOut: number | null } }>
  private index = 0

  constructor(script: Array<{ calls?: AgentFunctionCall[]; text?: string }>) {
    this.script = script.map((t) => ({ ...t, usage: { tokensIn: 100, tokensOut: 10 } }))
  }

  async turn(req: AgentTurnRequest) {
    // Snapshot the request — the runtime reuses one `contents` array
    // across turns, so storing the reference would show final state only.
    this.requests.push(JSON.parse(JSON.stringify(req)) as AgentTurnRequest)
    if (this.index >= this.script.length) throw new Error('fake model script exhausted')
    const turn = this.script[this.index++]
    const calls = turn.calls ?? []
    return {
      ok: true as const,
      calls,
      turnParts: calls.map((c) => ({ functionCall: { name: c.name, args: c.args } })),
      text: turn.text ?? null,
      model: 'fake-model',
      durationMs: 1,
      usage: turn.usage ?? null,
    }
  }
}

// -------------------------------------------------------------
// Pure test tools (no DB)
// -------------------------------------------------------------

const NULL_CLIENT = null as unknown as SupabaseClient

export function testContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    runId: 'run-1',
    agentId: 'test-agent',
    userId: 'user-1',
    userRole: 'admissions',
    userClient: NULL_CLIENT,
    adminClient: NULL_CLIENT,
    dryRunEmail: true,
    ...overrides,
  }
}

export const echoTool: ToolDefinition<{ message: string }, { echo: string }> = {
  name: 'echo',
  version: '1.0.0',
  description: 'Returns the message it was given.',
  riskLevel: 'read',
  allowedAgents: ['test-agent', 'test-specialist'],
  allowedRoles: ['admissions'],
  parameters: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
  validateInput(args) {
    const m = (args as { message?: unknown })?.message
    return typeof m === 'string' && m.length > 0
      ? { ok: true, data: { message: m } }
      : { ok: false, errors: ['message is required'] }
  },
  validateOutput(result) {
    const r = result as { echo?: unknown }
    return typeof r?.echo === 'string' ? { ok: true, data: r as { echo: string } } : { ok: false, errors: ['echo missing'] }
  },
  timeoutMs: 1_000,
  idempotency: 'idempotent',
  async execute(_ctx, args) {
    return { ok: true, result: { echo: args.message } }
  },
}

export const boomTool: ToolDefinition<Record<string, never>, Record<string, never>> = {
  name: 'boom',
  version: '1.0.0',
  description: 'Always fails permanently.',
  riskLevel: 'write',
  allowedAgents: ['test-agent', 'test-specialist'],
  allowedRoles: ['admissions'],
  parameters: { type: 'object', properties: {} },
  validateInput: () => ({ ok: true, data: {} }),
  validateOutput: () => ({ ok: true, data: {} }),
  timeoutMs: 1_000,
  idempotency: 'non_idempotent',
  async execute() {
    return { ok: false, error: 'BOOM: permanent tool failure', retryable: false }
  },
}

export const draftTool: ToolDefinition<{ text: string }, { draft_id: string }> = {
  name: 'make_draft',
  version: '1.0.0',
  description: 'High-risk test tool that requires approval outside dry-run mode.',
  riskLevel: 'external_side_effect',
  allowedAgents: ['test-agent', 'test-specialist'],
  allowedRoles: ['admissions'],
  parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  validateInput(args) {
    const t = (args as { text?: unknown })?.text
    return typeof t === 'string' && t.length > 0 ? { ok: true, data: { text: t } } : { ok: false, errors: ['text required'] }
  },
  validateOutput(result) {
    const r = result as { draft_id?: unknown }
    return typeof r?.draft_id === 'string' ? { ok: true, data: r as { draft_id: string } } : { ok: false, errors: ['draft_id missing'] }
  },
  timeoutMs: 1_000,
  idempotency: 'non_idempotent',
  requiresApproval: (_args, ctx) => !ctx.dryRunEmail,
  async execute(_ctx, args) {
    return { ok: true, result: { draft_id: `draft-${args.text}` } }
  },
}

export const testEscalateTool: ToolDefinition<{ reason: string }, { notified_user_id: string }> = {
  name: 'escalate_to_human',
  version: '1.0.0',
  description: 'Escalation control tool (pure test double).',
  riskLevel: 'write',
  allowedAgents: ['test-agent', 'test-specialist'],
  allowedRoles: ['admissions'],
  parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
  validateInput(args) {
    const r = (args as { reason?: unknown })?.reason
    return typeof r === 'string' && r.length > 0 ? { ok: true, data: { reason: r } } : { ok: false, errors: ['reason required'] }
  },
  validateOutput(result) {
    const r = result as { notified_user_id?: unknown }
    return typeof r?.notified_user_id === 'string'
      ? { ok: true, data: r as { notified_user_id: string } }
      : { ok: false, errors: ['notified_user_id missing'] }
  },
  timeoutMs: 1_000,
  idempotency: 'non_idempotent',
  control: 'escalate',
  async execute() {
    return { ok: true, result: { notified_user_id: 'user-1' } }
  },
}

export const testFinishTool: ToolDefinition<{ summary: string; verification: string }, Record<string, never>> = {
  name: 'finish',
  version: '1.0.0',
  description: 'Finish control tool (pure test double, scoped to the test agent).',
  riskLevel: 'read',
  allowedAgents: ['test-agent', 'test-specialist'],
  allowedRoles: ['admissions'],
  parameters: {
    type: 'object',
    properties: { summary: { type: 'string' }, verification: { type: 'string' } },
    required: ['summary', 'verification'],
  },
  validateInput(args) {
    const a = (args ?? {}) as { summary?: unknown; verification?: unknown }
    return typeof a.summary === 'string' && typeof a.verification === 'string'
      ? { ok: true, data: a as { summary: string; verification: string } }
      : { ok: false, errors: ['summary and verification required'] }
  },
  validateOutput: () => ({ ok: true, data: {} }),
  timeoutMs: 1_000,
  idempotency: 'idempotent',
  control: 'finish',
  async execute() {
    return { ok: true, result: {} }
  },
}

export const testDelegateTool: ToolDefinition<{ agent_id: string; task: string }, { child_run_id: string; status: string; outcome: string | null }> = {
  name: 'delegate_to_agent',
  version: '1.0.0',
  description: 'Delegation control (pure test double backed by ctx.delegate).',
  riskLevel: 'write',
  allowedAgents: ['test-agent', 'test-specialist'],
  allowedRoles: ['admissions'],
  parameters: { type: 'object', properties: { agent_id: { type: 'string' }, task: { type: 'string' } }, required: ['agent_id', 'task'] },
  validateInput(args) {
    const a = (args ?? {}) as { agent_id?: unknown; task?: unknown }
    if (a.agent_id !== 'test-specialist' || typeof a.task !== 'string' || a.task.length < 10) {
      return { ok: false, errors: ['agent_id must be test-specialist and task 10-1000 chars'] }
    }
    return { ok: true, data: { agent_id: a.agent_id as string, task: a.task as string } }
  },
  validateOutput(result) {
    const r = result as { child_run_id?: unknown; status?: unknown }
    return typeof r?.child_run_id === 'string' && typeof r?.status === 'string'
      ? { ok: true, data: r as { child_run_id: string; status: string; outcome: string | null } }
      : { ok: false, errors: ['child_run_id and status required'] }
  },
  timeoutMs: 1_000,
  idempotency: 'non_idempotent',
  async execute(ctx, args) {
    if (!ctx.delegate) return { ok: false, error: 'DELEGATION_UNAVAILABLE', retryable: false }
    const child = await ctx.delegate({ agentId: args.agent_id, task: args.task })
    if (!child.ok) return { ok: false, error: `DELEGATION_FAILED: ${child.status}`, retryable: false }
    return { ok: true, result: { child_run_id: child.childRunId, status: child.status, outcome: child.outcome } }
  },
}

export const TEST_TOOLS: Record<string, ToolDefinition<never, never>> = Object.fromEntries(
  [echoTool, boomTool, draftTool, testEscalateTool, testFinishTool, testDelegateTool].map((t) => [t.name, t as unknown as ToolDefinition<never, never>])
)

export const TEST_AGENT: AgentDefinition = {
  id: 'test-agent',
  displayName: 'Test Agent',
  description: 'Unit-test agent',
  allowedRoles: ['admissions'],
  allowedTools: ['echo', 'boom', 'make_draft', 'escalate_to_human', 'finish', 'delegate_to_agent'],
  systemPrompt: 'test system prompt',
}

/** The specialist child agent — deliberately has NO delegation tool. */
export const TEST_SPECIALIST: AgentDefinition = {
  id: 'test-specialist',
  displayName: 'Test Specialist',
  description: 'Unit-test child agent',
  allowedRoles: [],
  allowedTools: ['echo', 'finish'],
  systemPrompt: 'test specialist prompt',
}

export const TEST_AGENTS: Record<string, AgentDefinition> = {
  'test-agent': TEST_AGENT,
  'test-specialist': TEST_SPECIALIST,
}
