import { NextRequest, NextResponse } from 'next/server'
import { runAiTool } from '@/lib/ai/route-handler'
import { validateQuiz } from '@/lib/ai/schemas'

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const

/**
 * F-023 — AI Quiz Generator (teacher): topic, difficulty, count →
 * multiple-choice questions with answers + explanations.
 */
export async function POST(request: NextRequest) {
  return runAiTool(request, 'F-023', ({ body }) => {
    const topic = typeof body.topic === 'string' ? body.topic.trim().slice(0, 200) : ''
    const difficultyRaw = typeof body.difficulty === 'string' ? body.difficulty.trim().slice(0, 10) : ''
    const difficulty = (DIFFICULTIES as readonly string[]).includes(difficultyRaw) ? difficultyRaw : 'medium'
    const countRaw = Number.parseInt(typeof body.count === 'string' ? body.count : '', 10)
    const count = Number.isInteger(countRaw) && countRaw >= 3 && countRaw <= 15 ? countRaw : 5
    const source = typeof body.source === 'string' ? body.source.trim().slice(0, 2000) : ''

    const system = [
      'You are an assessment designer for a language school.',
      'You write clear multiple-choice quiz questions with plausible distractors.',
      'Respond with ONLY a single JSON object with exactly these keys:',
      '{ "title": <quiz title>, "questions": <array of items, each { "question": <question text>, "options": <array of exactly 4 answer strings>, "answer_index": <0-3, index of the correct option>, "explanation": <why the answer is correct, 1-2 sentences> }> }',
      'Exactly one option is correct; distractors must be plausible but clearly wrong on reflection. No markdown, no commentary.',
    ].join('\n')

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
      inputSummary: { topic_chars: topic.length, difficulty, count, source_chars: source.length },
    }
  })
}
