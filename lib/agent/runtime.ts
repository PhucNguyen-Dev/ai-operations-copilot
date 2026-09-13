import type { SupabaseClient } from '@supabase/supabase-js'
import { traceAiRun } from '@/lib/runtrace'
import { getAgent, type AgentDefinition } from '@/lib/agent/agents'
import {
  callSignature,
  clampTurnCalls,
  DEFAULT_GUARDRAIL_LIMITS,
  evaluateRunGuards,
  REPEAT_CALL_LIMIT,
  refusalFeedback,
  type GuardrailLimits,
} from '@/lib/agent/guardrails'
import {
  functionResponsePart,
  modelPartsContent,
  userTextPart,
  type AgentContent,
  type AgentModel,
  type FeedbackPayload,
} from '@/lib/agent/model'
import { evaluateToolPermission } from '@/lib/agent/permissions'
import { AGENT_TOOLS, declarationsFor, getTool } from '@/lib/agent/registry'
import type {
  AgentRunRecord,
  AgentRunStatus,
  AgentStateStore,
  ToolContext,
  ToolDefinition,
} from '@/lib/agent/types'

// =============================================================
// 9.2 — THE Agent Runtime. A genuine loop: observe → the model picks
// an authorized tool → the platform validates permission/policy/
// schema → execute → persist → re-plan → verify → complete/escalate.
//
// Non-negotiables (Phase 9 doc):
//   * Every tool call passes the permission engine BEFORE execution —
//     there is no code path from a model response to a side effect
//     that skips evaluateToolPermission.
//   * Every meaningful transition is persisted through the store: the
//     run survives a crash and can be reconstructed/replayed from
//     agent_run_steps alone. Each step's feedback_snapshot holds the
//     RAW model functionCall parts (thought_signature included) plus
//     the exact functionResponse the model received — conversation
//     rebuilds are byte-faithful.
//   * Termination is always an explicit control call (finish /
//     escalate_to_human), a guardrail stop, an irrecoverable failure,
//     or a human-approval suspension. Chain-of-thought is never
//     stored — only tool calls, results, decisions and outcomes.
// =============================================================

export type RuntimeDeps = {
  store: AgentStateStore
  model: AgentModel
  userClient: SupabaseClient
  adminClient: SupabaseClient
  limits?: Partial<GuardrailLimits>
  /** GMAIL_AGENT_DRY_RUN default true; false forces email approval. */
  dryRunEmail?: boolean
  /** Injectable registries (tests use pure tools/agents; prod uses the real ones). */
  tools?: Record<string, ToolDefinition<never, never>>
  agents?: Record<string, AgentDefinition>
}

export type AgentRunOutput = {
  runId: string
  status: AgentRunStatus
  finalOutcome: string | null
  error: string | null
  pendingApprovalId: string | null
  stepCount: number
}

/** Mutable counters for one loop invocation — persisted after every step. */
type LoopState = {
  stepCount: number
  tokensIn: number
  tokensOut: number
  lastModel: string | null
}

export async function startAgentRun(
  deps: RuntimeDeps,
  input: {
    agentId: string
    userId: string
    userRole: string
    goal: string
    clientId?: string
    /** 9.12 multi-agent handoff: set on child runs for trace correlation. */
    parentRunId?: string
  }
): Promise<AgentRunOutput> {
  const agent = getAgent(input.agentId, deps.agents)
  if (!agent) return immediateFailure(input.agentId, `unknown agent ${input.agentId}`)

  const limits: GuardrailLimits = { ...DEFAULT_GUARDRAIL_LIMITS, ...deps.limits }
  let run: AgentRunRecord
  try {
    run = await deps.store.createRun({
      agent_id: agent.id,
      user_id: input.userId,
      user_role: input.userRole,
      client_id: input.clientId ?? null,
      goal: input.goal,
      status: 'running',
      current_state: input.parentRunId ? { parent_run_id: input.parentRunId } : {},
      step_count: 0,
      max_steps: limits.maxSteps,
      tokens_in: 0,
      tokens_out: 0,
      final_outcome: null,
      error: null,
      completed_at: null,
    })
  } catch (e) {
    return immediateFailure(null, `run persistence failed: ${String(e)}`)
  }

  return driveRun(deps, agent, run, buildCtx(deps, run, input.userRole), limits)
}

