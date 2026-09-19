import type { ToolContext, ToolDefinition, ToolOutcome } from '@/lib/agent/types'
import type { ValidationResult } from '@/lib/gemini'

// =============================================================
// CRM tools (9.1 example set) — thin governed wrappers over the
// existing leads/tasks/notifications tables.
//
// Defense in depth for DB access:
//   * READS go through the user's RLS-scoped client — the agent sees
//     exactly what the invoking employee sees (Supabase RLS stays
//     authoritative, 9.5).
//   * WRITES go through the service-role client ONLY after the tool
//     verified resource visibility on the user client (the employee's
//     RLS scope decides WHICH leads are reachable), and only after the
//     permission engine allowed the tool for this agent + role.
// The model supplies intent (lead_id + content); recipients and
// assignees are derived server-side, never from model output.
// =============================================================

const NAME = 'admissions-followup'

// -------------------------------------------------------------
// Shared pure validators (exported for unit tests)
// -------------------------------------------------------------

export function isNonEmptyStr(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max
}

export function validateLeadId(args: unknown): ValidationResult<{ lead_id: string }> {
  const a = (args ?? {}) as { lead_id?: unknown }
  if (!isNonEmptyStr(a.lead_id, 64)) {
    return { ok: false, errors: ['lead_id is required'] }
  }
  return { ok: true, data: { lead_id: a.lead_id } }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

export function validateLeadRecord(v: unknown): ValidationResult<Record<string, unknown>> {
  const r = asRecord(v)
  if (!r) return { ok: false, errors: ['result must be an object'] }
  if (typeof r.id !== 'string' || typeof r.name !== 'string') {
    return { ok: false, errors: ['result must include lead id and name'] }
  }
  return { ok: true, data: r }
}

export function validateLeadList(v: unknown): ValidationResult<{ count: number; leads: Record<string, unknown>[] }> {
  const r = asRecord(v)
  if (!r || !Array.isArray(r.leads)) return { ok: false, errors: ['result must include a leads array'] }
  return { ok: true, data: { count: r.leads.length, leads: r.leads as Record<string, unknown>[] } }
}

// -------------------------------------------------------------
// Resource-visibility helper (the 9.5 resource-level check)
// -------------------------------------------------------------

/**
 * Load a lead the *employee* is allowed to see (RLS does the filtering).
 * Empty result = wrong id OR outside the invoking user's scope — the
 * tool must treat both identically and never fall back to the admin
 * client for reads.
 */
export async function loadVisibleLead(
  ctx: ToolContext,
  leadId: string
): Promise<{ ok: true; lead: Record<string, unknown> } | { ok: false; error: string }> {
  if (ctx.requesterRead) {
    try {
      const lead = await ctx.requesterRead('lead', { lead_id: leadId }) as Record<string, unknown> | null
      return lead ? { ok: true, lead } : { ok: false, error: 'LEAD_NOT_FOUND: no such lead in your visible scope' }
    } catch (e) {
      return { ok: false, error: `LEAD_LOOKUP_UNAVAILABLE: ${String(e)}` }
    }
  }
  const { data, error } = await ctx.userClient
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .limit(1)
  if (error) return { ok: false, error: `lead lookup failed: ${error.message}` }
  const lead = (data ?? [])[0] as Record<string, unknown> | undefined
  if (!lead) return { ok: false, error: 'LEAD_NOT_FOUND: no such lead in your visible scope' }
  return { ok: true, lead }
}

// -------------------------------------------------------------
// get_lead
// -------------------------------------------------------------

export type GetLeadResult = { lead: Record<string, unknown>; analysis: Record<string, unknown> | null }

export const getLeadTool: ToolDefinition<{ lead_id: string }, GetLeadResult> = {
  name: 'get_lead',
  version: '1.0.0',
  description:
    'Load one admissions lead with its latest AI analysis by id. Fails when the id does not exist or the lead is outside your visible scope.',
  riskLevel: 'read',
  allowedAgents: [NAME, 'external-lead-support', 'reporting-agent'],
  allowedRoles: ['admissions', 'external'],
  parameters: {
    type: 'object',
    properties: { lead_id: { type: 'string', description: 'Lead id (uuid)' } },
    required: ['lead_id'],
  },
  validateInput: validateLeadId,
  validateOutput: (v) => {
    const r = asRecord(v)
    if (!r) return { ok: false, errors: ['result must be an object'] }
    return validateLeadRecord(r.lead).ok
      ? { ok: true, data: r as GetLeadResult }
      : { ok: false, errors: ['result must include a lead object'] }
  },
  timeoutMs: 8_000,
  idempotency: 'idempotent',
  async execute(ctx, args): Promise<ToolOutcome<GetLeadResult>> {
    if (ctx.requesterRead) {
      const visible = await loadVisibleLead(ctx, args.lead_id)
      if (!visible.ok) return { ok: false, error: visible.error, retryable: false }
      let analysis = null
      try {
        const rows = await ctx.requesterRead('lead_analyses', { lead_id: args.lead_id }) as Record<string, unknown>[] | null
        analysis = rows?.[0] ?? null
      } catch (e) {
        return { ok: false, error: `lead lookup failed: ${String(e)}`, retryable: false }
      }
      const { analysis: _a, ...lead } = visible.lead
      return { ok: true, result: { lead, analysis } }
    }
    const { data, error } = await ctx.userClient
      .from('leads')
      .select('*, lead_analyses(score, category, intent, summary, recommended_action, created_at)')
      .eq('id', args.lead_id)
      .limit(1)
    if (error) return { ok: false, error: `lead lookup failed: ${error.message}`, retryable: false }
    const row = (data ?? [])[0] as (Record<string, unknown> & { lead_analyses?: Record<string, unknown>[] }) | undefined
    if (!row) return { ok: false, error: 'LEAD_NOT_FOUND: no such lead in your visible scope', retryable: false }
    const { lead_analyses, ...lead } = row
    return {
      ok: true,
      result: { lead, analysis: lead_analyses?.[0] ?? null },
    }
  },
}

// -------------------------------------------------------------
// search_leads
// -------------------------------------------------------------

export type SearchLeadsArgs = {
  status?: 'new' | 'contacted' | 'converted' | 'lost'
  category?: 'HOT' | 'WARM' | 'COLD'
  created_after?: string
  created_before?: string
  limit: number
}

export const searchLeadsTool: ToolDefinition<SearchLeadsArgs, { count: number; leads: Record<string, unknown>[] }> = {
  name: 'search_leads',
  version: '1.0.0',
  description:
    'Search leads visible to you, newest first. Optional filters: status (new/contacted/converted/lost), category (HOT/WARM/COLD from the latest analysis). Returns at most 20.',
  riskLevel: 'read',
  allowedAgents: [NAME, 'external-lead-support', 'reporting-agent'],
  allowedRoles: ['admissions', 'external'],
  parameters: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['new', 'contacted', 'converted', 'lost'] },
      category: { type: 'string', enum: ['HOT', 'WARM', 'COLD'] },
      created_after: { type: 'string', description: 'Inclusive ISO timestamp lower bound for created_at' },
      created_before: { type: 'string', description: 'Exclusive ISO timestamp upper bound for created_at' },
      limit: { type: 'integer', description: '1-20, default 10' },
    },
  },
  validateInput(args) {
    const a = (args ?? {}) as Partial<SearchLeadsArgs>
    if (a.status !== undefined && !['new', 'contacted', 'converted', 'lost'].includes(a.status)) {
      return { ok: false, errors: ['status must be new, contacted, converted or lost'] }
    }
    if (a.category !== undefined && !['HOT', 'WARM', 'COLD'].includes(a.category)) {
      return { ok: false, errors: ['category must be HOT, WARM or COLD'] }
    }
    if (a.limit !== undefined && (!Number.isInteger(a.limit) || a.limit < 1 || a.limit > 20)) {
      return { ok: false, errors: ['limit must be an integer between 1 and 20'] }
    }
    for (const [key, value] of [['created_after', a.created_after], ['created_before', a.created_before] as const]) {
      if (value !== undefined && (typeof value !== 'string' || Number.isNaN(Date.parse(value)))) return { ok: false, errors: [`${key} must be a valid ISO timestamp`] }
    }
    if (a.created_after && a.created_before && Date.parse(a.created_after) >= Date.parse(a.created_before)) return { ok: false, errors: ['created_after must be earlier than created_before'] }
    return { ok: true, data: { status: a.status, category: a.category, created_after: a.created_after, created_before: a.created_before, limit: a.limit ?? 10 } }
  },
  validateOutput: validateLeadList,
  timeoutMs: 8_000,
  idempotency: 'idempotent',
  async execute(ctx, args): Promise<ToolOutcome<{ count: number; leads: Record<string, unknown>[] }>> {
    if (ctx.requesterRead) {
      try {
        const rows = await ctx.requesterRead('search_leads', {
          status: args.status ?? null, category: args.category ?? null, created_after: args.created_after ?? null, created_before: args.created_before ?? null, limit: args.limit,
        }) as Record<string, unknown>[] | null
        return { ok: true, result: { count: rows?.length ?? 0, leads: rows ?? [] } }
      } catch (e) {
        return { ok: false, error: `lead search failed: ${String(e)}`, retryable: false }
      }
    }
    let query = ctx.userClient
      .from('leads')
      .select('id, name, email, phone, source, status, course_interest, created_at, lead_analyses(score, category, intent)')
      .order('created_at', { ascending: false })
      .limit(args.limit)
    if (args.status) query = query.eq('status', args.status)
    if (args.category) query = query.eq('lead_analyses.category', args.category)
    if (args.created_after) query = query.gte('created_at', args.created_after)
    if (args.created_before) query = query.lt('created_at', args.created_before)
    const { data, error } = await query
    if (error) return { ok: false, error: `lead search failed: ${error.message}`, retryable: false }
    return { ok: true, result: { count: data.length, leads: data } }
  },
}

