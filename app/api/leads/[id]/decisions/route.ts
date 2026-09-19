import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getApiUser } from '@/lib/auth-server'
import { rateLimiter } from '@/lib/rate-limit'

// =============================================================
// Human approval gate on AI output (lead detail workspace).
// POST /api/leads/[id]/decisions — record an operator decision on:
//   target 'recommended_action' — the AI's recommended next action
//   target 'email_draft'        — an AI-generated email draft
// Decisions are append-only history (migration 019). The email draft
// body itself is updated on sent_emails for 'edited' decisions so the
// audit trail (decision) and the artifact (draft) stay distinct.
//
// Honest-state rule: approving an email marks it approved, NOT sent —
// the platform has no send path by governance ("Email sent" renders
// only when sent_emails.sent_at actually exists).
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

  let editedBody: string | null = null
  let emailId: string | null = null
  if (target === 'email_draft') {
    emailId = typeof body?.emailId === 'string' && /^[0-9a-f-]{36}$/i.test(body.emailId) ? body.emailId : null
    if (!emailId) return NextResponse.json({ error: 'Field "emailId" is required for email_draft decisions' }, { status: 400 })
    if (decision === 'edited') {
      editedBody = typeof body?.editedBody === 'string' ? body.editedBody : null
      if (!editedBody || editedBody.trim().length === 0 || editedBody.length > 20_000) {
        return NextResponse.json({ error: 'Field "editedBody" is required (1-20000 chars) when editing a draft' }, { status: 400 })
      }
      // Only dry-run drafts are editable — a sent email is immutable history.
      const { data: draft, error: draftError } = await supabase
        .from('sent_emails')
        .select('id, status, body')
        .eq('id', emailId)
        .eq('lead_id', id)
        .maybeSingle()
      if (draftError || !draft) return NextResponse.json({ error: 'Email draft not found' }, { status: 404 })
      if (draft.status !== 'dry_run') {
        return NextResponse.json({ error: 'Only dry-run drafts can be edited — sent emails are immutable' }, { status: 409 })
      }
    }
  }

  // Append-only decision record (email_id binds the decision to the
  // exact draft so multiple drafts gate independently).
  const { data: recorded, error: insertError } = await supabase
    .from('lead_action_decisions')
    .insert({ lead_id: id, target, decision, decision_note: note, decided_by: userId, email_id: emailId })
    .select('id, created_at')
    .single()
  if (insertError || !recorded) {
    console.error('[lead-decisions] insert failed:', insertError?.message)
    return NextResponse.json({ error: 'Could not record the decision' }, { status: 500 })
  }

  // Persist the edited draft body (artifact) after the decision (audit).
  if (decision === 'edited' && emailId && editedBody) {
    const { error: updateError } = await supabase
      .from('sent_emails')
      .update({ body: editedBody })
      .eq('id', emailId)
      .eq('status', 'dry_run')
    if (updateError) {
      console.error('[lead-decisions] draft update failed:', updateError.message)
      return NextResponse.json({ error: 'Decision recorded but the draft could not be updated' }, { status: 500 })
    }
  }

  return NextResponse.json(
    { ok: true, decisionId: recorded.id as string, decidedAt: recorded.created_at as string },
    { status: 201 }
  )
}
