import type { ValidationResult } from '@/lib/gemini'

// Per-tool schema validators. Every tool registered in Phase 6 adds its
// validator here (or alongside its route) as a pure function, so it can be
// unit-tested without touching the network.

export type LeadAnalysis = {
  score: number
  category: 'HOT' | 'WARM' | 'COLD'
  intent: 'HIGH' | 'MEDIUM' | 'LOW'
  course: string | null
  timeline: string | null
  summary: string
  recommended_action: string
}

/**
 * Reference implementation of the validator convention — the exact same
 * contract the n8n "Schema check" node enforces for F-004.
 */
export function validateLeadAnalysis(parsed: unknown): ValidationResult<LeadAnalysis> {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, errors: ['response must be a single JSON object'] }
  }
  const p = parsed as Partial<LeadAnalysis>
  const errors: string[] = []

  if (!Number.isInteger(p.score) || (p.score as number) < 0 || (p.score as number) > 100) {
    errors.push('score must be an integer between 0 and 100')
  }
  if (!['HOT', 'WARM', 'COLD'].includes(p.category ?? '')) {
    errors.push('category must be HOT, WARM or COLD')
  }
  if (!['HIGH', 'MEDIUM', 'LOW'].includes(p.intent ?? '')) {
    errors.push('intent must be HIGH, MEDIUM or LOW')
  }
  if (typeof p.summary !== 'string' || !p.summary.trim()) {
    errors.push('summary is required')
  }
  if (typeof p.recommended_action !== 'string' || !p.recommended_action.trim()) {
    errors.push('recommended_action is required')
  }

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    data: {
      score: p.score as number,
      category: p.category as LeadAnalysis['category'],
      intent: p.intent as LeadAnalysis['intent'],
      course: p.course ?? null,
      timeline: p.timeline ?? null,
      summary: p.summary as string,
      recommended_action: p.recommended_action as string,
    },
  }
}

// -------------------------------------------------------------
// F-020 — Content Generator (marketing)
// -------------------------------------------------------------

export type ContentDraft = {
  headlines: string[]
  ad_copy: string
  ctas: string[]
}

function isNonEmptyStringArray(v: unknown, min: number, max: number): v is string[] {
  return (
    Array.isArray(v) &&
    v.length >= min &&
    v.length <= max &&
    v.every((s) => typeof s === 'string' && s.trim().length > 0)
  )
}

export function validateContentDraft(parsed: unknown): ValidationResult<ContentDraft> {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, errors: ['response must be a single JSON object'] }
  }
  const p = parsed as Partial<ContentDraft>
  const errors: string[] = []

  if (!isNonEmptyStringArray(p.headlines, 3, 5)) {
    errors.push('headlines must be an array of 3-5 non-empty strings')
  }
  if (typeof p.ad_copy !== 'string' || !p.ad_copy.trim()) {
    errors.push('ad_copy is required')
  }
  if (!isNonEmptyStringArray(p.ctas, 2, 4)) {
    errors.push('ctas must be an array of 2-4 non-empty strings')
  }

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    data: {
      headlines: (p.headlines as string[]).map((s) => s.trim()),
      ad_copy: (p.ad_copy as string).trim(),
      ctas: (p.ctas as string[]).map((s) => s.trim()),
    },
  }
}

// -------------------------------------------------------------
// F-021 — Campaign Analyzer (marketing)
// -------------------------------------------------------------

export type CampaignInsights = {
  summary: string
  strong_segments: string[]
  weak_segments: string[]
  trends: string[]
  recommendations: string[]
}

export function validateCampaignInsights(parsed: unknown): ValidationResult<CampaignInsights> {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, errors: ['response must be a single JSON object'] }
  }
  const p = parsed as Partial<CampaignInsights>
  const errors: string[] = []

  if (typeof p.summary !== 'string' || !p.summary.trim()) {
    errors.push('summary is required')
  }
  // Segments/trends/recommendations: non-empty arrays of short strings,
  // capped so a runaway model cannot produce endless output.
  for (const [key, min, max] of [
    ['strong_segments', 1, 6],
    ['weak_segments', 1, 6],
    ['trends', 1, 6],
    ['recommendations', 1, 6],
  ] as const) {
    if (!isNonEmptyStringArray(p[key], min, max)) {
      errors.push(`${key} must be an array of ${min}-${max} non-empty strings`)
    }
  }

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    data: {
      summary: (p.summary as string).trim(),
      strong_segments: (p.strong_segments as string[]).map((s) => s.trim()),
      weak_segments: (p.weak_segments as string[]).map((s) => s.trim()),
      trends: (p.trends as string[]).map((s) => s.trim()),
      recommendations: (p.recommendations as string[]).map((s) => s.trim()),
    },
  }
}

// -------------------------------------------------------------
// F-022 — Lesson Planner (academic)
// -------------------------------------------------------------

export type LessonPlanSection = { title: string; minutes: number; description: string }

export type LessonPlan = {
  title: string
  objectives: string[]
  sections: LessonPlanSection[]
  materials: string[]
  homework: string
}

