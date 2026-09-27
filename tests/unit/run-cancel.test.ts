import { describe, expect, it } from 'vitest'
import { startAgentRun, resumeAgentRun, type RuntimeDeps } from '@/lib/agent/runtime'
import type { AgentModel, AgentTurnOutput } from '@/lib/agent/model'
import { FakeAgentModel, MemoryAgentStore, TEST_AGENTS, TEST_TOOLS } from './helpers/agent-test-kit'

// =============================================================
// Migration 024 — cancellation. The property under test is not "a stop
// button works": it is that a stop is enforced by the platform at every
// boundary that could still cause a side effect, that a stopped run
// stays stopped, and that the trace tells the truth about what ran
// before the stop.
// =============================================================

const GOAL = 'Review lead L1 and take the appropriate next action'

function depsFor(store: MemoryAgentStore, model: AgentModel, extra: Partial<RuntimeDeps> = {}): RuntimeDeps {
  return {
    store,
    model,
    userClient: null as unknown as RuntimeDeps['userClient'],
    adminClient: null as unknown as RuntimeDeps['adminClient'],
    tools: TEST_TOOLS,
    agents: TEST_AGENTS,
    dryRunEmail: true,
    // Tests flip the flag themselves; a fast poll keeps the mid-turn abort
    // case quick without making the assertion depend on real timing.
    cancelPollMs: 5,
    ...extra,
  }
}

const onlyRunId = (store: MemoryAgentStore) => [...store.runs.keys()][0]

const START = { agentId: 'test-agent', userId: 'user-1', userRole: 'admissions', goal: GOAL }

