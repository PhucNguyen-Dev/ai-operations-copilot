import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyEnvelope } from '@/lib/webhook-signing'
import { rateLimiter } from '@/lib/rate-limit'
import { enqueueTriage, firstAdminId, runTriageJob, startTriageRun, type TriageDeps } from '@/lib/lead-intake'
import { SupabaseAgentStateStore } from '@/lib/agent/store'
import { geminiAgentModel } from '@/lib/agent/model'

/** Agent-runtime deps for system-triggered triage (webhook is trusted infra, admin principal). */
function triageDeps(admin: ReturnType<typeof createAdminClient>): TriageDeps {
  return {
    admin,
    store: new SupabaseAgentStateStore(admin),
    model: geminiAgentModel,
    dryRunEmail: process.env.GMAIL_AGENT_DRY_RUN !== 'false',
  }
}

// =============================================================
// 9.11 — Real lead trigger. Source-agnostic webhook intake for
// external lead sources (Facebook Lead Ads, Zalo, partners, ...):
//
//   auth (static secret + HMAC signature + replay window, R-04 scheme)
//   → payload normalization (per-source field aliases)
//   → validation (same contract as the n8n pipeline intake)
//   → idempotency (unique (source, external_key) — re-delivery is a
//     200 duplicate ack, never a second lead or a second run)
//   → durable intake (migration 023): the lead insert is the commit
//     point; counselor assignment + governed triage are enqueued as an
//     outbox job with bounded retries — a crash after the commit can
//     no longer lose the downstream work (no more fire-and-forget)
//
// System-triggered runs use the admin principal: this webhook is
// trusted infrastructure gated by the shared secret, the same trust
// model as the n8n pipeline. Every run is fully traced in agent_runs.
// =============================================================

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Field aliases across common lead sources → our lead shape. */
const FIELD_ALIASES: Record<string, string[]> = {
  name: ['name', 'full_name', 'fullname', 'contact_name'],
  email: ['email', 'email_address', 'e_mail'],
  phone: ['phone', 'phone_number', 'tel'],
  course_interest: ['course_interest', 'course', 'program', 'program_interest'],
  budget: ['budget', 'budget_range'],
  timeline: ['timeline', 'start_when', 'expected_start'],
  message: ['message', 'body', 'notes', 'comment', 'questions'],
}

function normalizeLead(payload: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {}
  const walk = (obj: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v)) {
        // Facebook Lead Ads shape: [{ name, values: [...] }] — flatten
        // each entry to key = name, value = first value.
        for (const item of v) {
          if (item && typeof item === 'object' && !Array.isArray(item) && typeof (item as { name?: unknown }).name === 'string') {
            const values = (item as { values?: unknown[] }).values
            const value = Array.isArray(values) ? values[0] : undefined
            const key = String((item as { name: string }).name).toLowerCase()
            if (!(key in flat) && typeof value === 'string') flat[key] = value
          } else if (item && typeof item === 'object') {
            walk(item as Record<string, unknown>)
          }
        }
      } else if (v !== null && typeof v === 'object') {
        walk(v as Record<string, unknown>)
      } else if (!(k.toLowerCase() in flat)) {
        flat[k.toLowerCase()] = v
      }
    }
  }
  walk(payload)

  const lead: Record<string, unknown> = {}
  for (const [target, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      const v = flat[alias]
      if (typeof v === 'string' && v.trim()) {
        lead[target] = v.trim()
        break
      }
    }
  }
  return lead
}

