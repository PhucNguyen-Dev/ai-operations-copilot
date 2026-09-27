import { NextRequest, NextResponse } from 'next/server'
import { getApiUser } from '@/lib/auth-server'
import { canViewAutomation } from '@/lib/roles'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimiter } from '@/lib/rate-limit'
import { processOutbox, runTriageJob } from '@/lib/lead-intake'
import { SupabaseAgentStateStore } from '@/lib/agent/store'
import { geminiAgentModel } from '@/lib/agent/model'

// =============================================================
// Lead-intake outbox worker (migration 023). Durability net for the
// lead webhook: claims due triage jobs and runs counselor assignment
// + governed agent triage. The webhook attempts its own job same-burst
// (latency parity); this worker is what makes the guarantee — any job
// the webhook could not finish is retried here with bounded backoff
// and dead-letters visibly instead of vanishing.
//
// Trigger: an ops/admin session (e.g. a machine account) on a short
// cron — the same scheduling pattern as the briefing generator — or
// manually after webhook bursts. Concurrency-safe: concurrent workers
// serialize on claim_lead_intake_job's FOR UPDATE SKIP LOCKED claim.
// =============================================================

const MAX_ROUNDS = 10
const BATCH = 5

export async function POST(request: NextRequest) {
  const session = await getApiUser(request)
  if ('response' in session) return session.response
  const { userId, role } = session

  if (!canViewAutomation(role)) {
    return NextResponse.json(
      { error: `Only Operations/Admin can run the intake worker (your role: ${role}).` },
      { status: 403 }
    )
  }

  const limit = await rateLimiter.check(`intake-worker:${userId}`, 10, 60_000)
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Too many worker invocations — try again in ${limit.retryAfterSec}s.` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
    )
  }

  let admin
  try {
    admin = createAdminClient()
  } catch {
    return NextResponse.json(
      { error: 'Intake worker is not configured on the server (missing service-role key).' },
      { status: 500 }
    )
  }

  // Bounded drain: rounds of claim→process until the queue is empty or
  // the cap is hit (the next cron tick continues; no long-held request).
  let totalClaimed = 0
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const claimed = await processOutbox(
        admin,
        (job) =>
          runTriageJob(admin, job, {
            admin,
            store: new SupabaseAgentStateStore(admin),
            model: geminiAgentModel,
            dryRunEmail: process.env.GMAIL_AGENT_DRY_RUN !== 'false',
          }),
        BATCH
      )
      totalClaimed += claimed
      if (claimed === 0) break
    }
  } catch (e) {
    console.error('[intake-worker] processing failed:', e)
    return NextResponse.json(
      { error: 'The intake worker hit an error mid-drain — claimed jobs stay durable; re-run to continue.' },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true, processed: totalClaimed }, { status: 200 })
}
