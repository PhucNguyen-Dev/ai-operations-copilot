import type { ToolContext, ToolDefinition, ToolOutcome } from '@/lib/agent/types'
import type { ValidationResult } from '@/lib/gemini'
import { isNonEmptyStr, loadVisibleLead } from '@/lib/agent/tools/crm'

// =============================================================
// prepare_email — the 9.6 approval demonstration tool.
// It RECORDS a first-touch email draft on the lead (the same
// sent_emails table the n8n pipeline uses) and never sends: real
// sending stays with the approved n8n pipeline (GMAIL_DRY_RUN).
//
// Approval policy: in dry-run mode (default) recording is allowed
// without human approval. When real-send mode is configured
// (GMAIL_AGENT_DRY_RUN=false) recording requires human approval of the
// exact draft — riskLevel external_side_effect makes that mandatory.
// =============================================================

const NAME = 'admissions-followup'

export type PrepareEmailArgs = { lead_id: string; subject: string; body: string }
export type PrepareEmailResult = { email_id: string; to_address: string; status: 'dry_run' }

export function validateEmailArgs(args: unknown): ValidationResult<PrepareEmailArgs> {
  const a = (args ?? {}) as Partial<PrepareEmailArgs>
  const errors: string[] = []
  if (!isNonEmptyStr(a.lead_id, 64)) errors.push('lead_id is required')
  if (!isNonEmptyStr(a.subject, 200)) errors.push('subject is required (1-200 chars)')
  if (!isNonEmptyStr(a.body, 5000)) errors.push('body is required (1-5000 chars)')
  if (errors.length) return { ok: false, errors }
  return { ok: true, data: { lead_id: a.lead_id as string, subject: a.subject as string, body: a.body as string } }
}

export const prepareEmailTool: ToolDefinition<PrepareEmailArgs, PrepareEmailResult> = {
  name: 'prepare_email',
  version: '1.0.0',
  description:
    'Prepare a first-touch email draft for a lead you can see and record it (dry-run record only — it is NOT sent; real sends go through the approved pipeline). Include the course name; never promise discounts or admission.',
  riskLevel: 'external_side_effect',
  allowedAgents: [NAME],
  allowedRoles: ['admissions'],
  parameters: {
    type: 'object',
    properties: {
      lead_id: { type: 'string', description: 'Lead id (uuid)' },
      subject: { type: 'string', description: 'Email subject, 1-200 chars' },
      body: { type: 'string', description: 'Email body, 1-5000 chars' },
    },
    required: ['lead_id', 'subject', 'body'],
  },
  validateInput: validateEmailArgs,
  validateOutput: (v) => {
    const r = (v ?? {}) as Record<string, unknown>
    if (typeof r.email_id !== 'string' || typeof r.to_address !== 'string') {
      return { ok: false, errors: ['result must include email_id and to_address'] }
    }
    return { ok: true, data: r as PrepareEmailResult }
  },
  timeoutMs: 10_000,
  idempotency: 'non_idempotent',
  requiresApproval: (_args, ctx: ToolContext) => !ctx.dryRunEmail,
  async checkResource(ctx, args) {
    const visible = await loadVisibleLead(ctx.userClient, args.lead_id)
    return visible.ok ? { ok: true } : { ok: false, reason: visible.error }
  },
  async execute(ctx, args): Promise<ToolOutcome<PrepareEmailResult>> {
    const visible = await loadVisibleLead(ctx.userClient, args.lead_id)
    if (!visible.ok) return { ok: false, error: visible.error, retryable: false }
    const { data, error } = await ctx.adminClient
      .from('sent_emails')
      .insert({
        lead_id: args.lead_id,
        to_address: visible.lead.email as string,
        subject: args.subject,
        body: args.body,
        status: 'dry_run',
        created_by: `agent:${ctx.agentId}`,
      })
      .select('id')
      .single()
    if (error) return { ok: false, error: `email record insert failed: ${error.message}`, retryable: false }
    return {
      ok: true,
      result: { email_id: data.id as string, to_address: visible.lead.email as string, status: 'dry_run' },
    }
  },
}

export const COMMS_TOOLS = [prepareEmailTool]