// -------------------------------------------------------------
// get_lead_history
// -------------------------------------------------------------

export type LeadHistory = {
  lead_id: string
  analyses: Record<string, unknown>[]
  tasks: Record<string, unknown>[]
  emails: Record<string, unknown>[]
}

export const getLeadHistoryTool: ToolDefinition<{ lead_id: string }, LeadHistory> = {
  name: 'get_lead_history',
  version: '1.0.0',
  description:
    'Load the operational history of one lead you can see: past AI analyses, follow-up tasks and recorded emails. Use before creating a task or preparing an email to avoid duplicates.',
  riskLevel: 'read',
  allowedAgents: [NAME, 'external-lead-support', 'reporting-agent'],
  allowedRoles: ['admissions', 'external'],
  parameters: {
    type: 'object',
    properties: { lead_id: { type: 'string', description: 'Lead id (uuid)' } },
    required: ['lead_id'],
  },
  validateInput: validateLeadId,
  validateOutput: (v) => {
    const r = asRecord(v)
    if (!r || !Array.isArray(r.analyses) || !Array.isArray(r.tasks) || !Array.isArray(r.emails)) {
      return { ok: false, errors: ['history must include analyses, tasks and emails arrays'] }
    }
    return { ok: true, data: r as LeadHistory }
  },
  timeoutMs: 8_000,
  idempotency: 'idempotent',
  async execute(ctx, args): Promise<ToolOutcome<LeadHistory>> {
    const visible = await loadVisibleLead(ctx, args.lead_id)
    if (!visible.ok) return { ok: false, error: visible.error, retryable: false }
    if (ctx.requesterRead) {
      try {
        const [analyses, tasks, emails] = await Promise.all([
          ctx.requesterRead('lead_analyses', { lead_id: args.lead_id }) as Promise<Record<string, unknown>[] | null>,
          ctx.requesterRead('lead_tasks', { lead_id: args.lead_id }) as Promise<Record<string, unknown>[] | null>,
          ctx.requesterRead('lead_emails', { lead_id: args.lead_id }) as Promise<Record<string, unknown>[] | null>,
        ])
        return {
          ok: true,
          result: {
            lead_id: args.lead_id,
            analyses: analyses ?? [],
            tasks: tasks ?? [],
            emails: emails ?? [],
          },
        }
      } catch (e) {
        return { ok: false, error: `history lookup failed: ${String(e)}`, retryable: false }
      }
    }
    const [analyses, tasks, emails] = await Promise.all([
      ctx.userClient.from('lead_analyses').select('score, category, intent, summary, recommended_action, created_at').eq('lead_id', args.lead_id).order('created_at', { ascending: false }).limit(5),
      ctx.userClient.from('tasks').select('id, title, priority, status, due_at, created_at').eq('lead_id', args.lead_id).order('created_at', { ascending: false }).limit(10),
      ctx.userClient.from('sent_emails').select('id, to_address, subject, status, created_at').eq('lead_id', args.lead_id).order('created_at', { ascending: false }).limit(10),
    ])
    if (analyses.error || tasks.error || emails.error) {
      const msg = analyses.error?.message ?? tasks.error?.message ?? emails.error?.message ?? 'unknown'
      return { ok: false, error: `history lookup failed: ${msg}`, retryable: false }
    }
    return {
      ok: true,
      result: {
        lead_id: args.lead_id,
        analyses: analyses.data,
        tasks: tasks.data,
        emails: emails.data,
      },
    }
  },
}

