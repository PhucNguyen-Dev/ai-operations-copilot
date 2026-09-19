import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AgentApprovalRecord,
  AgentRunRecord,
  AgentStateStore,
  AgentStepRecord,
} from '@/lib/agent/types'

// =============================================================
// 9.3 — Durable agent run state. Production store: the service-role
// client (RLS does not apply — run/step/approval rows are written by
// trusted runtime code only, so users cannot tamper with their own
// audit trail; reads are RLS-guarded user-client queries in the API
// routes).
//
// Every loop transition goes through here — the runtime holds no
// authoritative state in memory, so runs survive restarts and can be
// reconstructed (feedback_snapshot) to resume exactly where they left
// off. A memory implementation of this interface (tests) proves the
// runtime depends only on the contract.
// =============================================================

function nowIso(): string {
  return new Date().toISOString()
}

export class SupabaseAgentStateStore implements AgentStateStore {
  constructor(private readonly admin: SupabaseClient) {}

  async createRun(
    run: Omit<AgentRunRecord, 'id' | 'started_at' | 'updated_at'>
  ): Promise<AgentRunRecord> {
    const { data, error } = await this.admin
      .from('agent_runs')
      .insert({
        agent_id: run.agent_id,
        user_id: run.user_id,
        user_role: run.user_role,
        client_id: run.client_id ?? null,
        session_id: run.session_id ?? null,
        goal: run.goal,
        status: run.status,
        current_state: run.current_state,
        step_count: run.step_count,
        max_steps: run.max_steps,
        tokens_in: run.tokens_in,
        tokens_out: run.tokens_out,
      })
      .select('*')
      .single()
    if (error) throw new Error(`agent run insert failed: ${error.message}`)
    return data as AgentRunRecord
  }
  async updateRun(runId: string, patch: Partial<Omit<AgentRunRecord, 'id'>>): Promise<void> {
    const { error } = await this.admin
      .from('agent_runs')
      .update({ ...patch, updated_at: nowIso() })
      .eq('id', runId)
    if (error) throw new Error(`agent run update failed: ${error.message}`)
  }

  async getRun(runId: string): Promise<AgentRunRecord | null> {
    const { data, error } = await this.admin.from('agent_runs').select('*').eq('id', runId).limit(1)
    if (error) throw new Error(`agent run load failed: ${error.message}`)
    return ((data ?? [])[0] as AgentRunRecord | undefined) ?? null
  }

  async recordStep(step: Omit<AgentStepRecord, 'id' | 'step_index' | 'started_at'>): Promise<AgentStepRecord> {
    // Durable step ordering: max(step_index) + 1 per run. The runtime is
    // single-loop-per-run, so read-modify-write is sufficient here.
    const { data: last } = await this.admin
      .from('agent_run_steps')
      .select('step_index')
      .eq('run_id', step.run_id)
      .order('step_index', { ascending: false })
      .limit(1)
    const nextIndex = ((last ?? [])[0]?.step_index as number | undefined) ?? -1

    const { data, error } = await this.admin
      .from('agent_run_steps')
      .insert({
        run_id: step.run_id,
        kind: step.kind,
        step_index: nextIndex + 1,
        tool_name: step.tool_name,
        tool_version: step.tool_version,
        permission_decision: step.permission_decision,
        status: step.status,
        approval_id: step.approval_id,
        args_snapshot: step.args_snapshot,
        result_summary: step.result_summary,
        feedback_snapshot: step.feedback_snapshot,
        error: step.error,
        latency_ms: step.latency_ms,
        tokens_in: step.tokens_in,
        tokens_out: step.tokens_out,
        finished_at: step.finished_at,
      })
      .select('*')
      .single()
    if (error) throw new Error(`agent step insert failed: ${error.message}`)
    return data as AgentStepRecord
  }