/**
 * Resume a suspended run after a human decision (9.6 protocol). The
 * approval must already be decided (the decision route does that);
 * the consequence is recorded as a step, then the loop re-drives
 * entirely from persisted state, under the original requester's
 * persisted principal.
 */
export async function resumeAgentRun(
  deps: RuntimeDeps,
  input: { runId: string; approvalId: string }
): Promise<AgentRunOutput> {
  const run = await deps.store.getRun(input.runId)
  if (!run) return immediateFailure(null, `run ${input.runId} not found`)
  const agent = getAgent(run.agent_id, deps.agents)
  if (!agent) return immediateFailure(run.id, `unknown agent ${run.agent_id}`)

  const notSuspended: AgentRunOutput = {
    runId: run.id,
    status: run.status,
    finalOutcome: run.final_outcome,
    error: run.status !== 'awaiting_approval' ? `run is not awaiting approval (status: ${run.status})` : null,
    pendingApprovalId: null,
    stepCount: run.step_count,
  }
  if (run.status !== 'awaiting_approval') return notSuspended

  const approval = await deps.store.getApproval(input.approvalId)
  if (!approval || approval.run_id !== run.id || approval.status === 'pending') {
    return {
      ...notSuspended,
      error: 'approval is still pending or belongs to another run (decide it first)',
      pendingApprovalId: approval?.id ?? null,
    }
  }

  if (approval.status === 'rejected') {
    await deps.store.recordStep({
      run_id: run.id,
      kind: 'tool_call',
      tool_name: approval.tool_name,
      tool_version: getTool(approval.tool_name, deps.tools)?.version ?? null,
      permission_decision: 'approval_required',
      status: 'rejected',
      approval_id: approval.id,
      args_snapshot: approval.args_snapshot,
      result_summary: null,
      feedback_snapshot: {
        response: refusalFeedback(
          `REJECTED_BY_HUMAN: ${approval.decision_note ?? 'the requested action was not approved'}`
        ),
      },
      error: 'rejected by human approver',
      latency_ms: null,
      tokens_in: 0,
      tokens_out: 0,
      finished_at: new Date().toISOString(),
    })
    await deps.store.updateRun(run.id, { status: 'running' })
  } else {
    // Approved: execute the stored arguments now. They were validated
    // before the approval was requested — re-validate anyway, policy
    // or the registry may have changed while the run was suspended.
    // The model-call parts already live on the approval step.
    const tool = getTool(approval.tool_name, deps.tools)
    const state: LoopState = {
      stepCount: run.step_count,
      tokensIn: run.tokens_in,
      tokensOut: run.tokens_out,
      lastModel: null,
    }
    if (!tool) return failRun(deps, run, `approved tool ${approval.tool_name} is no longer registered`, state)
    const revalidated = tool.validateInput(approval.args_snapshot)
    if (!revalidated.ok) {
      return failRun(deps, run, `approved arguments no longer valid: ${revalidated.errors.join('; ')}`, state)
    }
    const ctx = buildCtx(deps, run, run.user_role)
    const executed = await executeToolCall(deps, run, tool, revalidated.data as never, ctx, state, approval.id, null, [])
    await deps.store.updateRun(run.id, { status: 'running' })
    if ('terminal' in executed) return executed.terminal
  }

  const fresh = await deps.store.getRun(run.id)
  if (!fresh) return immediateFailure(run.id, 'run disappeared during resume')
  return driveRun(deps, agent, fresh, buildCtx(deps, fresh, fresh.user_role), {
    ...DEFAULT_GUARDRAIL_LIMITS,
    ...deps.limits,
  })
}

// -------------------------------------------------------------
// The loop
// -------------------------------------------------------------

