import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  enqueueTriage,
  processOutbox,
  runTriageJob,
  triageGoal,
  type OutboxJob,
  type TriageDeps,
} from '@/lib/lead-intake'
import { rateLimitFailMode } from '@/lib/rate-limit'

// =============================================================
// Durable lead intake (migration 023): enqueue idempotency, atomic
// claim/release mechanics, and the triage job's failure semantics —
// assignment failures retry, a persisted (possibly-executed) triage
// run NEVER retries (a retry would double-act on the lead).
// =============================================================

type Table = { rows: Record<string, unknown>[]; upserts: Record<string, unknown>[] }

/** Chainable fake covering the exact query shapes lead-intake uses. */
function fakeAdmin(tables: Record<string, Table>, rpc: (fn: string, args: Record<string, unknown>) => unknown) {
  const finish = (t: Table) => async () => ({ data: t.rows, error: null })
  return {
    from(name: string) {
      const t = (tables[name] ??= { rows: [], upserts: [] })
      const select = () => ({
        eq: () => ({
          eq: () => ({ limit: finish(t) }),
          order: () => ({ limit: finish(t) }),
          limit: finish(t),
        }),
        order: () => ({ limit: finish(t) }),
        limit: finish(t),
      })
      return {
        select,
        update: () => ({ eq: async () => ({ error: null }) }),
        upsert: async (row: Record<string, unknown>) => {
          t.upserts.push(row)
          return { error: null }
        },
      }
    },
    rpc: async (fn: string, args: Record<string, unknown>) => ({ data: rpc(fn, args), error: null }),
  } as unknown as SupabaseClient
}

const job = (over: Partial<OutboxJob> = {}): OutboxJob => ({
  id: 'job-1',
  lead_id: 'lead-1',
  kind: 'triage',
  status: 'pending',
  attempts: 0,
  max_attempts: 5,
  last_error: null,
  ...over,
})

/** A store fake that lets the run persist, then crashes the loop mid-drive. */
function storeThatCrashesMidDrive(): TriageDeps['store'] {
  return {
    createRun: async () => ({
      id: 'run-1',
      agent_id: 'admissions-followup',
      user_id: 'u',
      user_role: 'admin',
      client_id: null,
      session_id: null,
      goal: 'g',
      status: 'running',
      current_state: {},
      step_count: 0,
      max_steps: 12,
      tokens_in: 0,
      tokens_out: 0,
      final_outcome: null,
      error: null,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
    }),
    listSteps: async () => [],
    getSessionContext: async () => null,
    // Migration 024: the barrier reads the stop flag alongside the kill
    // switch. Both must exist, or the missing one throws before the
    // intended failure does (and the created promise goes unhandled).
    isCancelRequested: async () => false,
    isKillSwitchOn: async () => {
      throw new Error('kill switch boom')
    },
  } as unknown as TriageDeps['store']
}

describe('lead intake enqueue (migration 023)', () => {
  it('upserts one triage job keyed by (lead_id, kind) — idempotent re-enqueue', async () => {
    const tables: Record<string, Table> = {}
    const admin = fakeAdmin(tables, () => null)
    await enqueueTriage(admin, 'lead-abc')
    await enqueueTriage(admin, 'lead-abc')
    expect(tables['lead_intake_outbox']!.upserts).toHaveLength(2)
    for (const row of tables['lead_intake_outbox']!.upserts) {
      expect(row).toMatchObject({ lead_id: 'lead-abc', kind: 'triage' })
    }
    // The upsert (onConflict lead_id,kind) collapses these into one row in Postgres.
  })

  it('propagates enqueue failures — the webhook degrades loudly, never silently', async () => {
    const broken = {
      from: () => ({ upsert: async () => ({ error: { message: 'boom' } }) }),
    } as unknown as SupabaseClient
    await expect(enqueueTriage(broken, 'lead-1')).rejects.toThrow('outbox enqueue failed: boom')
  })
})