// -------------------------------------------------------------
// create_task
// -------------------------------------------------------------

export type CreateTaskArgs = {
  lead_id: string
  title: string
  details: string | null
  priority: 'high' | 'medium' | 'low'
  due_in_hours: number
}

export type CreateTaskResult = { task_id: string; assignee_id: string | null; due_at: string }

export const createTaskTool: ToolDefinition<CreateTaskArgs, CreateTaskResult> = {
  name: 'create_task',
  version: '1.0.0',
  description:
    'Create a follow-up task for one lead you can see. The task is assigned to the lead\'s counselor automatically — you cannot choose the assignee. Check get_lead_history first to avoid duplicates.',
  riskLevel: 'write',
  allowedAgents: [NAME],
  allowedRoles: ['admissions'],
  parameters: {
    type: 'object',
    properties: {
      lead_id: { type: 'string', description: 'Lead id (uuid)' },
      title: { type: 'string', description: 'Task title, 1-200 chars' },
      details: { type: 'string', description: 'Optional task details, max 2000 chars' },
      priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Default medium' },
      due_in_hours: { type: 'integer', description: 'Hours from now until due, 1-336, default 24' },
    },
    required: ['lead_id', 'title'],
  },
  validateInput(args) {
    const a = (args ?? {}) as Partial<CreateTaskArgs>
    const errors: string[] = []
    if (!isNonEmptyStr(a.lead_id, 64)) errors.push('lead_id is required')
    if (!isNonEmptyStr(a.title, 200)) errors.push('title is required (1-200 chars)')
    if (a.details !== undefined && a.details !== null && (!isNonEmptyStr(a.details, 2000))) {
      errors.push('details must be at most 2000 chars')
    }
    if (a.priority !== undefined && !['high', 'medium', 'low'].includes(a.priority)) {
      errors.push('priority must be high, medium or low')
    }
    if (a.due_in_hours !== undefined && (!Number.isInteger(a.due_in_hours) || a.due_in_hours < 1 || a.due_in_hours > 336)) {
      errors.push('due_in_hours must be an integer between 1 and 336')
    }
    if (errors.length) return { ok: false, errors }
    return {
      ok: true,
      data: {
        lead_id: a.lead_id as string,
        title: a.title as string,
        details: a.details ?? null,
        priority: a.priority ?? 'medium',
        due_in_hours: a.due_in_hours ?? 24,
      },
    }
  },
  validateOutput: (v) => {
    const r = asRecord(v)
    if (!r || typeof r.task_id !== 'string') return { ok: false, errors: ['result must include task_id'] }
    return { ok: true, data: r as CreateTaskResult }
  },
  timeoutMs: 10_000,
  idempotency: 'non_idempotent',
  async checkResource(ctx, args) {
    const visible = await loadVisibleLead(ctx, args.lead_id)
    return visible.ok ? { ok: true } : { ok: false, reason: visible.error }
  },
  async execute(ctx, args): Promise<ToolOutcome<CreateTaskResult>> {
    // Resource-level check on the employee's scope (9.5) — the write
    // itself goes out on the admin client only when this passes.
    const visible = await loadVisibleLead(ctx, args.lead_id)
    if (!visible.ok) return { ok: false, error: visible.error, retryable: false }
    const dueAt = new Date(Date.now() + args.due_in_hours * 3_600_000).toISOString()
    const { data, error } = await ctx.adminClient
      .from('tasks')
      .insert({
        lead_id: args.lead_id,
        assigned_counselor_id: visible.lead.assigned_counselor_id ?? null,
        title: args.title,
        details: args.details,
        priority: args.priority,
        due_at: dueAt,
        created_by: `agent:${ctx.agentId}`,
      })
      .select('id')
      .single()
    if (error) return { ok: false, error: `task insert failed: ${error.message}`, retryable: false }
    return {
      ok: true,
      result: {
        task_id: data.id as string,
        assignee_id: (visible.lead.assigned_counselor_id as string | null) ?? null,
        due_at: dueAt,
      },
    }
  },
}