function buildCtx(deps: RuntimeDeps, run: AgentRunRecord, userRole: string): ToolContext {
  return {
    runId: run.id,
    agentId: run.agent_id,
    userId: run.user_id,
    userRole: userRole as ToolContext['userRole'],
    userClient: deps.userClient,
    adminClient: deps.adminClient,
    dryRunEmail: deps.dryRunEmail ?? process.env.GMAIL_AGENT_DRY_RUN !== 'false',
    // 9.12 — bounded delegation, injected only when this agent's
    // allowlist includes delegate_to_agent. Recursion is structurally
    // impossible: child agents do not carry the delegation tool, and
    // the child run records its parent for trace correlation.
    delegate: async (input: { agentId: string; task: string }) => {
      const child = await startAgentRun(deps, {
        agentId: input.agentId,
        userId: run.user_id,
        userRole,
        goal: `[delegation from ${run.agent_id}] ${input.task}`,
        parentRunId: run.id,
      })
      return {
        ok: child.status === 'completed' || child.status === 'escalated',
        childRunId: child.runId,
        status: child.status,
        outcome: child.finalOutcome,
        error: child.error,
      }
    },
  }
}

/** Read a persisted feedback wrapper, tolerating the pre-signature shape. */
function asFeedback(snapshot: unknown): FeedbackPayload | null {
  if (snapshot === null || typeof snapshot !== 'object') return null
  const fb = snapshot as Record<string, unknown>
  if ('response' in fb) return fb as FeedbackPayload
  // Legacy shape: the response payload stored directly.
  return { response: snapshot }
}

