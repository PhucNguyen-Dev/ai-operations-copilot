import { NextRequest, NextResponse } from 'next/server'
import { runAiTool } from '@/lib/ai/route-handler'
import { validateContentDraft } from '@/lib/ai/schemas'

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
  return runAiTool(request, 'F-020', ({ body }) => {
    const campaign = field(body, 'campaign', 300) ?? ''
    const audience = field(body, 'audience', 200) ?? ''
    const platformRaw = field(body, 'platform', 20) ?? ''
    const toneRaw = field(body, 'tone', 20) ?? ''
    const objective = field(body, 'objective', 300) ?? ''

    // Whitelist enums server-side; unknown → neutral default.
    const platform = (PLATFORMS as readonly string[]).includes(platformRaw) ? platformRaw : 'website'
    const tone = (TONES as readonly string[]).includes(toneRaw) ? toneRaw : 'friendly'

    const system = [
      'You are a senior marketing copywriter for a language school (English test prep, business English).',
      'You write short, high-converting ad copy for the specified platform and tone.',
      'Respond with ONLY a single JSON object with exactly these keys:',
      '{ "headlines": <array of 3-5 distinct headline strings, each under 60 characters>, "ad_copy": <string, 2-4 short paragraphs separated by blank lines>, "ctas": <array of 2-4 short call-to-action strings> }',
      'No markdown, no commentary, no placeholders — write real, specific copy.',
    ].join('\n')

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
      inputSummary: {
        platform,
        tone,
        campaign_chars: campaign.length,
        audience_chars: audience.length,
        objective_chars: objective.length,
      },
    }
  })
}
