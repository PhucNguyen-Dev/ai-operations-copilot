import { NextRequest, NextResponse } from 'next/server'
import { runAiTool } from '@/lib/ai/route-handler'
import { validateQuiz } from '@/lib/ai/schemas'
import { getSystemPrompt, PromptLedgerError, type PromptSource } from '@/lib/promptledger'

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const

/**
 * F-023 — AI Quiz Generator (teacher): topic, difficulty, count →
 * multiple-choice questions with answers + explanations.
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
    const pl = await getSystemPrompt({ app: 'ops-copilot', name: 'quiz-generator' })
    system = pl.text
    promptSource = pl.source
    promptVersion = pl.version
  } catch (e) {
    if (e instanceof PromptLedgerError) {
      console.error(`[ai:F-023] prompt fetch failed (${e.code}): ${e.message}`)
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

  return runAiTool(request, 'F-023', ({ body }) => {
    const topic = typeof body.topic === 'string' ? body.topic.trim().slice(0, 200) : ''
    const difficultyRaw = typeof body.difficulty === 'string' ? body.difficulty.trim().slice(0, 10) : ''
    const difficulty = (DIFFICULTIES as readonly string[]).includes(difficultyRaw) ? difficultyRaw : 'medium'
    const countRaw = Number.parseInt(typeof body.count === 'string' ? body.count : '', 10)
    const count = Number.isInteger(countRaw) && countRaw >= 3 && countRaw <= 15 ? countRaw : 5
    const source = typeof body.source === 'string' ? body.source.trim().slice(0, 2000) : ''

    const user = [
      `Topic: ${topic}`,
      `Difficulty: ${difficulty}`,
      `Number of questions: ${count}`,
      source ? `Source content to base questions on: ${source}` : '',
    ].filter(Boolean).join('\n')

    return {
      system,
      user,
      validate: validateQuiz,
      temperature: 0.7,
      maxOutputTokens: 2000,
      inputSummary: {
        topic_chars: topic.length,
        difficulty,
        count,
        source_chars: source.length,
        prompt_source: promptSource,
        prompt_version: promptVersion,
      },
    }
  })
}
