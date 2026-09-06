import { NextRequest, NextResponse } from 'next/server'
import { runAiTool } from '@/lib/ai/route-handler'
import { validateLessonPlan } from '@/lib/ai/schemas'

const LEVELS = ['kids', 'teen', 'adult', 'business'] as const

/**
 * F-022 — AI Lesson Planner (teacher): grade/level, subject, topic,
 * duration, objectives → structured lesson plan (sections with minutes).
 */
export async function POST(request: NextRequest) {
  return runAiTool(request, 'F-022', ({ body }) => {
    const levelRaw = typeof body.level === 'string' ? body.level.trim().slice(0, 20) : ''
    const level = (LEVELS as readonly string[]).includes(levelRaw) ? levelRaw : 'adult'
    const subject = typeof body.subject === 'string' ? body.subject.trim().slice(0, 120) : ''
    const topic = typeof body.topic === 'string' ? body.topic.trim().slice(0, 200) : ''
    const durationRaw = Number.parseInt(typeof body.duration_minutes === 'string' ? body.duration_minutes : '', 10)
    const duration = Number.isInteger(durationRaw) && durationRaw >= 20 && durationRaw <= 180 ? durationRaw : 60
    const objectives = typeof body.objectives === 'string' ? body.objectives.trim().slice(0, 500) : ''

    const system = [
      'You are an experienced curriculum designer for a language school.',
      'You build practical, time-boxed lesson plans for English teachers.',
      'Respond with ONLY a single JSON object with exactly these keys:',
      '{ "title": <lesson title>, "objectives": <array of 1-6 measurable learning objectives>, "sections": <array of 2-8 items, each { "title": <section name>, "minutes": <positive integer, all sections summing to the requested duration>, "description": <what the teacher does, 1-3 sentences> }>, "materials": <array of at most 10 strings>, "homework": <homework assignment, 1-3 sentences> }',
      'Section minutes MUST sum to the requested total duration. Activities must be realistic for the level and class size. No markdown, no commentary.',
    ].join('\n')

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
      inputSummary: { level, subject_chars: subject.length, topic_chars: topic.length, duration_minutes: duration },
    }
  })
}
