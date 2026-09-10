import { NextRequest, NextResponse } from 'next/server'
import { runAiTool } from '@/lib/ai/route-handler'
import { validateLessonPlan } from '@/lib/ai/schemas'
import { getSystemPrompt, PromptLedgerError, type PromptSource } from '@/lib/promptledger'

const LEVELS = ['kids', 'teen', 'adult', 'business'] as const

/**
 * F-022 — AI Lesson Planner (teacher): grade/level, subject, topic,
 * duration, objectives → structured lesson plan (sections with minutes).
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
    const pl = await getSystemPrompt({ app: 'ops-copilot', name: 'lesson-planner' })
    system = pl.text
    promptSource = pl.source
    promptVersion = pl.version
  } catch (e) {
    if (e instanceof PromptLedgerError) {
      console.error(`[ai:F-022] prompt fetch failed (${e.code}): ${e.message}`)
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

  return runAiTool(request, 'F-022', ({ body }) => {
    const levelRaw = typeof body.level === 'string' ? body.level.trim().slice(0, 20) : ''
    const level = (LEVELS as readonly string[]).includes(levelRaw) ? levelRaw : 'adult'
    const subject = typeof body.subject === 'string' ? body.subject.trim().slice(0, 120) : ''
    const topic = typeof body.topic === 'string' ? body.topic.trim().slice(0, 200) : ''
    const durationRaw = Number.parseInt(typeof body.duration_minutes === 'string' ? body.duration_minutes : '', 10)
    const duration = Number.isInteger(durationRaw) && durationRaw >= 20 && durationRaw <= 180 ? durationRaw : 60
    const objectives = typeof body.objectives === 'string' ? body.objectives.trim().slice(0, 500) : ''

    const user = [
      `Student level: ${level}`,
      subject ? `Subject: ${subject}` : 'Subject: English',
      `Topic: ${topic}`,
      `Total duration: ${duration} minutes`,
      objectives ? `Learning objectives from the teacher: ${objectives}` : '',
    ].filter(Boolean).join('\n')

    return {
      system,
      user,
      validate: validateLessonPlan,
      temperature: 0.6,
      maxOutputTokens: 1500,
      inputSummary: {
        level,
        subject_chars: subject.length,
        topic_chars: topic.length,
        duration_minutes: duration,
        prompt_source: promptSource,
        prompt_version: promptVersion,
      },
    }
  })
}