export function validateLessonPlan(parsed: unknown): ValidationResult<LessonPlan> {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, errors: ['response must be a single JSON object'] }
  }
  const p = parsed as Partial<LessonPlan>
  const errors: string[] = []

  if (typeof p.title !== 'string' || !p.title.trim()) errors.push('title is required')
  if (!isNonEmptyStringArray(p.objectives, 1, 6)) errors.push('objectives must be 1-6 non-empty strings')

  // sections: 2-8, each with title + positive minutes + description
  const sections = p.sections
  if (
    !Array.isArray(sections) ||
    sections.length < 2 ||
    sections.length > 8 ||
    !sections.every(
      (s) =>
        s !== null &&
        typeof s === 'object' &&
        !Array.isArray(s) &&
        typeof (s as LessonPlanSection).title === 'string' &&
        (s as LessonPlanSection).title.trim().length > 0 &&
        Number.isInteger((s as LessonPlanSection).minutes) &&
        (s as LessonPlanSection).minutes > 0 &&
        (s as LessonPlanSection).minutes <= 180 &&
        typeof (s as LessonPlanSection).description === 'string' &&
        (s as LessonPlanSection).description.trim().length > 0
    )
  ) {
    errors.push('sections must be 2-8 items, each with title, positive minutes (max 180) and description')
  }

  if (!isNonEmptyStringArray(p.materials, 0, 10)) errors.push('materials must be an array of at most 10 strings')
  if (typeof p.homework !== 'string' || !p.homework.trim()) errors.push('homework is required')

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    data: {
      title: (p.title as string).trim(),
      objectives: (p.objectives as string[]).map((s) => s.trim()),
      sections: (sections as LessonPlanSection[]).map((s) => ({
        title: s.title.trim(),
        minutes: s.minutes,
        description: s.description.trim(),
      })),
      materials: ((p.materials ?? []) as string[]).map((s) => s.trim()),
      homework: (p.homework as string).trim(),
    },
  }
}

// -------------------------------------------------------------
// F-023 — Quiz Generator (academic)
// -------------------------------------------------------------

export type QuizQuestion = {
  question: string
  options: string[]
  answer_index: number
  explanation: string
}

export type Quiz = {
  title: string
  questions: QuizQuestion[]
}

export function validateQuiz(parsed: unknown): ValidationResult<Quiz> {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, errors: ['response must be a single JSON object'] }
  }
  const p = parsed as Partial<Quiz>
  const errors: string[] = []

  if (typeof p.title !== 'string' || !p.title.trim()) errors.push('title is required')

  const questions = p.questions
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 20) {
    errors.push('questions must be an array of 1-20 items')
  } else {
    questions.forEach((q, i) => {
      const label = `questions[${i}]`
      if (q === null || typeof q !== 'object' || Array.isArray(q)) {
        errors.push(`${label} must be an object`)
        return
      }
      const item = q as Partial<QuizQuestion>
      if (typeof item.question !== 'string' || !item.question.trim()) {
        errors.push(`${label}.question is required`)
      }
      if (!isNonEmptyStringArray(item.options, 2, 6)) {
        errors.push(`${label}.options must be 2-6 non-empty strings`)
      }
      if (
        !Number.isInteger(item.answer_index) ||
        (item.answer_index as number) < 0 ||
        (item.options ? (item.answer_index as number) >= item.options.length : true)
      ) {
        errors.push(`${label}.answer_index must point at one of the options`)
      }
      if (typeof item.explanation !== 'string' || !item.explanation.trim()) {
        errors.push(`${label}.explanation is required`)
      }
    })
  }

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    data: {
      title: (p.title as string).trim(),
      questions: (questions as QuizQuestion[]).map((q) => ({
        question: q.question.trim(),
        options: (q.options as string[]).map((s) => s.trim()),
        answer_index: q.answer_index,
        explanation: q.explanation.trim(),
      })),
    },
  }
}

// -------------------------------------------------------------
// F-024 — Report Generator (operations)
// -------------------------------------------------------------

export type OpsReport = {
  executive_summary: string
  key_metrics: string[]
  problems: string[]
  trends: string[]
  recommendations: string[]
}

export function validateOpsReport(parsed: unknown): ValidationResult<OpsReport> {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, errors: ['response must be a single JSON object'] }
  }
  const p = parsed as Partial<OpsReport>
  const errors: string[] = []

  if (typeof p.executive_summary !== 'string' || !p.executive_summary.trim()) {
    errors.push('executive_summary is required')
  }
  for (const [key, min] of [
    ['key_metrics', 1],
    ['problems', 1],
    ['trends', 1],
    ['recommendations', 1],
  ] as const) {
    if (!isNonEmptyStringArray(p[key], min, 6)) {
      errors.push(`${key} must be an array of ${min}-6 non-empty strings`)
    }
  }

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    data: {
      executive_summary: (p.executive_summary as string).trim(),
      key_metrics: (p.key_metrics as string[]).map((s) => s.trim()),
      problems: (p.problems as string[]).map((s) => s.trim()),
      trends: (p.trends as string[]).map((s) => s.trim()),
      recommendations: (p.recommendations as string[]).map((s) => s.trim()),
    },
  }
}