  async listSteps(runId: string): Promise<AgentStepRecord[]> {
    const { data, error } = await this.admin
      .from('agent_run_steps')
      .select('*')
      .eq('run_id', runId)
      .order('step_index', { ascending: true })
    if (error) throw new Error(`agent steps load failed: ${error.message}`)
    return (data ?? []) as AgentStepRecord[]
  }

  async createApproval(
    a: Pick<AgentApprovalRecord, 'run_id' | 'step_id' | 'tool_name' | 'args_snapshot' | 'requested_by'>
  ): Promise<AgentApprovalRecord> {
    const { data, error } = await this.admin
      .from('agent_approvals')
      .insert({
        run_id: a.run_id,
        step_id: a.step_id,
        tool_name: a.tool_name,
        args_snapshot: a.args_snapshot,
        requested_by: a.requested_by,
      })
      .select('*')
      .single()
    if (error) throw new Error(`approval insert failed: ${error.message}`)
    return data as AgentApprovalRecord
  }

  async getApproval(id: string): Promise<AgentApprovalRecord | null> {
    const { data, error } = await this.admin.from('agent_approvals').select('*').eq('id', id).limit(1)
    if (error) throw new Error(`approval load failed: ${error.message}`)
    return ((data ?? [])[0] as AgentApprovalRecord | undefined) ?? null
  }

  async decideApproval(
    id: string,
    decision: 'approved' | 'rejected',
    decidedBy: string,
    note: string | null
  ): Promise<AgentApprovalRecord | null> {
    const { data: existing, error: loadError } = await this.admin
      .from('agent_approvals')
      .select('id, status, requested_by')
      .eq('id', id)
      .limit(1)
    if (loadError) throw new Error(`approval decision failed: ${loadError.message}`)
    const current = (existing ?? [])[0] as Pick<AgentApprovalRecord, 'id' | 'status' | 'requested_by'> | undefined
    if (!current) return null
    if (current.requested_by === decidedBy) {
      throw new Error('SELF_APPROVAL_FORBIDDEN: the requesting employee cannot decide their own approval')
    }

    // The status='pending' filter makes double-decisions impossible:
    // the second caller gets zero rows back, not the first one's result.
    const { data, error } = await this.admin
      .from('agent_approvals')
      .update({ status: decision, decided_by: decidedBy, decision_note: note, decided_at: nowIso() })
      .eq('id', id)
      .eq('status', 'pending')
      .neq('requested_by', decidedBy)
      .select('*')
    if (error) throw new Error(`approval decision failed: ${error.message}`)
    return ((data ?? [])[0] as AgentApprovalRecord | undefined) ?? null
  }

  async claimApproval(runId: string, approvalId: string): Promise<AgentRunRecord | null> {
    const { data, error } = await this.admin.rpc('claim_agent_approval', { p_run_id: runId, p_approval_id: approvalId })
    if (error) throw new Error(`approval claim failed: ${error.message}`)
    return data as AgentRunRecord | null
  }

  async requesterRead(runId: string, operation: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await this.admin.rpc('agent_requester_read', { p_run_id: runId, p_operation: operation, p_args: args })
    if (error) throw new Error(`REQUESTER_AUTHORIZATION_FAILED: ${error.message}`)
    return data
  }

  async isKillSwitchOn(): Promise<boolean> {
    const { data, error } = await this.admin
      .from('agent_runtime_config')
      .select('kill_switch')
      .eq('id', 1)
      .limit(1)
    if (error) throw new Error(`kill switch load failed: ${error.message}`)
    return ((data ?? [])[0]?.kill_switch as boolean | undefined) ?? false
  }

  async isToolEnabled(toolName: string): Promise<boolean> {
    const { data, error } = await this.admin
      .from('agent_tool_config')
      .select('enabled')
      .eq('tool_name', toolName)
      .limit(1)
    if (error) throw new Error(`tool config load failed: ${error.message}`)
    const row = (data ?? [])[0] as { enabled: boolean } | undefined
    return row ? row.enabled : true // absent row = enabled
  }
}