export async function POST(request: NextRequest) {
  const secret = process.env.LEAD_WEBHOOK_SECRET ?? process.env.N8N_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Lead webhook is not configured (missing secret).' }, { status: 500 })
  }

  const envelope = (await request.json().catch(() => null)) as {
    timestamp?: unknown
    signature?: unknown
    payload?: Record<string, unknown>
  } | null
  if (!envelope) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  // Layer 1+2: static secret header AND HMAC signature (R-04 scheme,
  // identical to the n8n intake — tamper evidence + replay window).
  if (request.headers.get('x-webhook-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const verified = await verifyEnvelope(envelope, secret)
  if (!verified.ok) {
    console.error(`[lead-webhook] signature rejected: ${verified.reason}`)
    return NextResponse.json({ error: `Webhook verification failed (${verified.reason})` }, { status: 401 })
  }

  const payload = envelope.payload ?? {}
  const source = typeof payload.source === 'string' && payload.source.trim() ? payload.source.trim().slice(0, 50) : 'webhook'
  const externalKey = typeof payload.external_id === 'string' || typeof payload.external_id === 'number'
    ? String(payload.external_id).slice(0, 200)
    : ''
  if (!externalKey) {
    return NextResponse.json({ error: 'Field "external_id" is required (the source system\'s stable lead id) — it is the idempotency key' }, { status: 422 })
  }

  const limit = await rateLimiter.check(`lead-webhook:${source}`, 60, 60_000)
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Rate limit exceeded — retry after ${limit.retryAfterSec}s` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
    )
  }

  const lead = normalizeLead(payload)
  if (typeof lead.name !== 'string' || !lead.name || typeof lead.email !== 'string' || !EMAIL_RE.test(lead.email)) {
    return NextResponse.json({ error: 'Fields "name" and a valid "email" are required after normalization' }, { status: 422 })
  }

  const admin = createAdminClient()

  // --- idempotency: an existing (source, external_key) is a re-delivery ---
  const { data: existing } = await admin
    .from('leads')
    .select('id')
    .eq('source', source)
    .eq('external_key', externalKey)
    .limit(1)
  if (existing?.length) {
    return NextResponse.json({ accepted: true, duplicate: true, leadId: existing[0].id as string }, { status: 200 })
  }

  const { data: inserted, error: insertError } = await admin
    .from('leads')
    .insert({
      name: lead.name as string,
      email: lead.email as string,
      phone: (lead.phone as string) ?? null,
      source,
      course_interest: (lead.course_interest as string) ?? null,
      budget: (lead.budget as string) ?? null,
      timeline: (lead.timeline as string) ?? null,
      message: (lead.message as string) ?? null,
      external_key: externalKey,
    })
    .select('id')
    .single()
  if (insertError) {
    // Unique-violation race (two concurrent deliveries): treat as duplicate.
    if (insertError.code === '23505') {
      const { data: raced } = await admin.from('leads').select('id').eq('source', source).eq('external_key', externalKey).limit(1)
      return NextResponse.json({ accepted: true, duplicate: true, leadId: raced?.[0]?.id ?? null }, { status: 200 })
    }
    console.error('[lead-webhook] lead insert failed:', insertError.message)
    return NextResponse.json({ error: 'Could not store the lead' }, { status: 500 })
  }
  const leadId = inserted.id as string

  // --- durable intake: enqueue the downstream work as an outbox job
  // (migration 023). The lead commit is the commit point; the job is
  // retried with bounded backoff and dead-letters visibly on permanent
  // failure — a crash here can no longer lose assignment or triage. ---
  try {
    await enqueueTriage(admin, leadId)
  } catch (e) {
    // Same-burst repair: the processing loop's sweep (below) will not
    // catch this lead until its next run, so attempt the downstream
    // work inline best-effort — identical outcome to the old
    // fire-and-forget, plus the outbox row for the next sweep.
    console.error('[lead-webhook] outbox enqueue failed (lead is committed; downstream degraded):', e)
    const adminId = await firstAdminId(admin)
    void startTriageRun(triageDeps(admin), {
      leadId,
      leadName: lead.name as string,
      source,
      userId: process.env.AGENT_SYSTEM_USER_ID ?? adminId ?? '00000000-0000-0000-0000-000000000000',
    }).catch((e2) => console.error('[lead-webhook] inline degraded triage failed:', e2))
    return NextResponse.json({ accepted: true, duplicate: false, leadId, agentTriage: 'degraded_inline' }, { status: 202 })
  }

  // Same-burst processing: attempt the job immediately (latency parity
  // with the old inline path). Success → 202 with agentTriage: 'started';
  // failure → the job stays pending with attempts=1 and the worker's
  // backoff retries it — either way the work is durable.
  const { processOutbox } = await import('@/lib/lead-intake')
  let triageState: 'started' | 'queued' = 'queued'
  try {
    const claimed = await processOutbox(admin, (job) => runTriageJob(admin, job, triageDeps(admin)))
    if (claimed > 0) triageState = 'started'
  } catch (e) {
    console.error('[lead-webhook] same-burst outbox processing failed (job stays pending for the worker):', e)
  }

  return NextResponse.json({ accepted: true, duplicate: false, leadId, agentTriage: triageState }, { status: 202 })
}