// -------------------------------------------------------------
// notify_counselor
// -------------------------------------------------------------

export type NotifyArgs = { lead_id: string; title: string; body: string | null }
export type NotifyResult = { notification_id: string; recipient_id: string }

export const notifyCounselorTool: ToolDefinition<NotifyArgs, NotifyResult> = {
  name: 'notify_counselor',
  version: '1.0.0',
  description:
    'Send an in-app notification to the assigned counselor of a lead you can see. Use when the counselor must act personally (ambiguous lead, request beyond your scope).',
  riskLevel: 'write',
  allowedAgents: [NAME],
  allowedRoles: ['admissions'],
  parameters: {
    type: 'object',
    properties: {
      lead_id: { type: 'string', description: 'Lead id (uuid)' },
      title: { type: 'string', description: 'Notification title, 1-200 chars' },
      body: { type: 'string', description: 'Optional message, max 1000 chars' },
    },
    required: ['lead_id', 'title'],
  },
  validateInput(args) {
    const a = (args ?? {}) as Partial<NotifyArgs>
    if (!isNonEmptyStr(a.lead_id, 64) || !isNonEmptyStr(a.title, 200)) {
      return { ok: false, errors: ['lead_id and title are required'] }
    }
    if (a.body !== undefined && a.body !== null && !isNonEmptyStr(a.body, 1000)) {
      return { ok: false, errors: ['body must be at most 1000 chars'] }
    }
    return { ok: true, data: { lead_id: a.lead_id, title: a.title, body: a.body ?? null } }
  },
  validateOutput: (v) => {
    const r = asRecord(v)
    if (!r || typeof r.notification_id !== 'string' || typeof r.recipient_id !== 'string') {
      return { ok: false, errors: ['result must include notification_id and recipient_id'] }
    }
    return { ok: true, data: r as NotifyResult }
  },
  timeoutMs: 10_000,
  idempotency: 'non_idempotent',
  async checkResource(ctx, args) {
    const visible = await loadVisibleLead(ctx, args.lead_id)
    return visible.ok ? { ok: true } : { ok: false, reason: visible.error }
  },
  async execute(ctx, args): Promise<ToolOutcome<NotifyResult>> {
    const visible = await loadVisibleLead(ctx, args.lead_id)
    if (!visible.ok) return { ok: false, error: visible.error, retryable: false }
    const recipient = visible.lead.assigned_counselor_id as string | null
    if (!recipient) return { ok: false, error: 'LEAD_UNASSIGNED: the lead has no assigned counselor to notify', retryable: false }
    const { data, error } = await ctx.adminClient
      .from('notifications')
      .insert({
        recipient_id: recipient,
        lead_id: args.lead_id,
        type: 'system',
        title: args.title,
        body: args.body,
      })
      .select('id')
      .single()
    if (error) return { ok: false, error: `notification insert failed: ${error.message}`, retryable: false }
    return { ok: true, result: { notification_id: data.id as string, recipient_id: recipient } }
  },
}

export const CRM_TOOLS = [getLeadTool, searchLeadsTool, getLeadHistoryTool, createTaskTool, notifyCounselorTool]