describe('outbox processing loop', () => {
  it('claims due jobs, runs the attempt, and releases ok on success', async () => {
    const released: unknown[] = []
    const admin = fakeAdmin({}, (fn, args) => {
      if (fn === 'claim_lead_intake_job') return [job()]
      if (fn === 'release_lead_intake_job') released.push(args)
      return null
    })
    const claimed = await processOutbox(admin, async () => ({ ok: true }))
    expect(claimed).toBe(1)
    expect(released).toEqual([{ p_job_id: 'job-1', p_ok: true, p_error: null, p_retryable: true }])
  })

  it('releases retryable failures so the RPC backoff can reschedule them', async () => {
    const released: unknown[] = []
    const admin = fakeAdmin({}, (fn, args) => {
      if (fn === 'claim_lead_intake_job') return [job({ attempts: 1 })]
      if (fn === 'release_lead_intake_job') released.push(args)
      return null
    })
    await processOutbox(admin, async () => ({ ok: false, error: 'RLS hiccup', retryable: true }))
    expect(released[0]).toMatchObject({ p_ok: false, p_error: 'RLS hiccup', p_retryable: true })
  })

  it('treats a worker crash mid-attempt as retryable (release decides the outcome)', async () => {
    const released: unknown[] = []
    const admin = fakeAdmin({}, (fn, args) => {
      if (fn === 'claim_lead_intake_job') return [job()]
      if (fn === 'release_lead_intake_job') released.push(args)
      return null
    })
    await processOutbox(admin, async () => {
      throw new Error('worker exploded')
    })
    expect(released[0]).toMatchObject({ p_ok: false, p_retryable: true, p_error: expect.stringContaining('worker exploded') })
  })

  it('returns 0 claimed when the queue is empty', async () => {
    const admin = fakeAdmin({}, (fn) => (fn === 'claim_lead_intake_job' ? [] : null))
    expect(await processOutbox(admin, async () => ({ ok: true }))).toBe(0)
  })

  it('processes a full batch and counts every claimed job', async () => {
    const admin = fakeAdmin({}, (fn) => (fn === 'claim_lead_intake_job' ? [job({ id: 'j1' }), job({ id: 'j2' })] : null))
    const seen: string[] = []
    const claimed = await processOutbox(admin, async (j) => {
      seen.push(j.id)
      return { ok: true }
    })
    expect(claimed).toBe(2)
    expect(seen).toEqual(['j1', 'j2'])
  })
})

describe('triage job failure semantics', () => {
  const deps = (over: Partial<TriageDeps> = {}): TriageDeps => ({
    admin: fakeAdmin({}, () => null),
    store: {} as TriageDeps['store'],
    model: {
      turn: async () => {
        throw new Error('no model in unit test')
      },
    },
    dryRunEmail: true,
    ...over,
  })

  it('composes the SOP triage goal with source, id and name', () => {
    expect(triageGoal('lead-1', 'Test Lead', 'facebook')).toContain('[lead-webhook:facebook]')
    expect(triageGoal('lead-1', 'Test Lead', 'facebook')).toContain('lead-1')
  })

  it('NEVER retries a persisted-run crash — a retry would double-act on the lead (dead-letter)', async () => {
    // The run row persists (createRun succeeds), then the loop crashes
    // (kill-switch read explodes). Whether or not the crash happened
    // after a side effect, the platform cannot know — so the only safe
    // answer is dead-letter, not retry.
    const tables: Record<string, Table> = {
      leads: { rows: [{ name: 'Emma', source: 'webhook' }], upserts: [] },
      profiles: { rows: [{ id: 'admin-1' }], upserts: [] },
    }
    const outcome = await runTriageJob(fakeAdmin(tables, () => null), job(), deps({ store: storeThatCrashesMidDrive() }))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.retryable).toBe(false)
  })

  it('retries a failure where NOTHING was persisted (no run row → no side effects)', async () => {
    // createRun itself fails: startAgentRun returns a typed failure with
    // runId '' — the pre-repair bug reported this as done; now it retries.
    const tables: Record<string, Table> = {
      leads: { rows: [{ name: 'Emma', source: 'webhook' }], upserts: [] },
      profiles: { rows: [{ id: 'admin-1' }], upserts: [] },
    }
    const outcome = await runTriageJob(fakeAdmin(tables, () => null), job(), deps({
      store: {
        createRun: async () => {
          throw new Error('persistence unavailable')
        },
      } as unknown as TriageDeps['store'],
    }))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.retryable).toBe(true)
  })
})

describe('rate limiter fail-mode policy (A3)', () => {
  const withEnv = (env: Record<string, string | undefined>, fn: () => void) => {
    const saved: Record<string, string | undefined> = {}
    for (const [k, v] of Object.entries(env)) {
      saved[k] = process.env[k]
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    try {
      fn()
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  }

  it('defaults to closed (cost-bearing endpoints must not become unmetered)', () => {
    withEnv({ RATE_LIMIT_FAIL_MODE: undefined, RATE_LIMIT_FAIL_OPEN_KEYS: undefined }, () => {
      expect(rateLimitFailMode('agent-run:user-1')).toBe('closed')
    })
  })

  it('supports explicit global open mode (historical availability behavior)', () => {
    withEnv({ RATE_LIMIT_FAIL_MODE: 'open' }, () => {
      expect(rateLimitFailMode('agent-run:user-1')).toBe('open')
    })
  })

  it('opts specific key prefixes into open without touching the global default', () => {
    withEnv({ RATE_LIMIT_FAIL_OPEN_KEYS: 'health-read,public-ro' }, () => {
      expect(rateLimitFailMode('public-ro:client-9')).toBe('open')
      expect(rateLimitFailMode('public-ro-client-9')).toBe('open')
      expect(rateLimitFailMode('agent-run:user-1')).toBe('closed')
    })
  })
})
