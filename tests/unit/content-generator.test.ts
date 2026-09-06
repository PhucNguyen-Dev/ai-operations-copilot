import { describe, expect, it } from 'vitest'
import { validateContentDraft, validateCampaignInsights, validateLessonPlan, validateQuiz } from '@/lib/ai/schemas'
import { canUseTool, AI_TOOLS } from '@/lib/roles'

describe('validateContentDraft (F-020)', () => {
  const valid = {
    headlines: ['Ace IELTS in 8 weeks', 'Your scholarship starts here', 'Book a free placement test'],
    ad_copy: 'Paragraph one.\n\nParagraph two.',
    ctas: ['Sign up today', 'Book your free test'],
  }

  it('accepts a valid draft and trims strings', () => {
    const r = validateContentDraft(valid)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.headlines[0]).toBe('Ace IELTS in 8 weeks')
  })

  it('enforces headline count 3-5', () => {
    for (const count of [1, 2, 6, 7]) {
      const headlines = Array.from({ length: count }, (_, i) => `Headline ${i + 1}`)
      const r = validateContentDraft({ ...valid, headlines })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errors.join(' ')).toMatch(/headlines/)
    }
  })

  it('enforces CTA count 2-4', () => {
    for (const count of [1, 5]) {
      const ctas = Array.from({ length: count }, (_, i) => `CTA ${i + 1}`)
      const r = validateContentDraft({ ...valid, ctas })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errors.join(' ')).toMatch(/ctas/)
    }
  })

  it('rejects blank entries inside arrays', () => {
    const r = validateContentDraft({ ...valid, headlines: ['good', '   ', 'also good'] })
    expect(r.ok).toBe(false)
  })

  it('rejects missing/blank ad_copy', () => {
    for (const ad_copy of [undefined, '', '   ']) {
      const r = validateContentDraft({ ...valid, ad_copy: ad_copy as never })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errors.join(' ')).toMatch(/ad_copy/)
    }
  })

  it('rejects non-object payloads without throwing', () => {
    for (const garbage of [null, undefined, 7, 'x', [], true]) {
      expect(() => validateContentDraft(garbage)).not.toThrow()
      expect(validateContentDraft(garbage).ok).toBe(false)
    }
  })
})

describe('validateCampaignInsights (F-021)', () => {
  const valid = {
    summary: 'Spend efficiency improved mid-week.',
    strong_segments: ['Thursday CTR 2.6x baseline'],
    weak_segments: ['Weekend conversions dropped 70%'],
    trends: ['Conversions track impressions with a 1-day lag'],
    recommendations: ['Shift 30% of weekend budget to Thu-Fri'],
  }

  it('accepts a valid analysis', () => {
    expect(validateCampaignInsights(valid).ok).toBe(true)
  })

  it('requires all five keys as 1-6 item string arrays', () => {
    for (const key of ['strong_segments', 'weak_segments', 'trends', 'recommendations'] as const) {
      const r = validateCampaignInsights({ ...valid, [key]: [] })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errors.join(' ')).toMatch(new RegExp(key))
    }
    const r7 = validateCampaignInsights({
      ...valid,
      recommendations: Array.from({ length: 7 }, (_, i) => `rec ${i + 1}`),
    })
    expect(r7.ok).toBe(false)
  })

  it('rejects blank items inside arrays', () => {
    const r = validateCampaignInsights({ ...valid, trends: ['real trend', '   '] })
    expect(r.ok).toBe(false)
  })

  it('rejects missing/blank summary', () => {
    for (const summary of [undefined, '', '   ']) {
      const r = validateCampaignInsights({ ...valid, summary: summary as never })
      expect(r.ok).toBe(false)
    }
  })

  it('rejects non-object payloads without throwing', () => {
    for (const garbage of [null, undefined, 3, 'x', [], false]) {
      expect(() => validateCampaignInsights(garbage)).not.toThrow()
      expect(validateCampaignInsights(garbage).ok).toBe(false)
    }
  })
})

