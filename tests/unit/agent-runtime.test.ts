import { describe, expect, it, vi } from 'vitest'
import { loadVisibleLead } from '@/lib/agent/tools/crm'
import { testContext } from './helpers/agent-test-kit'
import { startAgentRun, resumeAgentRun, requireBoundedPeriodSearch, type RuntimeDeps } from '@/lib/agent/runtime'
import { FakeAgentModel, MemoryAgentStore, TEST_AGENTS, TEST_TOOLS } from './helpers/agent-test-kit'

// =============================================================
// 9.2/9.3/9.6 — the governed loop, exercised end-to-end against a
// memory store and a scripted model: dynamic tool selection, denied
// calls never execute, approval suspension/resume, rejection
// re-planning, recovery from failures, escalation, guardrail stops,
// and full trace reconstruction from persisted state.
// =============================================================

const GOAL = 'Review lead L1 and take the appropriate next action'

type FakeTurn = { calls?: Array<{ name: string; args: Record<string, unknown> }>; text?: string }

function makeDeps(opts: {
  model: FakeAgentModel
  store: MemoryAgentStore
  dryRunEmail?: boolean
  limits?: RuntimeDeps['limits']
}): RuntimeDeps {
  return {
    store: opts.store,
    model: opts.model,
    userClient: null as unknown as RuntimeDeps['userClient'],
    adminClient: null as unknown as RuntimeDeps['adminClient'],
    tools: TEST_TOOLS,
    agents: TEST_AGENTS,
    dryRunEmail: opts.dryRunEmail ?? true,
    limits: opts.limits,
  }
}

async function happyDeps(script: FakeTurn[], opts: { dryRunEmail?: boolean; limits?: RuntimeDeps['limits'] } = {}) {
  const store = new MemoryAgentStore()
  const model = new FakeAgentModel(script)
  return { store, model, deps: makeDeps({ store, model, ...opts }) }
}