async function driveRun(
  deps: RuntimeDeps,
  agent: AgentDefinition,
  run: AgentRunRecord,
  ctx: ToolContext,
  limits: GuardrailLimits
): Promise<AgentRunOutput> {
  const store = deps.store
  const registry = deps.tools ?? AGENT_TOOLS
  const declarations = declarationsFor(agent.allowedTools, registry)
  const state: LoopState = {
    stepCount: run.step_count,
    tokensIn: run.tokens_in,
    tokensOut: run.tokens_out,
    lastModel: null,
  }
  let textNudges = 0
  let lastCallSignature: string | null = null
  let repeatCount = 0

  // --- reconstruct the conversation from the durable trace (9.3:
  // resume-safe). A fresh run has no steps, so both paths share this.
  // Steps are grouped by turnId: one model content (the FULL raw turn
  // parts, thought_signature included) followed by each call's
  // function response. ---
  const priorSteps = await store.listSteps(run.id)
  const contents: AgentContent[] = [userTextPart(run.goal)]
  let lastTurnId: string | null = null
  for (const step of priorSteps) {
    if (step.kind !== 'tool_call' || !step.tool_name) continue
    const fb = asFeedback(step.feedback_snapshot)
    if (!fb) continue
    if (fb.turnId) {
      if (fb.turnId !== lastTurnId) {
        contents.push(modelPartsContent(fb.modelParts ?? []))
        lastTurnId = fb.turnId
      }
    } else if (fb.modelParts?.length) {
      // Legacy per-call shape (pre-turn-grouping rows).
      contents.push(modelPartsContent(fb.modelParts))
    }
    if (fb.response != null) contents.push(functionResponsePart(step.tool_name, fb.response))
  }

  const persistProgress = (patch: Partial<AgentRunRecord>) =>
    store.updateRun(run.id, {
      step_count: state.stepCount,
      tokens_in: state.tokensIn,
      tokens_out: state.tokensOut,
      ...patch,
    })

  for (;;) {
    // --- guardrails before every turn (9.6) ---
    if (await store.isKillSwitchOn()) {
      return failRun(deps, run, 'KILL_SWITCH: agent execution is disabled platform-wide', state)
    }
    const guard = evaluateRunGuards(
      {
        step_count: state.stepCount,
        tokens_in: state.tokensIn,
        tokens_out: state.tokensOut,
        max_steps: run.max_steps,
        started_at: run.started_at,
      },
      limits
    )
    if (!guard.ok) return failRun(deps, run, `${guard.reason.toUpperCase()}: ${guard.message}`, state)

    // --- model turn: the model chooses intent and next action ONLY ---
    const turn = await deps.model.turn({ system: agent.systemPrompt, contents, declarations })
    if (!turn.ok) {
      await store.recordStep({
        run_id: run.id,
        kind: 'system',
        tool_name: null,
        tool_version: null,
        permission_decision: null,
        status: 'failed',
        approval_id: null,
        args_snapshot: null,
        result_summary: null,
        feedback_snapshot: null,
        error: turn.error,
        latency_ms: turn.durationMs,
        tokens_in: 0,
        tokens_out: 0,
        finished_at: new Date().toISOString(),
      })
      return failRun(deps, run, `MODEL_TURN_FAILED: ${turn.error}`, state)
    }
    if (turn.usage?.tokensIn) state.tokensIn += turn.usage.tokensIn
    if (turn.usage?.tokensOut) state.tokensOut += turn.usage.tokensOut
    state.lastModel = turn.model

    if (turn.calls.length === 0) {
      // Plain text instead of a tool call — nudge back to the protocol.
      if (textNudges >= 2) {
        return failRun(deps, run, 'NO_COMPLETION: model repeatedly produced text without a tool call', state)
      }
      textNudges += 1
      contents.push({ role: 'model', parts: [{ text: turn.text ?? '' }] })
      contents.push(
        userTextPart('Respond with a registered tool call. To end the run use finish (goal achieved) or escalate_to_human (blocked).')
      )
      continue
    }
    textNudges = 0

    // One conversation group per model turn: the FULL raw requestable
    // parts (thought_signature included) are replayed verbatim.
    const turnId = crypto.randomUUID()
    const turnParts = turn.turnParts ?? []
    const { honored, skipped } = clampTurnCalls(turn.calls, limits)
    if (skipped > 0) {
      await store.recordStep({
        run_id: run.id,
        kind: 'system',
        tool_name: null,
        tool_version: null,
        permission_decision: null,
        status: 'skipped',
        approval_id: null,
        args_snapshot: null,
        result_summary: { skipped_calls: skipped },
        feedback_snapshot: null,
        error: `TOOL_CALL_CAP: ${skipped} call(s) exceeded the per-turn cap and were ignored`,
        latency_ms: null,
        tokens_in: 0,
        tokens_out: 0,
        finished_at: new Date().toISOString(),
      })
    }

    for (let ci = 0; ci < honored.length; ci++) {
      const call = honored[ci]

      if (state.stepCount >= run.max_steps) {
        return failRun(deps, run, `STEP_LIMIT: step limit reached (${run.max_steps})`, state)
      }

      // --- loop guard (9.6): refuse the (N+1)th consecutive identical
      // call — observation loops burn budget without changing state. ---
      const signature = callSignature(call.name, call.args)
      if (signature === lastCallSignature) {
        repeatCount += 1
      } else {
        repeatCount = 1
        lastCallSignature = signature
      }
      if (repeatCount > REPEAT_CALL_LIMIT) {
        const reason = `REPEATED_CALL: identical call to ${call.name} already made ${REPEAT_CALL_LIMIT} times — use the results you already have, take a different action, or finish/escalate`
        const wrapper: FeedbackPayload = { modelParts: turnParts, turnId, response: refusalFeedback(reason) }
        await store.recordStep({
          run_id: run.id,
          kind: 'tool_call',
          tool_name: call.name,
          tool_version: getTool(call.name, registry)?.version ?? null,
          permission_decision: 'denied',
          status: 'denied',
          approval_id: null,
          args_snapshot: call.args,
          result_summary: null,
          feedback_snapshot: wrapper,
          error: reason,
          latency_ms: null,
          tokens_in: 0,
          tokens_out: 0,
          finished_at: new Date().toISOString(),
        })
        state.stepCount += 1
        contents.push(modelPartsContent(turnParts))
        contents.push(functionResponsePart(call.name, wrapper.response))
        await persistProgress({})
        continue
      }

      const tool = getTool(call.name, registry)
      const validation = tool ? tool.validateInput(call.args) : { ok: false as const, errors: ['unknown tool'] }

      if (!tool || !validation.ok) {
        const reason = tool
          ? `INVALID_ARGUMENTS: ${(validation as { errors: string[] }).errors.join('; ')}`
          : `UNKNOWN_TOOL: ${call.name} is not registered`
        const wrapper: FeedbackPayload = { modelParts: turnParts, turnId, response: refusalFeedback(reason) }
        await store.recordStep({
          run_id: run.id,
          kind: 'tool_call',
          tool_name: call.name,
          tool_version: tool?.version ?? null,
          permission_decision: null,
          status: 'failed',
          approval_id: null,
          args_snapshot: call.args,
          result_summary: null,
          feedback_snapshot: wrapper,
          error: reason,
          latency_ms: null,
          tokens_in: 0,
          tokens_out: 0,
          finished_at: new Date().toISOString(),
        })
        state.stepCount += 1
        contents.push(modelPartsContent(turnParts))
        contents.push(functionResponsePart(call.name, wrapper.response))
        await persistProgress({})
        continue
      }

      // --- permission engine: the platform's authorization decision ---
      const perm = evaluateToolPermission({
        agent,
        tool,
        userRole: ctx.userRole,
        toolEnabled: await store.isToolEnabled(call.name),
        args: validation.data,
        ctx,
      })

      if (perm.decision === 'denied') {
        const wrapper: FeedbackPayload = { modelParts: turnParts, turnId, response: refusalFeedback(perm.reason) }
        await store.recordStep({
          run_id: run.id,
          kind: 'tool_call',
          tool_name: call.name,
          tool_version: tool.version,
          permission_decision: 'denied',
          status: 'denied',
          approval_id: null,
          args_snapshot: call.args,
          result_summary: null,
          feedback_snapshot: wrapper,
          error: perm.reason,
          latency_ms: null,
          tokens_in: 0,
          tokens_out: 0,
          finished_at: new Date().toISOString(),
        })
        state.stepCount += 1
        contents.push(modelPartsContent(turnParts))
        contents.push(functionResponsePart(call.name, wrapper.response))
        await persistProgress({})
        continue
      }

      if (perm.decision === 'approval_required') {
        // Resource-scope pre-check against the REQUESTER's RLS client
        // (9.5) — a requester must never be able to park an
        // out-of-scope resource behind an approval, because the resumed
        // execution would run under the approver's session.
        if (tool.checkResource) {
          const resource = await tool.checkResource(ctx, validation.data)
          if (!resource.ok) {
            const wrapper: FeedbackPayload = {
              modelParts: turnParts,
              turnId,
              response: refusalFeedback(`RESOURCE_DENIED: ${resource.reason}`),
            }
            await store.recordStep({
              run_id: run.id,
              kind: 'tool_call',
              tool_name: call.name,
              tool_version: tool.version,
              permission_decision: 'denied',
              status: 'denied',
              approval_id: null,
              args_snapshot: call.args,
              result_summary: null,
              feedback_snapshot: wrapper,
              error: `RESOURCE_DENIED: ${resource.reason}`,
              latency_ms: null,
              tokens_in: 0,
              tokens_out: 0,
              finished_at: new Date().toISOString(),
            })
            state.stepCount += 1
            contents.push(modelPartsContent(turnParts))
            contents.push(functionResponsePart(call.name, wrapper.response))
            await persistProgress({})
            continue
          }
        }
        // 9.6 protocol: propose → persist → suspend. The run resumes
        // through resumeAgentRun after a human decision. The full turn
        // parts are persisted now; the response is written by the
        // resume path (approved execution / rejection feedback).
        await store.recordStep({
          run_id: run.id,
          kind: 'tool_call',
          tool_name: call.name,
          tool_version: tool.version,
          permission_decision: 'approval_required',
          status: 'approval_required',
          approval_id: null,
          args_snapshot: validation.data,
          result_summary: null,
          feedback_snapshot: { modelParts: turnParts, turnId, response: null } satisfies FeedbackPayload,
          error: null,
          latency_ms: null,
          tokens_in: 0,
          tokens_out: 0,
          finished_at: new Date().toISOString(),
        })
        const stepRows = await store.listSteps(run.id)
        const approvalStep = stepRows[stepRows.length - 1]
        const approval = await store.createApproval({
          run_id: run.id,
          step_id: approvalStep?.id ?? null,
          tool_name: call.name,
          args_snapshot: validation.data,
          requested_by: run.user_id,
        })
        state.stepCount += 1
        await persistProgress({ status: 'awaiting_approval' })
        return {
          runId: run.id,
          status: 'awaiting_approval',
          finalOutcome: null,
          error: null,
          pendingApprovalId: approval.id,
          stepCount: state.stepCount,
        }
      }

      // --- execute (permission: allowed) ---
      const executed = await executeToolCall(
        deps,
        run,
        tool,
        validation.data as never,
        ctx,
        state,
        null,
        turnId,
        turnParts
      )
      if ('terminal' in executed) return executed.terminal
      contents.push(modelPartsContent(turnParts))
      contents.push(functionResponsePart(call.name, executed.response))
      await persistProgress({})
    }
  }
}

