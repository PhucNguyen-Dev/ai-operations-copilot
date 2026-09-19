import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getApiUser } from '@/lib/auth-server'
import { rateLimiter } from '@/lib/rate-limit'
import { createAdminClient } from '@/lib/supabase/admin'
import { dispatchEmail, isBrevoConfigured } from '@/lib/email/dispatch'

// =============================================================
// Human approval gate on AI output (lead detail workspace).
// POST /api/leads/[id]/decisions — record an operator decision on:
//   target 'recommended_action' — the AI's recommended next action
//   target 'email_draft'        — an AI-generated email draft
// Decisions are append-only history (migration 019). The email draft
// body itself is updated on sent_emails for 'edited' decisions so the
// audit trail (decision) and the artifact (draft) stay distinct.
//
// Execution (migration 021): approval EXECUTES.
//   * email_draft + approved → atomic claim (status dry_run) →
//     dispatch via Brevo when configured, honest simulated dispatch
//     when not; outcome persisted on the draft and in the decision
//     note. Idempotent: the second click claims nothing.
//   * recommended_action + approved → follow-up task created from the
//     lead's analysis (HOT → high priority, due tomorrow), so the
//     recommendation enters the operational queue.
// Order of operations: validate → fetch analysis → EXECUTE → record
// decision with the execution outcome folded into decision_note.
// =============================================================

const TARGETS = ['recommended_action', 'email_draft'] as const
const DECISIONS = ['approved', 'rejected', 'edited'] as const

