import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { runAiTool } from '@/lib/ai/route-handler'
import { validateOpsReport } from '@/lib/ai/schemas'
import { getSystemPrompt, PromptLedgerError, type PromptSource } from '@/lib/promptledger'

const RANGES = ['7', '30', '90'] as const

type Aggregates = {
  leadsTotal: number
  leadsByStatus: Record<string, number>
  analysesByCategory: Record<string, number>
  runsTotal: number
  runsSuccess: number
  runsFailed: number
  tasksOpen: number
  emailsDryRun: number
  emailsSent: number
  notes: string
}

/**
 * F-024 — AI Report Generator (operations): real Supabase aggregates for
 * the selected date range become the prompt context; Gemini writes the
 * executive report from actual numbers (labeled as such, never invented).
 *
 * The system prompt is NOT hardcoded here: it is fetched live from
 * PromptLedger (ops-copilot/report-generator) on every run (60s TTL),
 * falling back to the committed copy only when PROMPTLEDGER_URL is unset.
 * This route is the reference for wiring the other owned tools.
 */
export async function POST(request: NextRequest) {
  const body = (await request.clone().json().catch(() => null)) as Record<string, unknown> | null
  const rangeRaw = typeof body?.range === 'string' ? body.range : '30'
  const rangeDays = (RANGES as readonly string[]).includes(rangeRaw) ? Number(rangeRaw) : 30
  const since = new Date(Date.now() - rangeDays * 86_400_000)
  const sinceIso = since.toISOString()

  // --- real aggregates (RLS: operations/admin see all) ---
  let aggregates: Aggregates | null = null
  let aggError: string | null = null
  try {
    const supabase = await createClient()
    const [leads, runs, tasks, emails] = await Promise.all([
      supabase
        .from('leads')
        .select('status, created_at, lead_analyses(category, score)')
        .gte('created_at', sinceIso)
        .limit(1000),
      supabase
        .from('automation_runs')
        .select('status, started_at')
        .gte('started_at', sinceIso)
        .limit(1000),
      supabase
        .from('tasks')
        .select('status')
        .gte('created_at', sinceIso)
        .limit(1000),
      supabase
        .from('sent_emails')
        .select('status')
        .gte('created_at', sinceIso)
        .limit(1000),
    ])

    if (leads.error || runs.error || tasks.error || emails.error) {
      aggError = leads.error?.message ?? runs.error?.message ?? tasks.error?.message ?? emails.error?.message ?? 'unknown'
      console.error('[ai:F-024] aggregate query failed:', aggError)
    } else {
      const byStatus: Record<string, number> = {}
      const byCategory: Record<string, number> = {}
      let scoreSum = 0
      let scored = 0
      for (const lead of leads.data ?? []) {
        byStatus[lead.status] = (byStatus[lead.status] ?? 0) + 1
        const a = (lead.lead_analyses as { category: string; score: number }[] | null)?.[0]
        if (a) {
          byCategory[a.category] = (byCategory[a.category] ?? 0) + 1
          scored += 1
          scoreSum += a.score
        }
      }
      const runStatuses: Record<string, number> = {}
      for (const run of runs.data ?? []) {
        runStatuses[run.status] = (runStatuses[run.status] ?? 0) + 1
      }
      aggregates = {
        leadsTotal: (leads.data ?? []).length,
        leadsByStatus: byStatus,
        analysesByCategory: byCategory,
        runsTotal: (runs.data ?? []).length,
        runsSuccess: runStatuses['success'] ?? 0,
        runsFailed: runStatuses['failed'] ?? 0,
        tasksOpen: (tasks.data ?? []).filter((t) => t.status === 'pending' || t.status === 'in_progress').length,
        emailsDryRun: (emails.data ?? []).filter((e) => e.status === 'dry_run').length,
        emailsSent: (emails.data ?? []).filter((e) => e.status === 'sent').length,
        notes: '',
      }
      aggregates.notes =
        scored > 0 ? `Average AI lead score: ${Math.round(scoreSum / scored)}/100 across ${scored} analyzed leads.` : 'No analyzed leads in range.'
    }
  } catch (e) {
    aggError = String(e)
    console.error('[ai:F-024] aggregate exception:', aggError)
  }

  if (!aggregates) {
    return NextResponse.json(
      { error: 'Could not load operational data for the report — the issue has been logged.', detail: aggError ? undefined : undefined },
      { status: 502 }
    )
  }

  const notes = typeof body?.notes === 'string' ? body.notes.trim().slice(0, 1000) : ''
  aggregates.notes = notes ? `Manager notes to consider: ${notes}` : aggregates.notes

  // --- system prompt from the registry (PromptLedger): the LIVE version
  // decides what this tool says; promoting a new version there changes
  // behavior on the next run. Fail closed when configured-but-broken:
  // no Gemini call, no silent stale prompt. ---
  let system: string
  let promptSource: PromptSource
  let promptVersion: number | null
  try {
    const pl = await getSystemPrompt({ app: 'ops-copilot', name: 'report-generator' })
    system = pl.text
    promptSource = pl.source
    promptVersion = pl.version
  } catch (e) {
    if (e instanceof PromptLedgerError) {
      console.error(`[ai:F-024] prompt fetch failed (${e.code}): ${e.message}`)
      return NextResponse.json(
        {
          error:
            e.code === 'PL_NO_LIVE'
              ? 'This tool\'s prompt is not published yet — contact the admin.'
              : 'Prompt management service is unavailable — try again shortly.',
          code: 'PROMPT_UNAVAILABLE',
          detail: { pl_code: e.code },
        },
        { status: 502 }
      )
    }
    throw e
  }

  return runAiTool(request, 'F-024', () => {
    const user = [
      `Reporting period: last ${rangeDays} days (${sinceIso.slice(0, 10)} to today).`,
      `Leads created: ${aggregates.leadsTotal}`,
      `Leads by status: ${JSON.stringify(aggregates.leadsByStatus)}`,
      `Lead analyses by category: ${JSON.stringify(aggregates.analysesByCategory)}`,
      `Pipeline runs: ${aggregates.runsTotal} total, ${aggregates.runsSuccess} success, ${aggregates.runsFailed} failed`,
      `Follow-up tasks still open: ${aggregates.tasksOpen}`,
      `Emails: ${aggregates.emailsDryRun} dry-run, ${aggregates.emailsSent} sent`,
      aggregates.notes,
      'Write the report.',
    ].join('\n')

    return {
      system,
      user,
      validate: validateOpsReport,
      temperature: 0.3,
      maxOutputTokens: 1500,
      inputSummary: {
        range_days: rangeDays,
        leads: aggregates.leadsTotal,
        runs: aggregates.runsTotal,
        notes_chars: notes.length,
        prompt_source: promptSource,
        prompt_version: promptVersion,
      },
    }
  })
}
