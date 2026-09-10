import { NextRequest, NextResponse } from 'next/server'
import { runAiTool } from '@/lib/ai/route-handler'
import { validateCampaignInsights } from '@/lib/ai/schemas'
import { getSystemPrompt, PromptLedgerError, type PromptSource } from '@/lib/promptledger'

/**
 * F-021 — Campaign Analyzer (marketing): pasted campaign metrics (manual
 * text or CSV pasted as text) → summary, strong/weak segments, trends,
 * recommendations. The metrics stay client-side; only char counts are logged.
 */
export async function POST(request: NextRequest) {
  // Input sanity check happens before the AI call (no Gemini quota burned
  // on an empty payload). runAiTool re-parses the body — acceptable dup.
  const probe = (await request.clone().json().catch(() => null)) as Record<string, unknown> | null
  const metricsProbe = typeof probe?.metrics === 'string' ? probe.metrics.trim() : ''
  if (!metricsProbe) {
    return NextResponse.json(
      { error: 'Paste your campaign metrics (CSV or plain text) first.' },
      { status: 400 }
    )
  }

  // --- system prompt from the registry (PromptLedger): the LIVE version
  // decides what this tool says; promoting a new version there changes
  // behavior on the next run. Fail closed when configured-but-broken:
  // no Gemini call, no silent stale prompt (F-024 pattern). ---
  let system: string
  let promptSource: PromptSource
  let promptVersion: number | null
  try {
    const pl = await getSystemPrompt({ app: 'ops-copilot', name: 'campaign-analyzer' })
    system = pl.text
    promptSource = pl.source
    promptVersion = pl.version
  } catch (e) {
    if (e instanceof PromptLedgerError) {
      console.error(`[ai:F-021] prompt fetch failed (${e.code}): ${e.message}`)
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

  return runAiTool(request, 'F-021', ({ body }) => {
    const campaignName = typeof body.campaign_name === 'string' ? body.campaign_name.trim().slice(0, 200) : ''
    const metrics = typeof body.metrics === 'string' ? body.metrics.trim().slice(0, 20_000) : ''
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 1_000) : ''

    const user = [
      campaignName ? `Campaign: ${campaignName}` : 'Campaign: (unnamed)',
      'Metrics data:',
      metrics,
      notes ? `Analyst notes: ${notes}` : '',
    ].filter(Boolean).join('\n')

    return {
      system,
      user,
      validate: validateCampaignInsights,
      temperature: 0.4,
      maxOutputTokens: 1200,
      inputSummary: {
        campaign_name_chars: campaignName.length,
        metrics_chars: metrics.length,
        notes_chars: notes.length,
        looks_like_csv: metrics.includes(',') && metrics.includes('\n'),
        prompt_source: promptSource,
        prompt_version: promptVersion,
      },
    }
  })
}