describe('agent runtime — governed loop (9.2)', () => {
  it('completes a multi-action run: dynamic tool choice, then verified finish', async () => {
    const { store, model, deps } = await happyDeps([
      { calls: [{ name: 'echo', args: { message: 'observe lead' } }] },
      { calls: [{ name: 'echo', args: { message: 'second look' } }] },
      { calls: [{ name: 'finish', args: { summary: 'Reviewed the lead', verification: 'echo results observed' } }] },
    ])

    const out = await startAgentRun(deps, { agentId: 'test-agent', userId: 'user-1', userRole: 'admissions', goal: GOAL })

    expect(out.status).toBe('completed')
    expect(out.finalOutcome).toBe('Reviewed the lead')
    expect(out.error).toBeNull()

    const run = await store.getRun(out.runId)
    expect(run?.status).toBe('completed')
    expect(run?.final_outcome).toBe('Reviewed the lead')
    expect(run?.completed_at).toBeTruthy()
    // 3 sequential actions, tokens accumulated from both model turns
    expect(run?.step_count).toBe(3)
    expect(run?.tokens_in).toBe(300)
    expect(run?.tokens_out).toBe(30)

    const steps = await store.listSteps(out.runId)
    expect(steps.map((s) => s.tool_name)).toEqual(['echo', 'echo', 'finish'])
    expect(steps.every((s) => s.permission_decision === 'allowed')).toBe(true)
    expect(steps.every((s) => s.tool_version === '1.0.0')).toBe(true)
    expect(steps[2].result_summary).toMatchObject({ summary: 'Reviewed the lead' })

    // The model saw its own prior tool results (re-planning input):
    const lastRequest = model.requests[model.requests.length - 1]
    const responseParts = lastRequest.contents.filter((c) => c.role === 'user' && 'functionResponse' in c.parts[0])
    expect(responseParts.length).toBeGreaterThanOrEqual(2)
  })

  it('a denied tool call never executes and the model re-plans (9.5/9.6)', async () => {
    const { store, model, deps } = await happyDeps([
      { calls: [{ name: 'echo', args: { message: 'x' } }] },
      { calls: [{ name: 'finish', args: { summary: 'went another way', verification: 'observed denial' } }] },
    ])
    store.toolFlags.set('echo', false) // platform disabled the tool

    const out = await startAgentRun(deps, { agentId: 'test-agent', userId: 'user-1', userRole: 'admissions', goal: GOAL })

    expect(out.status).toBe('completed')
    const steps = await store.listSteps(out.runId)
    const denied = steps.find((s) => s.status === 'denied')
    expect(denied?.permission_decision).toBe('denied')
    expect(denied?.error).toContain('TOOL_DISABLED')
    // The refusal was fed back to the model verbatim:
    const fb = (denied?.feedback_snapshot as { response: { result: { refused: boolean; reason: string } } }).response
    expect(fb.result.refused).toBe(true)
    expect(model.requests[1].contents.some((c) => JSON.stringify(c).includes('TOOL_DISABLED'))).toBe(true)
  })

  it('rejects unknown tools and malformed arguments safely', async () => {
    const { store, deps } = await happyDeps([
      { calls: [{ name: 'nonexistent_tool', args: {} }] },
      { calls: [{ name: 'echo', args: { wrong: true } }] },
      { calls: [{ name: 'finish', args: { summary: 'recovered', verification: 'n/a' } }] },
    ])

    const out = await startAgentRun(deps, { agentId: 'test-agent', userId: 'user-1', userRole: 'admissions', goal: GOAL })
    expect(out.status).toBe('completed')

    const steps = await store.listSteps(out.runId)
    expect(steps[0].error).toContain('UNKNOWN_TOOL')
    expect(steps[1].error).toContain('INVALID_ARGUMENTS')
    expect(steps[1].status).toBe('failed')
    expect(steps[2].status).toBe('success')
  })

  it('recovers from a permanent tool failure, then escalates when blocked (9.2)', async () => {
    const { store, deps } = await happyDeps([
      { calls: [{ name: 'boom', args: {} }] },
      { calls: [{ name: 'echo', args: { message: 'try alternative' } }] },
      { calls: [{ name: 'escalate_to_human', args: { reason: 'alternative also blocked' } }] },
    ])

    const out = await startAgentRun(deps, { agentId: 'test-agent', userId: 'user-1', userRole: 'admissions', goal: GOAL })

    expect(out.status).toBe('escalated')
    expect(out.finalOutcome).toBe('alternative also blocked')
    const run = await store.getRun(out.runId)
    expect(run?.status).toBe('escalated')
    const steps = await store.listSteps(out.runId)
    expect(steps.find((s) => s.tool_name === 'boom')?.status).toBe('failed')
    expect(steps.find((s) => s.tool_name === 'escalate_to_human')?.status).toBe('success')
  })

  it('stops at the step limit instead of looping forever (9.6)', async () => {
    const { store, deps } = await happyDeps(
      [
        { calls: [{ name: 'echo', args: { message: 'a' } }] },
        { calls: [{ name: 'echo', args: { message: 'b' } }] },
        { calls: [{ name: 'echo', args: { message: 'c' } }] },
      ],
      { limits: { maxSteps: 3 } }
    )

    const out = await startAgentRun(deps, { agentId: 'test-agent', userId: 'user-1', userRole: 'admissions', goal: GOAL })
    expect(out.status).toBe('failed')
    expect(out.error).toContain('step limit')
    const run = await store.getRun(out.runId)
    expect(run?.status).toBe('failed')
    expect(run?.completed_at).toBeTruthy()
  })

  it('refuses the third consecutive identical call and forces progress (9.6 loop guard)', async () => {
    const { store, deps } = await happyDeps([
      { calls: [{ name: 'echo', args: { message: 'same' } }] },
      { calls: [{ name: 'echo', args: { message: 'same' } }] },
      { calls: [{ name: 'echo', args: { message: 'same' } }] },
      { calls: [{ name: 'finish', args: { summary: 'acted on results', verification: 'guard feedback observed' } }] },
    ])

    const out = await startAgentRun(deps, { agentId: 'test-agent', userId: 'user-1', userRole: 'admissions', goal: GOAL })

    expect(out.status).toBe('completed')
    const steps = await store.listSteps(out.runId)
    const repeated = steps.filter((s) => s.status === 'denied' && (s.error ?? '').includes('REPEATED_CALL'))
    expect(repeated.length).toBe(1)
    // Only two identical calls were actually executed; the third was refused.
    expect(steps.filter((s) => s.tool_name === 'echo' && s.status === 'success').length).toBe(2)
    // The refusal was fed back and the model moved on to finish.
    const fb = (repeated[0].feedback_snapshot as { response: { result: { reason: string } } }).response.result
    expect(fb.reason).toContain('REPEATED_CALL')
  })

  it('kill switch blocks execution before any model turn (9.6)', async () => {
    const { store, model, deps } = await happyDeps([{ calls: [] }])
    store.killSwitch = true

    const out = await startAgentRun(deps, { agentId: 'test-agent', userId: 'user-1', userRole: 'admissions', goal: GOAL })

    expect(out.status).toBe('failed')
    expect(out.error).toContain('KILL_SWITCH')
    expect(model.requests.length).toBe(0)
  })

  it('fails a run whose model never uses the protocol', async () => {
    const { store, deps } = await happyDeps([
      { text: 'I could just tell you the answer' },
      { text: 'no tools needed' },
      { text: 'still texting' },
    ])

    const out = await startAgentRun(deps, { agentId: 'test-agent', userId: 'user-1', userRole: 'admissions', goal: GOAL })
    expect(out.status).toBe('failed')
    expect(out.error).toContain('NO_COMPLETION')
    const run = await store.getRun(out.runId)
    expect(run?.status).toBe('failed')
  })

  it('executes multiple calls in one turn within the cap', async () => {
    const { store, deps } = await happyDeps([
      {
        calls: [
          { name: 'echo', args: { message: 'one' } },
          { name: 'echo', args: { message: 'two' } },
        ],
      },
      { calls: [{ name: 'finish', args: { summary: 'done both', verification: 'two echoes' } }] },
    ])

    const out = await startAgentRun(deps, { agentId: 'test-agent', userId: 'user-1', userRole: 'admissions', goal: GOAL })
    expect(out.status).toBe('completed')
    const steps = await store.listSteps(out.runId)
    expect(steps.filter((s) => s.tool_name === 'echo').length).toBe(2)
    expect((steps[0].result_summary as { echo: string }).echo).toBe('one')
    expect((steps[1].result_summary as { echo: string }).echo).toBe('two')
  })
})