// -------------------------------------------------------------
// Shared execution path (loop + approved-resume): timeout, one retry
// for idempotent tools on transient errors, output validation, step
// recording. Returns the functionResponse payload for the model (the
// loop pairs it with the raw call parts on the conversation) or a
// terminal transition.
// -------------------------------------------------------------

type ExecutionOutcome =
  | { terminal: AgentRunOutput }
  | { response: unknown }

async function executeToolCall(
  deps: RuntimeDeps,
  run: AgentRunRecord,
  tool: ToolDefinition<never, never>,
  args: never,
  ctx: ToolContext,
  state: LoopState,
  approvalId: string | null,
  turnId: string | null,
  turnParts: Record<string, unknown>[]
): Promise<ExecutionOutcome> {
  const store = deps.store
  state.stepCount += 1
  const started = Date.now()

  let outcome = await withTimeout(tool.execute(ctx, args), tool.timeoutMs, tool.idempotency === 'idempotent')
  if (!outcome.ok && outcome.retryable && tool.idempotency === 'idempotent') {
    outcome = await withTimeout(tool.execute(ctx, args), tool.timeoutMs, false)
  }
  const latencyMs = Date.now() - started

  const wrapper: FeedbackPayload = {
    // turnId/turnParts are empty on the approved-resume path — the turn
    // content is already persisted on the approval step.
    ...(turnId ? { modelParts: turnParts, turnId } : {}),
    response: null as unknown,
  }

  const recordAndReturn = async (
    stepStatus: 'success' | 'failed',
    resultSummary: unknown,
    response: unknown,
    error: string | null
  ): Promise<ExecutionOutcome> => {
    await store.recordStep({
      run_id: run.id,
      kind: 'tool_call',
      tool_name: tool.name,
      tool_version: tool.version,
      permission_decision: 'allowed',
      status: stepStatus,
      approval_id: approvalId,
      args_snapshot: args,
      result_summary: resultSummary,
      feedback_snapshot: { ...wrapper, response } satisfies FeedbackPayload,
      error,
      latency_ms: latencyMs,
      tokens_in: 0,
      tokens_out: 0,
      finished_at: new Date().toISOString(),
    })
    return { response }
  }

  if (!outcome.ok) {
    // Failed execution — including a failed escalation: feedback goes
    // back to the model, which may retry differently or finish.
    return recordAndReturn('failed', null, { result: { ok: false, error: outcome.error } }, outcome.error)
  }

  const outValidation = tool.validateOutput(outcome.result)
  if (!outValidation.ok) {
    const reason = `INVALID_TOOL_RESULT: ${outValidation.errors.join('; ')}`
    return recordAndReturn('failed', null, refusalFeedback(reason), reason)
  }

  // --- control tools: the only successful ways a run ends ---
  if (tool.control === 'finish' || tool.control === 'escalate') {
    const outcomeText =
      tool.control === 'finish'
        ? (args as unknown as { summary: string }).summary
        : (args as unknown as { reason: string }).reason
    const newStatus: AgentRunStatus = tool.control === 'finish' ? 'completed' : 'escalated'
    await store.recordStep({
      run_id: run.id,
      kind: 'tool_call',
      tool_name: tool.name,
      tool_version: tool.version,
      permission_decision: 'allowed',
      status: 'success',
      approval_id: approvalId,
      args_snapshot: args,
      // Control tools carry their own outcome text — record the args.
      result_summary: args,
      feedback_snapshot: { ...wrapper, response: { result: { ok: true, data: outValidation.data } } } satisfies FeedbackPayload,
      error: null,
      latency_ms: latencyMs,
      tokens_in: 0,
      tokens_out: 0,
      finished_at: new Date().toISOString(),
    })
    await store.updateRun(run.id, {
      status: newStatus,
      final_outcome: outcomeText,
      current_state: { ...run.current_state, last_tool: tool.name },
      completed_at: new Date().toISOString(),
      // Terminal paths bypass persistProgress — carry the final counters.
      step_count: state.stepCount,
      tokens_in: state.tokensIn,
      tokens_out: state.tokensOut,
    })
    emitRunTrace(run, newStatus, null, state, new Date(run.started_at).getTime())
    return {
      terminal: {
        runId: run.id,
        status: newStatus,
        finalOutcome: outcomeText,
        error: null,
        pendingApprovalId: null,
        stepCount: state.stepCount,
      },
    }
  }

  await store.recordStep({
    run_id: run.id,
    kind: 'tool_call',
    tool_name: tool.name,
    tool_version: tool.version,
    permission_decision: 'allowed',
    status: 'success',
    approval_id: approvalId,
    args_snapshot: args,
    result_summary: outValidation.data,
    feedback_snapshot: {
      ...wrapper,
      response: { result: { ok: true, data: outValidation.data } },
    } satisfies FeedbackPayload,
    error: null,
    latency_ms: latencyMs,
    tokens_in: 0,
    tokens_out: 0,
    finished_at: new Date().toISOString(),
  })
  await store.updateRun(run.id, { current_state: { ...run.current_state, last_tool: tool.name } })
  return { response: { result: { ok: true, data: outValidation.data } } }
}