describe('run cancellation (migration 024)', () => {
  it('stops a running run at the next tool boundary once the flag is set', async () => {
    const store = new MemoryAgentStore()
    const inner = new FakeAgentModel([
      { calls: [{ name: 'echo', args: { message: 'observe lead' } }] },
      { calls: [{ name: 'finish', args: { summary: 'should never run', verification: 'none' } }] },
    ])
    let turns = 0
    const model: AgentModel = {
      async turn(req) {
        turns += 1
        // The stop lands while turn 2 is in flight: the barrier before
        // turn 2 has already passed, so only the per-tool check can catch
        // it — which is exactly the boundary that matters.
        if (turns === 2) await store.requestCancel(onlyRunId(store), 'ops-1')
        return inner.turn(req)
      },
    }

    const out = await startAgentRun(depsFor(store, model), START)

    expect(out.status).toBe('cancelled')
    expect(out.error).toMatch(/^CANCELLED/)
    const run = await store.getRun(out.runId)
    expect(run?.status).toBe('cancelled')
    expect(run?.cancelled_by).toBe('ops-1')
    expect(run?.completed_at).toBeTruthy()
    // Tokens already spent by a stopped run stay visible in the audit.
    expect(run?.tokens_in).toBeGreaterThan(0)

    // The model asked to finish; the platform refused to execute it.
    const steps = await store.listSteps(out.runId)
    expect(steps.map((s) => s.tool_name)).toEqual(['echo', null])
    const cancelStep = steps[steps.length - 1]
    expect(cancelStep.kind).toBe('system')
    expect(cancelStep.status).toBe('skipped')
    expect(cancelStep.error).toMatch(/CANCELLED/)
    expect(cancelStep.result_summary).toMatchObject({ cancelled: true, cancelled_by: 'ops-1' })
  })

  it('cancels before spending anything when the flag is already set', async () => {
    class AlreadyStopped extends MemoryAgentStore {
      async isCancelRequested(): Promise<boolean> {
        return true
      }
    }
    const store = new AlreadyStopped()
    const model = new FakeAgentModel([{ calls: [{ name: 'echo', args: { message: 'never' } }] }])

    const out = await startAgentRun(depsFor(store, model), START)

    expect(out.status).toBe('cancelled')
    // No model call at all — a stop that arrives first costs nothing.
    expect((model as FakeAgentModel).requests).toHaveLength(0)
    const steps = await store.listSteps(out.runId)
    expect(steps).toHaveLength(1)
    expect(steps[0]).toMatchObject({ kind: 'system', status: 'skipped' })
  })

  it('aborts an in-flight model call and records it as a stop, not a provider failure', async () => {
    const store = new MemoryAgentStore()
    let abortedMidCall = false
    const model: AgentModel = {
      async turn(req): Promise<AgentTurnOutput> {
        const runId = onlyRunId(store)
        await store.requestCancel(runId, 'ops-1')
        if (!req.signal) throw new Error('the runtime must pass an abort signal to the model')
        await new Promise<void>((resolve) => {
          if (req.signal!.aborted) return resolve()
          req.signal!.addEventListener('abort', () => {
            abortedMidCall = true
            resolve()
          })
        })
        // Exactly what the adapter returns when a caller aborts it.
        return { ok: false, error: 'AI_ABORTED: the caller cancelled this request', retryable: false, durationMs: 5 }
      },
    }

    const out = await startAgentRun(depsFor(store, model), START)

    expect(abortedMidCall).toBe(true)
    expect(out.status).toBe('cancelled')
    const steps = await store.listSteps(out.runId)
    expect(steps.some((s) => (s.error ?? '').includes('MODEL_TURN_FAILED'))).toBe(false)
    expect(steps[steps.length - 1]).toMatchObject({ kind: 'system', status: 'skipped' })
    expect(steps[steps.length - 1].error).toMatch(/CANCELLED/)
  })

  it('ends a suspended run, withdraws its approval, and refuses to resume it', async () => {
    const store = new MemoryAgentStore()
    const model = new FakeAgentModel([{ calls: [{ name: 'make_draft', args: { text: 'follow up' } }] }])
    const deps = depsFor(store, model, { dryRunEmail: false })

    const suspended = await startAgentRun(deps, START)
    expect(suspended.status).toBe('awaiting_approval')
    const approvalId = suspended.pendingApprovalId!

    const cancel = await store.requestCancel(suspended.runId, 'ops-1')
    expect(cancel).toMatchObject({ claimed: true, status: 'cancelled', closedApprovalId: approvalId })

    const run = await store.getRun(suspended.runId)
    expect(run?.status).toBe('cancelled')
    expect(run?.approval_wait_started_at).toBeNull()

    const approval = await store.getApproval(approvalId)
    expect(approval?.status).toBe('rejected')
    expect(approval?.decision_note).toMatch(/cancelled/i)

    // A second stop request is an answer, not a second write.
    const repeat = await store.requestCancel(suspended.runId, 'ops-1')
    expect(repeat).toMatchObject({ claimed: false, status: 'cancelled', cancelRequested: true })

    // An approve click arriving after the stop must not resurrect the run:
    // the decision is refused, resume refuses, and no model call happens.
    expect(await store.decideApproval(approvalId, 'approved', 'ops-2', null)).toBeNull()
    const resumed = await resumeAgentRun(deps, { runId: suspended.runId, approvalId })
    expect(resumed.status).toBe('cancelled')
    expect(resumed.error).toMatch(/CANCELLED/)
    expect((model as FakeAgentModel).requests).toHaveLength(1)

    const steps = await store.listSteps(suspended.runId)
    expect(steps.filter((s) => s.tool_name === 'make_draft' && s.status === 'success')).toHaveLength(0)
  })

  it('reports a terminal run instead of rewriting it', async () => {
    const store = new MemoryAgentStore()
    const model = new FakeAgentModel([
      { calls: [{ name: 'finish', args: { summary: 'already done', verification: 'echo observed' } }] },
    ])
    const out = await startAgentRun(depsFor(store, model), START)
    expect(out.status).toBe('completed')

    const cancel = await store.requestCancel(out.runId, 'ops-1')
    expect(cancel).toMatchObject({ claimed: false, status: 'completed', cancelRequested: false })

    const run = await store.getRun(out.runId)
    expect(run?.status).toBe('completed')
    expect(run?.cancel_requested_at).toBeFalsy()
    expect(run?.completed_at).toBeTruthy()
  })

  it('keeps the kill switch as the reported cause when a run trips both controls', async () => {
    class Stopped extends MemoryAgentStore {
      async isCancelRequested(): Promise<boolean> {
        return true
      }
    }
    const store = new Stopped()
    store.killSwitch = true
    const model = new FakeAgentModel([{ calls: [{ name: 'echo', args: { message: 'never' } }] }])

    const out = await startAgentRun(depsFor(store, model), START)

    expect(out.status).toBe('failed')
    expect(out.error).toMatch(/KILL_SWITCH/)
    expect((model as FakeAgentModel).requests).toHaveLength(0)
  })
})