describe('agent runtime — multi-agent handoff (9.12)', () => {
  it('delegates to a specialist and returns its outcome; child run is correlated to the parent', async () => {
    const { store, deps } = await happyDeps([
      { calls: [{ name: 'delegate_to_agent', args: { agent_id: 'test-specialist', task: 'Report on the leads' } }] },
      // The specialist consumes the NEXT turn while the parent is suspended inside the tool.
      { calls: [{ name: 'echo', args: { message: 'report data' } }] },
      { calls: [{ name: 'finish', args: { summary: 'report: 3 leads', verification: 'echo observed' } }] },
      // Back in the parent: it finishes with the delegated result.
      { calls: [{ name: 'finish', args: { summary: 'used specialist report: report: 3 leads', verification: 'delegation result observed' } }] },
    ])

    const out = await startAgentRun(deps, { agentId: 'test-agent', userId: 'user-1', userRole: 'admissions', goal: GOAL })

    expect(out.status).toBe('completed')
    expect(out.finalOutcome).toContain('report: 3 leads')
    const steps = await store.listSteps(out.runId)
    const delegateStep = steps.find((s) => s.tool_name === 'delegate_to_agent')
    expect(delegateStep?.status).toBe('success')
    expect((delegateStep?.result_summary as { child_run_id: string; status: string }).status).toBe('completed')

    // Child run exists, is correlated to the parent, and ran under the same principal.
    const childRuns = [...store.runs.values()].filter((r) => r.agent_id === 'test-specialist')
    expect(childRuns.length).toBe(1)
    expect(childRuns[0].current_state).toMatchObject({ parent_run_id: out.runId })
    expect(childRuns[0].user_id).toBe('user-1')
  })

  it('structurally blocks recursive delegation — the specialist has no delegation tool', async () => {
    // The parent delegates; INSIDE the child run the specialist requests
    // delegate_to_agent — a valid call, but the tool is not in the
    // specialist's allowlist, so the permission engine denies it and the
    // denial is fed back. The parent still finishes with the report.
    const { store, deps } = await happyDeps([
      { calls: [{ name: 'delegate_to_agent', args: { agent_id: 'test-specialist', task: 'Report on the leads' } }] },
      { calls: [{ name: 'delegate_to_agent', args: { agent_id: 'test-specialist', task: 'Delegate this onward please' } }] },
      { calls: [{ name: 'echo', args: { message: 'specialist was denied' } }] },
      { calls: [{ name: 'finish', args: { summary: 'report: 3 leads', verification: 'echo observed' } }] },
      { calls: [{ name: 'finish', args: { summary: 'used specialist report: report: 3 leads', verification: 'delegation result observed' } }] },
    ])

    const out = await startAgentRun(deps, { agentId: 'test-agent', userId: 'user-1', userRole: 'admissions', goal: GOAL })
    expect(out.status).toBe('completed')

    // Inside the specialist's own run, the delegation attempt is recorded as denied.
    const specialistRuns = [...store.runs.values()].filter((r) => r.agent_id === 'test-specialist')
    expect(specialistRuns.length).toBe(1)
    const specialistSteps = await store.listSteps(specialistRuns[0].id)
    const denied = specialistSteps.find((s) => s.tool_name === 'delegate_to_agent')
    expect(denied?.status).toBe('denied')
    expect(denied?.error).toContain('AGENT_NOT_AUTHORIZED')
  })
})

