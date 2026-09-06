import { NextRequest, NextResponse } from 'next/server'
import { runAiTool } from '@/lib/ai/route-handler'
import { validateCampaignInsights } from '@/lib/ai/schemas'

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

  return runAiTool(request, 'F-021', ({ body }) => {
    const campaignName = typeof body.campaign_name === 'string' ? body.campaign_name.trim().slice(0, 200) : ''
    const metrics = typeof body.metrics === 'string' ? body.metrics.trim().slice(0, 20_000) : ''
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 1_000) : ''

    const system = [
      'You are a marketing performance analyst for a language school.',
      'You analyze pasted campaign metrics (which may be CSV, key-value lines, or free text) and extract actionable insights.',
      'Respond with ONLY a single JSON object with exactly these keys:',
      '{ "summary": <one-paragraph performance summary>, "strong_segments": <array of 1-6 strings, what performed well and why>, "weak_segments": <array of 1-6 strings, what underperformed and why>, "trends": <array of 1-6 strings, notable patterns across the data>, "recommendations": <array of 1-6 strings, concrete next actions> }',
      'Ground every statement in the provided numbers — do not invent metrics. If data is ambiguous, say what is missing in the relevant item instead of guessing.',
      'No markdown, no commentary.',
    ].join('\n')

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
      },
    }
  })
}