describe('validateLessonPlan (F-022)', () => {
  const valid = {
    title: 'Past Simple vs Present Perfect',
    objectives: ['Choose the correct tense in conversation'],
    sections: [
      { title: 'Warm-up', minutes: 10, description: 'Quick timeline drill.' },
      { title: 'Guided practice', minutes: 30, description: 'Pair work with scenario cards.' },
      { title: 'Free production', minutes: 20, description: 'Role play and feedback.' },
    ],
    materials: ['Scenario cards'],
    homework: 'Write 5 sentences about past experiences.',
  }

  it('accepts a valid plan', () => {
    expect(validateLessonPlan(valid).ok).toBe(true)
  })

  it('rejects sections with bad minutes or missing fields', () => {
    for (const sections of [
      [{ title: 'A', minutes: 0, description: 'x' }], // minutes <= 0
      [{ title: 'A', minutes: 200, description: 'x' }, valid.sections[1]], // minutes > 180
      [{ title: 'A', minutes: 30 }], // missing description
      [{ minutes: 30, description: 'x' }], // missing title
      valid.sections.slice(0, 1), // fewer than 2 sections
    ]) {
      const r = validateLessonPlan({ ...valid, sections: sections as never })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errors.join(' ')).toMatch(/sections/)
    }
  })

  it('rejects missing homework / title / bad objectives', () => {
    expect(validateLessonPlan({ ...valid, homework: '' }).ok).toBe(false)
    expect(validateLessonPlan({ ...valid, title: '' }).ok).toBe(false)
    expect(validateLessonPlan({ ...valid, objectives: [] }).ok).toBe(false)
  })

  it('allows empty materials array', () => {
    const r = validateLessonPlan({ ...valid, materials: [] })
    expect(r.ok).toBe(true)
  })

  it('rejects non-object payloads without throwing', () => {
    for (const garbage of [null, undefined, 1, 'x', [], false]) {
      expect(() => validateLessonPlan(garbage)).not.toThrow()
      expect(validateLessonPlan(garbage).ok).toBe(false)
    }
  })
})

describe('validateQuiz (F-023)', () => {
  const validQuestion = {
    question: 'She ___ in Tokyo since 2020.',
    options: ['lives', 'has lived', 'lived', 'is living'],
    answer_index: 1,
    explanation: '"Since 2020" requires the present perfect.',
  }
  const valid = { title: 'Tenses Quiz', questions: [validQuestion, validQuestion, validQuestion] }

  it('accepts a valid quiz', () => {
    expect(validateQuiz(valid).ok).toBe(true)
  })

  it('enforces question count 1-20', () => {
    expect(validateQuiz({ ...valid, questions: [] }).ok).toBe(false)
    const tooMany = Array.from({ length: 21 }, (_, i) => ({ ...validQuestion, question: `Q${i}` }))
    expect(validateQuiz({ ...valid, questions: tooMany }).ok).toBe(false)
  })

  it('rejects answer_index that points outside the options', () => {
    for (const answer_index of [-1, 4, 1.5, 'one', null]) {
      const r = validateQuiz({ ...valid, questions: [{ ...validQuestion, answer_index: answer_index as never }] })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errors.join(' ')).toMatch(/answer_index/)
    }
  })

  it('enforces exactly 2-6 non-empty options', () => {
    for (const options of [[], [validQuestion.options[0]], [...validQuestion.options, '', 'x']]) {
      const r = validateQuiz({ ...valid, questions: [{ ...validQuestion, options: options as never }] })
      expect(r.ok).toBe(false)
    }
  })

  it('requires explanation per question', () => {
    const r = validateQuiz({ ...valid, questions: [{ ...validQuestion, explanation: '' }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/explanation/)
  })

  it('rejects non-object payloads without throwing', () => {
    for (const garbage of [null, undefined, 9, 'x', [], true]) {
      expect(() => validateQuiz(garbage)).not.toThrow()
      expect(validateQuiz(garbage).ok).toBe(false)
    }
  })
})

describe('tool access matrix (Phase 6)', () => {
  it('maps every tool to exactly one department with admin passthrough', () => {
    expect(Object.keys(AI_TOOLS).sort()).toEqual(['F-020', 'F-021', 'F-022', 'F-023', 'F-024'])
    expect(AI_TOOLS['F-020'].department).toBe('marketing')
    expect(AI_TOOLS['F-022'].department).toBe('academic')
    expect(AI_TOOLS['F-024'].department).toBe('operations')
  })

  it('marketing can use marketing tools only', () => {
    expect(canUseTool('marketing', 'F-020')).toBe(true)
    expect(canUseTool('marketing', 'F-021')).toBe(true)
    expect(canUseTool('marketing', 'F-022')).toBe(false)
    expect(canUseTool('marketing', 'F-024')).toBe(false)
  })

  it('teacher can use academic tools only', () => {
    expect(canUseTool('teacher', 'F-022')).toBe(true)
    expect(canUseTool('teacher', 'F-023')).toBe(true)
    expect(canUseTool('teacher', 'F-020')).toBe(false)
    expect(canUseTool('teacher', 'F-024')).toBe(false)
  })

  it('operations can use the report generator only', () => {
    expect(canUseTool('operations', 'F-024')).toBe(true)
    expect(canUseTool('operations', 'F-020')).toBe(false)
    expect(canUseTool('operations', 'F-022')).toBe(false)
  })

  it('admin can use everything; counselor nothing; unknown tool ids fail closed', () => {
    for (const id of Object.keys(AI_TOOLS)) expect(canUseTool('admin', id)).toBe(true)
    expect(canUseTool('admissions', 'F-020')).toBe(false)
    expect(canUseTool('unknown', 'F-020')).toBe(false)
    expect(canUseTool('admin', 'F-999')).toBe(false)
  })
})