describe('approval resume safety', () => {
  async function suspendedRun() {
    const { store, deps } = await happyDeps([
      { calls: [{ name: 'make_draft', args: { text: 'approved draft' } }] },
    ], { dryRunEmail: false })
    const suspended = await startAgentRun(deps, { agentId: 'test-agent', userId: 'user-1', userRole: 'admissions', goal: GOAL })
    const approvalId = suspended.pendingApprovalId!
    await store.decideApproval(approvalId, 'approved', 'ops-1', null)
    const resumeDeps = makeDeps({ store, dryRunEmail: false, model: new FakeAgentModel([
      { calls: [{ name: 'finish', args: { summary: 'done', verification: 'observed' } }] },
    ]) })
    return { store, deps: resumeDeps, input: { runId: suspended.runId, approvalId } }
  }

  it('does not execute a tool disabled during the human wait', async () => {
    const { store, deps, input } = await suspendedRun()
    const execute = vi.fn(TEST_TOOLS.make_draft.execute)
    deps.tools = { ...TEST_TOOLS, make_draft: { ...TEST_TOOLS.make_draft, execute } }
    store.toolFlags.set('make_draft', false)
    const out = await resumeAgentRun(deps, input)
    expect(execute).not.toHaveBeenCalled()
    expect(out.error).toContain('TOOL_DISABLED')
  })

  it('allows only one concurrent resume to execute the approved effect', async () => {
    const { deps, input } = await suspendedRun()
    const execute = vi.fn(TEST_TOOLS.make_draft.execute)
    deps.tools = { ...TEST_TOOLS, make_draft: { ...TEST_TOOLS.make_draft, execute } }
    await Promise.allSettled([resumeAgentRun(deps, input), resumeAgentRun(deps, input)])
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('excludes durable human wait and persists the resumed execution count', async () => {
    const { store, deps, input } = await suspendedRun()
    const past = new Date(Date.now() - 86_400_000).toISOString()
    await store.updateRun(input.runId, { started_at: past, approval_wait_started_at: past })
    const out = await resumeAgentRun(deps, input)
    expect(out.status).toBe('completed')
    expect(out.stepCount).toBe(3)
    expect((await store.getRun(input.runId))?.step_count).toBe(3)
  })

  it('uses requester authorization instead of the approver client for lead reads', async () => {
    const from = vi.fn(() => { throw new Error('approver client must not be used') })
    const requesterRead = vi.fn(async () => null)
    const ctx = testContext({ userClient: { from } as unknown as RuntimeDeps['userClient'], requesterRead })
    const result = await loadVisibleLead(ctx, 'lead-1')
    expect(result.ok).toBe(false)
    expect(from).not.toHaveBeenCalled()
    expect(requesterRead).toHaveBeenCalledWith('lead', { lead_id: 'lead-1' })
  })

  it('preserves the persisted approval requirement on resume when the server weakens', async () => {
    const { store, deps, input } = await suspendedRun()
    const secondModel = new FakeAgentModel([
      { calls: [{ name: 'make_draft', args: { text: 'second draft' } }] },
    ])
    deps.model = secondModel
    deps.dryRunEmail = true
    const out = await resumeAgentRun(deps, input)
    expect(out.status).toBe('awaiting_approval')
    expect(out.pendingApprovalId).toBeTruthy()
    const approvals = [...store.approvals.values()].filter((a) => a.tool_name === 'make_draft')
    expect(approvals.length).toBe(2)
    expect((await store.getRun(input.runId))?.current_state).toMatchObject({ require_approval: true })
  })

  it('tightens to the server requirement on resume even when the run opted out', async () => {
    const { store, deps, input } = await suspendedRun()
    const run = await store.getRun(input.runId)
    await store.updateRun(input.runId, { current_state: { ...run?.current_state, require_approval: false } })
    const secondModel = new FakeAgentModel([
      { calls: [{ name: 'make_draft', args: { text: 'second draft' } }] },
      { calls: [{ name: 'finish', args: { summary: 'both drafts recorded', verification: 'two drafts observed' } }] },
    ])
    deps.model = secondModel
    deps.dryRunEmail = false
    const out = await resumeAgentRun(deps, input)
    expect(out.status).toBe('awaiting_approval')
    expect(out.pendingApprovalId).toBeTruthy()
  })

  it('delegation inherits the parent approval policy without loosening it', async () => {
    const { store, deps } = await happyDeps([
      { calls: [{ name: 'delegate_to_agent', args: { agent_id: 'test-specialist', task: 'Prepare a draft report' } }] },
      { calls: [{ name: 'finish', args: { summary: 'child done', verification: 'n/a' } }] },
      { calls: [{ name: 'finish', args: { summary: 'parent done', verification: 'delegation observed' } }] },
    ], { dryRunEmail: true })
    const out = await startAgentRun(deps, { agentId: 'test-agent', userId: 'user-1', userRole: 'admissions', goal: GOAL, requireApproval: true })
    expect(out.status).toBe('completed')
    const childRuns = [...store.runs.values()].filter((r) => r.agent_id === 'test-specialist')
    expect(childRuns.length).toBe(1)
    expect(childRuns[0].current_state).toMatchObject({ parent_run_id: out.runId, require_approval: true })
  })

  it('interrupted execution after the claim never replays the approval', async () => {
    const { store, deps, input } = await suspendedRun()
    const execute = vi.fn(async () => { throw new Error('process died mid-write') })
    deps.tools = { ...TEST_TOOLS, make_draft: { ...TEST_TOOLS.make_draft, execute } }
    const out = await resumeAgentRun(deps, input)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(out.error).toContain('RECONCILIATION_REQUIRED')
    expect((await store.getApproval(input.approvalId))?.execution_claimed_at).toBeTruthy()
    expect((await store.getRun(input.runId))?.status).toBe('failed')
    const again = await resumeAgentRun(deps, input)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(again.error).toContain('RECONCILIATION_REQUIRED')
  })

  it('retry before any claim recovers the decision and executes once', async () => {
    const { store, deps, input } = await suspendedRun()
    const originalClaim = store.claimApproval.bind(store)
    const beforeClaim = vi.fn()
      .mockImplementationOnce(async () => { throw new Error('claim transport failed before commit') })
      .mockImplementationOnce(async () => {
        const claimed = await originalClaim(input.runId, input.approvalId)
        expect(claimed).toBeTruthy()
        return claimed
      })
    store.claimApproval = beforeClaim as unknown as typeof store.claimApproval
    const resumeModel = new FakeAgentModel([
      { calls: [{ name: 'finish', args: { summary: 'done', verification: 'observed' } }] },
    ])
    deps.model = resumeModel
    const first = await resumeAgentRun(deps, input)
    expect(first.error).toContain('RESUME_UNAVAILABLE')
    const second = await resumeAgentRun(deps, input)
    expect(second.status).toBe('completed')
    const draftSteps = (await store.listSteps(input.runId)).filter((s) => s.tool_name === 'make_draft' && s.status === 'success')
    expect(draftSteps.length).toBe(1)
  })

  it('a decided approval cannot overwrite a terminal run status', async () => {
    const { store, deps, input } = await suspendedRun()
    const execute = vi.fn(TEST_TOOLS.make_draft.execute)
    deps.tools = { ...TEST_TOOLS, make_draft: { ...TEST_TOOLS.make_draft, execute } }
    const claimed = await store.claimApproval(input.runId, input.approvalId)
    expect(claimed?.status).toBe('running')
    await store.updateRun(input.runId, { status: 'completed' })
    const _out = await resumeAgentRun(deps, input)
    expect(execute).not.toHaveBeenCalled()
    expect((await store.getRun(input.runId))?.status).toBe('completed')
  })

  it('persists durable reconciliation context when claimed execution is interrupted', async () => {
    const { store, deps, input } = await suspendedRun()
    const execute = vi.fn(async () => { throw new Error('process died mid-write') })
    deps.tools = { ...TEST_TOOLS, make_draft: { ...TEST_TOOLS.make_draft, execute } }
    const out = await resumeAgentRun(deps, input)
    expect(out.status).toBe('failed')
    const steps = await store.listSteps(input.runId)
    const reconcile = steps.find((s) => s.kind === 'system' && (s.error ?? '').includes('RECONCILIATION_REQUIRED'))
    expect(reconcile).toBeTruthy()
    expect(reconcile?.result_summary).toMatchObject({ approval_id: input.approvalId, tool_name: 'make_draft' })
    expect((await store.getApproval(input.approvalId))?.execution_claimed_at).toBeTruthy()
  })

  it('records attempted tool, args and approval context on an uncertain timeout', async () => {
    const { store, deps, input } = await suspendedRun()
    const execute = vi.fn(() => new Promise<never>(() => {})) as unknown as typeof TEST_TOOLS.make_draft.execute
    deps.tools = { ...TEST_TOOLS, make_draft: { ...TEST_TOOLS.make_draft, execute, timeoutMs: 10, idempotency: 'non_idempotent' } }
    const out = await resumeAgentRun(deps, input)
    expect(out.status).toBe('failed')
    expect(out.error).toContain('RECONCILIATION_REQUIRED')
    expect(out.error).toContain('attempted tool=make_draft')
    expect(out.error).toContain('"text":"approved draft"')
    expect(out.error).toContain(`approval_id=${input.approvalId}`)
    const steps = await store.listSteps(input.runId)
    expect(steps.some((s) => s.kind === 'system' && (s.error ?? '').includes('attempted tool=make_draft'))).toBe(true)
  })

  it('recovers an ordinary resource-scoped refusal instead of failing the run', async () => {
    const { store, deps } = await happyDeps([
      { calls: [{ name: 'make_draft', args: { text: 'draft for in-scope lead' } }] },
      { calls: [{ name: 'finish', args: { summary: 're-planned', verification: 'resource refusal observed' } }] },
    ], { dryRunEmail: true })
    const ctxTool = TEST_TOOLS.make_draft
    const execute = vi.fn(ctxTool.execute)
    deps.tools = { ...TEST_TOOLS, make_draft: { ...ctxTool, checkResource: async () => ({ ok: false, reason: 'outside scope' }), execute } }
    const out = await startAgentRun(deps, { agentId: 'test-agent', userId: 'user-1', userRole: 'admissions', goal: GOAL })
    expect(out.status).toBe('completed')
    expect(execute).not.toHaveBeenCalled()
    const steps = await store.listSteps(out.runId)
    const refused = steps.find((s) => s.tool_name === 'make_draft')
    expect(refused?.status).toBe('denied')
    expect(refused?.error).toContain('RESOURCE_DENIED')
    expect(steps.some((s) => s.tool_name === 'finish' && s.status === 'success')).toBe(true)
  })

  it('fails closed when an approved action loses resource scope during the wait', async () => {
    const { deps, input } = await suspendedRun()
    const execute = vi.fn(TEST_TOOLS.make_draft.execute)
    deps.tools = { ...TEST_TOOLS, make_draft: { ...TEST_TOOLS.make_draft, checkResource: async () => ({ ok: false, reason: 'lead reassigned' }), execute } }
    const out = await resumeAgentRun(deps, input)
    expect(execute).not.toHaveBeenCalled()
    expect(out.error).toContain('RESOURCE_DENIED')
  })
})

describe('agent runtime — reporting date bounds', () => {
  it('refuses an unbounded search_leads when a relative-period report is requested', () => {
    expect(requireBoundedPeriodSearch({ agent_id: 'reporting-agent', goal: 'Summarize leads of this week' }, 'search_leads', {})).toContain('PERIOD_BOUNDS_REQUIRED')
    expect(requireBoundedPeriodSearch({ agent_id: 'reporting-agent', goal: 'Summarize leads of this week' }, 'search_leads', { created_after: '2026-09-14T00:00:00Z', created_before: '2026-09-21T00:00:00Z' })).toBeNull()
    expect(requireBoundedPeriodSearch({ agent_id: 'reporting-agent', goal: 'Summarize all leads' }, 'search_leads', {})).toBeNull()
    expect(requireBoundedPeriodSearch({ agent_id: 'reporting-agent', goal: 'Summarize leads of this week' }, 'get_lead', {})).toBeNull()
  })

  it('does not police non-reporting agents even for period goals', () => {
    expect(requireBoundedPeriodSearch({ agent_id: 'admissions-followup', goal: 'leads of this week' }, 'search_leads', {})).toBeNull()
  })})

describe('agent runtime — approval protocol (9.6)', () => {
  it('suspends for approval, executes on approval, and stays fully traceable', async () => {
    const store = new MemoryAgentStore()
    const model = new FakeAgentModel([{ calls: [{ name: 'make_draft', args: { text: 'first-touch email' } }] }])
    const deps = makeDeps({ store, model, dryRunEmail: false }) // real-send mode → approval required

    const suspended = await startAgentRun(deps, { agentId: 'test-agent', userId: 'user-1', userRole: 'admissions', goal: GOAL })
    expect(suspended.status).toBe('awaiting_approval')
    expect(suspended.pendingApprovalId).toBeTruthy()

    const approval = await store.getApproval(suspended.pendingApprovalId as string)
    expect(approval?.status).toBe('pending')
    expect(approval?.tool_name).toBe('make_draft')
    expect((await store.getRun(suspended.runId))?.status).toBe('awaiting_approval')

    const decided = await store.decideApproval(approval!.id, 'approved', 'ops-1', 'draft looks fine')
    expect(decided?.status).toBe('approved')

    // Resume with a fresh loop process — the persisted trace reconstructs the conversation.
    const resumeModel = new FakeAgentModel([
      { calls: [{ name: 'finish', args: { summary: 'draft recorded', verification: 'tool result observed' } }] },
    ])
    const resumed = await resumeAgentRun(makeDeps({ store, model: resumeModel, dryRunEmail: false }), {
      runId: suspended.runId,
      approvalId: approval!.id,
    })

    expect(resumed.status).toBe('completed')
    const steps = await store.listSteps(suspended.runId)
    // Two make_draft steps exist: the approval request and the approved execution.
    const draftStep = steps.filter((s) => s.tool_name === 'make_draft').pop()
    expect(draftStep?.status).toBe('success')
    expect(draftStep?.permission_decision).toBe('allowed')
    expect(draftStep?.approval_id).toBe(approval!.id)
    expect((draftStep?.result_summary as { draft_id: string }).draft_id).toBe('draft-first-touch email')
    const finishStep = steps.find((s) => s.tool_name === 'finish')
    expect(finishStep?.status).toBe('success')
  })

  it('rejection records the human decision and the agent re-plans', async () => {
    const store = new MemoryAgentStore()
    const model = new FakeAgentModel([{ calls: [{ name: 'make_draft', args: { text: 'risky draft' } }] }])
    const deps = makeDeps({ store, model, dryRunEmail: false })

    const suspended = await startAgentRun(deps, { agentId: 'test-agent', userId: 'user-1', userRole: 'admissions', goal: GOAL })
    const approval = (await store.getApproval(suspended.pendingApprovalId as string))!
    await store.decideApproval(approval.id, 'rejected', 'ops-1', 'do not email this lead')

    const resumeModel = new FakeAgentModel([
      { calls: [{ name: 'echo', args: { message: 'noted rejection' } }] },
      { calls: [{ name: 'finish', args: { summary: 're-planned after rejection', verification: 'echo observed' } }] },
    ])
    const resumed = await resumeAgentRun(makeDeps({ store, model: resumeModel, dryRunEmail: false }), {
      runId: suspended.runId,
      approvalId: approval.id,
    })

    expect(resumed.status).toBe('completed')
    const steps = await store.listSteps(suspended.runId)
    const rejected = steps.find((s) => s.status === 'rejected')
    expect(rejected?.tool_name).toBe('make_draft')
    expect(
      (rejected?.feedback_snapshot as { response: { result: { reason: string } } }).response.result.reason
    ).toContain('REJECTED_BY_HUMAN')
    // The model saw the rejection and adapted:
    expect(resumeModel.requests[0].contents.some((c) => JSON.stringify(c).includes('REJECTED_BY_HUMAN'))).toBe(true)
  })

  it('refuses to resume through an undecided approval', async () => {
    const store = new MemoryAgentStore()
    const model = new FakeAgentModel([{ calls: [{ name: 'make_draft', args: { text: 'x' } }] }])
    const deps = makeDeps({ store, model, dryRunEmail: false })

    const suspended = await startAgentRun(deps, { agentId: 'test-agent', userId: 'user-1', userRole: 'admissions', goal: GOAL })
    const model2 = new FakeAgentModel([{ calls: [{ name: 'finish', args: { summary: 's', verification: 'v' } }] }])
    const out = await resumeAgentRun(makeDeps({ store, model: model2, dryRunEmail: false }), {
      runId: suspended.runId,
      approvalId: suspended.pendingApprovalId as string,
    })
    expect(out.status).toBe('awaiting_approval')
    expect(out.error).toContain('still pending')
  })
})