type Target = (typeof TARGETS)[number]
type Decision = (typeof DECISIONS)[number]

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getApiUser(request)
  if ('response' in session) return session.response
  const { userId, role } = session

  const limit = await rateLimiter.check(`lead-decision:${userId}`, 30, 60_000)
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Too many decisions — try again in ${limit.retryAfterSec}s.` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
    )
  }

  const { id } = await params
  const body = (await request.json().catch(() => null)) as {
    target?: unknown
    decision?: unknown
    note?: unknown
    emailId?: unknown
    editedBody?: unknown
  } | null

  const target = TARGETS.find((t) => t === body?.target) as Target | undefined
  const decision = DECISIONS.find((d) => d === body?.decision) as Decision | undefined
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 2000) : null
  if (!target || !decision) {
    return NextResponse.json(
      { error: `Fields "target" (${TARGETS.join('/')}) and "decision" (${DECISIONS.join('/')}) are required` },
      { status: 400 }
    )
  }

  const supabase = await createClient()

  // The operator must see the lead (RLS) AND be accountable for the
  // decision: assigned counselor, operations, or admin.
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('id, assigned_counselor_id')
    .eq('id', id)
    .maybeSingle()
  if (leadError || !lead) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }
  const accountable =
    role === 'admin' || role === 'operations' || lead.assigned_counselor_id === userId
  if (!accountable) {
    return NextResponse.json(
      { error: 'Only the assigned counselor, operations, or admin can decide on this lead' },
      { status: 403 }
    )
  }

  // The lead's latest analysis backs both the recommended-action task
  // creation and the "no recommendation recorded" honesty guard.
  const { data: analysisRow } = await supabase
    .from('lead_analyses')
    .select('recommended_action, category')
    .eq('lead_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const analysis = analysisRow ?? null

  type DraftRow = { id: string; status: string; body: string; to_address: string; subject: string }
  let editedBody: string | null = null
  let emailId: string | null = null
  let draft: DraftRow | null = null
  if (target === 'email_draft') {
    emailId = typeof body?.emailId === 'string' && /^[0-9a-f-]{36}$/i.test(body.emailId) ? body.emailId : null
    if (!emailId) return NextResponse.json({ error: 'Field "emailId" is required for email_draft decisions' }, { status: 400 })
    // Draft context is needed for edit validation AND dispatch.
    const { data: draftRow, error: draftError } = await supabase
      .from('sent_emails')
      .select('id, status, body, to_address, subject')
      .eq('id', emailId)
      .eq('lead_id', id)
      .maybeSingle()
    if (draftError || !draftRow) return NextResponse.json({ error: 'Email draft not found' }, { status: 404 })
    draft = draftRow as DraftRow
    if (decision === 'edited') {
      editedBody = typeof body?.editedBody === 'string' ? body.editedBody : null
      if (!editedBody || editedBody.trim().length === 0 || editedBody.length > 20_000) {
        return NextResponse.json({ error: 'Field "editedBody" is required (1-20000 chars) when editing a draft' }, { status: 400 })
      }
      // Only dry-run drafts are editable — a sent email is immutable history.
      if (draft.status !== 'dry_run') {
        return NextResponse.json({ error: 'Only dry-run drafts can be edited — sent emails are immutable' }, { status: 409 })
      }
    }
  }

  // ---- EXECUTION: approval closes the loop (migration 021) ----
  let execution: string | null = null

  if (decision === 'approved' && target === 'email_draft' && draft && emailId) {
    if (draft.status !== 'dry_run') {
      execution = 'Draft was already dispatched (or is no longer pending) — decision recorded.'
    } else {
      // Atomic claim via the admin client (service role): only one
      // caller can move dry_run → 'failed dispatch in progress'; the
      // loser of the race gets zero rows and reports honestly.
      const admin = createAdminClient()
      const { data: claimed, error: claimError } = await admin
        .from('sent_emails')
        .update({ status: 'failed', dispatch_error: 'dispatch in progress' })
        .eq('id', emailId)
        .eq('status', 'dry_run')
        .select('id, to_address, subject, body')
        .single()
      if (claimError || !claimed) {
        execution = 'Draft was already dispatched by another operator — decision recorded.'
      } else {
        const outcome = await dispatchEmail({
          to: claimed.to_address as string,
          subject: claimed.subject as string,
          body: claimed.body as string,
        })
        const now = new Date().toISOString()
        if (outcome.kind === 'sent') {
          const { error: sentError } = await admin
            .from('sent_emails')
            .update({
              status: 'sent',
              dispatched_at: now,
              dispatched_by: userId,
              dispatch_error: null,
              provider_message_id: outcome.providerMessageId,
            })
            .eq('id', emailId)
          execution = sentError
            ? 'Dispatched via Brevo but the delivery state could not be saved — check the audit log.'
            : `Sent via Brevo to ${claimed.to_address} (message ${outcome.providerMessageId}).`
          if (sentError) console.error('[lead-decisions] sent-state persist failed:', sentError.message)
        } else if (outcome.kind === 'sent_simulated') {
          const { error: simError } = await admin
            .from('sent_emails')
            .update({ status: 'sent_simulated', dispatched_at: now, dispatched_by: userId, dispatch_error: null })
            .eq('id', emailId)
          execution = simError
            ? 'Simulated dispatch recorded but the state could not be saved.'
            : `Dispatched (simulated) to ${claimed.to_address} — ${outcome.note}.`
          if (simError) console.error('[lead-decisions] simulated-state persist failed:', simError.message)
        } else {
          await admin
            .from('sent_emails')
            .update({ status: 'failed', dispatched_at: now, dispatched_by: userId, dispatch_error: outcome.error })
            .eq('id', emailId)
          execution = `Dispatch failed: ${outcome.error}${outcome.retryable ? ' (retryable)' : ''}`
        }
      }
    }
  }

  if (decision === 'approved' && target === 'recommended_action') {
    if (analysis?.recommended_action) {
      // The approved recommendation becomes an operational task —
      // HOT leads get high priority; due tomorrow (near-term nudge).
      // Written via the service client per the platform trust model:
      // tasks are deterministic pipeline writes (no authenticated-user
      // insert policy exists, by design). Assigned to the lead's
      // counselor when one exists, otherwise to the deciding operator;
      // created_by records the human decision (text column).
      const taskTitle = analysis.recommended_action.slice(0, 120)
      const due = new Date(Date.now() + 86_400_000).toISOString()
      const admin = createAdminClient()
      const { error: taskError } = await admin.from('tasks').insert({
        lead_id: id,
        title: taskTitle,
        details: 'Created from approved AI recommended action (decision audit trail).',
        priority: analysis.category === 'HOT' ? 'high' : 'medium',
        status: 'pending',
        due_at: due,
        assigned_counselor_id: lead.assigned_counselor_id ?? userId,
        created_by: userId,
      })
      if (taskError) {
        console.error('[lead-decisions] task creation failed:', taskError.message)
        execution = 'Approval recorded but the follow-up task could not be created — see logs.'
      } else {
        execution = `Follow-up task created (${analysis.category === 'HOT' ? 'high' : 'medium'} priority, due tomorrow).`
      }
    } else {
      execution = 'No AI recommendation recorded for this lead — approval had nothing to execute.'
    }
  }

  // Append-only decision record — the execution outcome is folded into
  // decision_note so the audit trail tells the whole story in one row.
  const finalNote = [note, execution].filter(Boolean).join(' — ') || null
  const { data: recorded, error: insertError } = await supabase
    .from('lead_action_decisions')
    .insert({ lead_id: id, target, decision, decision_note: finalNote, decided_by: userId, email_id: emailId })
    .select('id, created_at')
    .single()
  if (insertError || !recorded) {
    console.error('[lead-decisions] insert failed:', insertError?.message)
    return NextResponse.json(
      { error: 'The action executed but the decision record failed — check the audit log.' },
      { status: 500 }
    )
  }

  return NextResponse.json(
    {
      ok: true,
      decisionId: recorded.id as string,
      decidedAt: recorded.created_at as string,
      execution,
      brevoConfigured: isBrevoConfigured(),
    },
    { status: 201 }
  )
}
