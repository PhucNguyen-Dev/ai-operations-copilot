import { NextRequest, NextResponse } from 'next/server'
import { runAiTool } from '@/lib/ai/route-handler'
import { validateContentDraft } from '@/lib/ai/schemas'
import { getSystemPrompt, PromptLedgerError, type PromptSource } from '@/lib/promptledger'

const PLATFORMS = ['facebook', 'instagram', 'tiktok', 'google', 'website', 'print'] as const
const TONES = ['professional', 'friendly', 'urgent', 'playful', 'inspirational'] as const

function field(body: Record<string, unknown>, key: string, maxLen: number): string | null {
  const v = body[key]
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, maxLen) : null
}

/**
 * F-020 — AI Content Generator (marketing): campaign brief → headlines,
 * ad copy, CTA variations. Draft only — the marketer reviews everything.
 */
export async function POST(request: NextRequest) {
  // --- system prompt from the registry (PromptLedger): the LIVE version
  // decides what this tool says; promoting a new version there changes
  // behavior on the next run. Fail closed when configured-but-broken:
  // no Gemini call, no silent stale prompt (F-024 pattern). ---
  let system: string
  let promptSource: PromptSource
  let promptVersion: number | null
  try {
    const pl = await getSystemPrompt({ app: 'ops-copilot', name: 'content-generator' })
    system = pl.text
    promptSource = pl.source
    promptVersion = pl.version
  } catch (e) {
    if (e instanceof PromptLedgerError) {
      console.error(`[ai:F-020] prompt fetch failed (${e.code}): ${e.message}`)
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

  return runAiTool(request, 'F-020', ({ body }) => {
    const campaign = field(body, 'campaign', 300) ?? ''
    const audience = field(body, 'audience', 200) ?? ''
    const platformRaw = field(body, 'platform', 20) ?? ''
    const toneRaw = field(body, 'tone', 20) ?? ''
    const objective = field(body, 'objective', 300) ?? ''

    // Whitelist enums server-side; unknown → neutral default.
    const platform = (PLATFORMS as readonly string[]).includes(platformRaw) ? platformRaw : 'website'
    const tone = (TONES as readonly string[]).includes(toneRaw) ? toneRaw : 'friendly'

    const user = [
      `Campaign: ${campaign}`,
      `Target audience: ${audience}`,
      `Platform: ${platform}`,
      `Tone: ${tone}`,
      `Objective: ${objective}`,
    ].join('\n')

    return {
      system,
      user,
      validate: validateContentDraft,
      temperature: 0.8,
      maxOutputTokens: 800,
      trace: {
        name: 'content-generator',
        promptVersion,
        promptSource,
      },
      inputSummary: {
        platform,
        tone,
        campaign_chars: campaign.length,
        audience_chars: audience.length,
        objective_chars: objective.length,
        prompt_source: promptSource,
        prompt_version: promptVersion,
      },
    }
  })
}