// -------------------------------------------------------------
// Helpers
// -------------------------------------------------------------

async function withTimeout<T>(
  p: Promise<T>,
  timeoutMs: number,
  retryable: boolean
): Promise<T | { ok: false; error: string; retryable: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<{ ok: false; error: string; retryable: boolean }>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, error: `TOOL_TIMEOUT: exceeded ${timeoutMs}ms`, retryable }), timeoutMs)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Fire-and-forget PromptLedger trace of a terminal transition (never throws). */
function emitRunTrace(
  run: AgentRunRecord,
  status: AgentRunStatus,
  error: string | null,
  state: LoopState,
  startedAtMs: number
): void {
  traceAiRun({
    app: 'ops-copilot',
    name: `agent:${run.agent_id}`,
    promptVersion: null,
    promptSource: 'runtime',
    model: state.lastModel,
    input: run.goal,
    output: status === 'completed' ? (run.final_outcome ?? '') : '',
    latencyMs: Date.now() - startedAtMs,
    ok: status === 'completed',
    error,
    tokensIn: state.tokensIn,
    tokensOut: state.tokensOut,
  })
}

async function failRun(
  deps: RuntimeDeps,
  run: AgentRunRecord,
  message: string,
  state: LoopState
): Promise<AgentRunOutput> {
  await deps.store.recordStep({
    run_id: run.id,
    kind: 'system',
    tool_name: null,
    tool_version: null,
    permission_decision: null,
    status: 'failed',
    approval_id: null,
    args_snapshot: null,
    result_summary: null,
    feedback_snapshot: null,
    error: message,
    latency_ms: null,
    tokens_in: 0,
    tokens_out: 0,
    finished_at: new Date().toISOString(),
  })
  await deps.store.updateRun(run.id, {
    status: 'failed',
    error: message,
    completed_at: new Date().toISOString(),
    step_count: state.stepCount,
    tokens_in: state.tokensIn,
    tokens_out: state.tokensOut,
  })
  emitRunTrace(run, 'failed', message, state, new Date(run.started_at).getTime())
  return { runId: run.id, status: 'failed', finalOutcome: null, error: message, pendingApprovalId: null, stepCount: state.stepCount }
}

function immediateFailure(agentIdOrRunId: string | null, message: string): AgentRunOutput {
  console.error(`[agent-runtime] ${message}`)
  return {
    runId: agentIdOrRunId ?? '',
    status: 'failed',
    finalOutcome: null,
    error: message,
    pendingApprovalId: null,
    stepCount: 0,
  }
}
