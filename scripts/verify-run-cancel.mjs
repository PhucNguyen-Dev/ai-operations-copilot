#!/usr/bin/env node
// =============================================================
// Migration 024 acceptance check — the REAL request_agent_run_cancel
// RPC, against the real database, not a fake.
//
// The unit tests prove the runtime's behavior against a memory store
// that mirrors this RPC's contract; they cannot prove the SQL. This
// script runs the actual function and asserts what the migration
// promises:
//
//   1. a stop request is claimed on a suspended run;
//   2. the run becomes terminal 'cancelled' in the same transaction;
//   3. its pending approval is withdrawn as 'rejected' with a reason —
//      the guarantee that "cancel then approve" cannot execute;
//   4. a repeat request is answered, not re-written (idempotent);
//   5. a terminal run is reported, not rewritten.
//
// Scope discipline: it creates its OWN rows (a synthetic run + approval)
// and deletes them at the end, leaving nothing behind. It touches no
// existing run, approval or lead.
//
//   node scripts/verify-run-cancel.mjs
//
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (from
// .env or the environment) and migration 024 applied.
// =============================================================
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnv() {
  const env = {}
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const eq = line.indexOf('=')
      if (eq > 0 && !env[line.slice(0, eq).trim()]) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
    }
  } catch {
    /* no .env — rely on process env */
  }
  return env
}

const ENV = loadEnv()
if (!ENV.NEXT_PUBLIC_SUPABASE_URL || !ENV.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — cannot reach the database.')
  process.exit(1)
}
const REST = `${ENV.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, '')}/rest/v1`
const SVC = {
  apikey: ENV.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
}

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok })
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function svc(path, init = {}) {
  const res = await fetch(`${REST}/${path}`, { headers: SVC, ...init })
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`)
  return body
}

const createdRuns = []

async function makeRun(label, { suspended }) {
  const profiles = await svc('profiles?select=id&limit=2')
  if (!profiles?.length) throw new Error('no profiles in the database — seed users first (npm run seed:users)')
  const requester = profiles[0].id
  const actor = profiles[1]?.id ?? requester

  const runs = await svc('agent_runs', {
    method: 'POST',
    headers: { ...SVC, Prefer: 'return=representation' },
    body: JSON.stringify({
      agent_id: '__verify_run_cancel__',
      user_id: requester,
      user_role: 'admin',
      goal: label,
      status: suspended ? 'awaiting_approval' : 'completed',
      max_steps: 4,
      step_count: 0,
    }),
  })
  const run = runs[0]
  createdRuns.push(run.id)

  let approval = null
  if (suspended) {
    const approvals = await svc('agent_approvals', {
      method: 'POST',
      headers: { ...SVC, Prefer: 'return=representation' },
      body: JSON.stringify({
        run_id: run.id,
        tool_name: 'prepare_email',
        args_snapshot: { to: 'verify@example.invalid' },
        status: 'pending',
        requested_by: requester,
      }),
    })
    approval = approvals[0]
    await svc(`agent_runs?id=eq.${run.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        pending_approval_id: approval.id,
        approval_wait_started_at: new Date(Date.now() - 5_000).toISOString(),
      }),
    })
  }

  return { runId: run.id, approvalId: approval?.id ?? null, requester, actor }
}

const cancel = (runId, actor) =>
  svc('rpc/request_agent_run_cancel', { method: 'POST', body: JSON.stringify({ p_run_id: runId, p_actor: actor }) })

const runRow = async (id) => (await svc(`agent_runs?id=eq.${id}&select=*`))[0]
const approvalRow = async (id) => (await svc(`agent_approvals?id=eq.${id}&select=*`))[0]

console.log('Migration 024 — request_agent_run_cancel acceptance check\n')

try {
  console.log('Case 1: a suspended run is ended, and its approval withdrawn')
  const suspended = await makeRun('__verify_run_cancel__ suspended', { suspended: true })
  const first = await cancel(suspended.runId, suspended.actor)

  check('request claimed', first?.claimed === true, JSON.stringify(first))
  check('run reported cancelled', first?.status === 'cancelled', `status=${first?.status}`)
  check('closed approval returned', first?.closedApprovalId === suspended.approvalId)

  const run = await runRow(suspended.runId)
  check('run row is terminal cancelled', run?.status === 'cancelled', `status=${run?.status}`)
  check('stop is attributed', run?.cancelled_by === suspended.actor)
  check('stop timestamp recorded', Boolean(run?.cancel_requested_at))
  check('approval wait is closed out', run?.approval_wait_started_at === null)
  check('approval wait time accumulated', Number(run?.approval_wait_ms ?? 0) > 0, `${run?.approval_wait_ms}ms`)
  check('run error states the stop', String(run?.error ?? '').startsWith('CANCELLED:'), String(run?.error ?? ''))

  const approval = await approvalRow(suspended.approvalId)
  check('pending approval withdrawn (rejected)', approval?.status === 'rejected', `status=${approval?.status}`)
  check('withdrawal carries a reason', /cancelled/i.test(approval?.decision_note ?? ''), String(approval?.decision_note ?? ''))
  check('withdrawal records the decider', approval?.decided_by === suspended.actor)

  console.log('\nCase 2: a repeat request is answered, never rewritten')
  const second = await cancel(suspended.runId, suspended.actor)
  check('repeat request not claimed', second?.claimed === false)
  check('repeat request reports the stop exists', second?.cancelRequested === true)
  check('repeat request reports cancelled', second?.status === 'cancelled', `status=${second?.status}`)

  console.log('\nCase 3: the approval claim refuses a cancelled run')
  // claim_agent_approval is the other half of the guarantee: even if a
  // stale client decided this approval, the claim requires the run to
  // still be awaiting approval.
  const claimed = await svc('rpc/claim_agent_approval', {
    method: 'POST',
    body: JSON.stringify({ p_run_id: suspended.runId, p_approval_id: suspended.approvalId }),
  })
  check('claim_agent_approval returns null for a cancelled run', claimed === null || claimed === undefined, JSON.stringify(claimed))

  console.log('\nCase 4: an already-terminal run is reported, not rewritten')
  const done = await makeRun('__verify_run_cancel__ completed', { suspended: false })
  const terminal = await cancel(done.runId, done.actor)
  check('terminal run not claimed', terminal?.claimed === false, JSON.stringify(terminal))
  check('terminal run keeps its status', terminal?.status === 'completed', `status=${terminal?.status}`)
  const doneRow = await runRow(done.runId)
  check('terminal run untouched', doneRow?.status === 'completed' && !doneRow?.cancel_requested_at)
} finally {
  // Self-cleaning: only the rows this script created (cascade removes the
  // approval). A failure above must not leave synthetic runs behind.
  for (const id of createdRuns) {
    try {
      await svc(`agent_runs?id=eq.${id}`, { method: 'DELETE' })
    } catch (e) {
      console.error(`  (cleanup) could not delete run ${id}: ${e instanceof Error ? e.message : e}`)
    }
  }
  console.log(`\nCleanup: removed ${createdRuns.length} synthetic run(s) (and their approvals via cascade).`)
}

const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`)
process.exit(failed.length ? 1 : 0)
