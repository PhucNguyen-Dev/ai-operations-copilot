import { describe, expect, it } from 'vitest'
import { validateContentDraft, validateCampaignInsights } from '@/lib/ai/schemas'
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
