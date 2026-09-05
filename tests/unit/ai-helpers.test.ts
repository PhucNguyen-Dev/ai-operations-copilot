import { describe, expect, it } from 'vitest'
import { extractText, isTruncated, classifyHttpStatus } from '@/lib/gemini'
import { validateLeadAnalysis } from '@/lib/ai/schemas'

describe('isTruncated', () => {
  it('flags responses that do not end in a JSON terminator', () => {
    expect(isTruncated('{"score": 80')).toBe(true)
    expect(isTruncated('{"score": 80\n')).toBe(true) // whitespace trimmed first
    expect(isTruncated('[1, 2,')).toBe(true)
  })

  it('passes complete JSON', () => {
    expect(isTruncated('{"score": 80}')).toBe(false)
    expect(isTruncated('[{"a":1}]')).toBe(false)
    expect(isTruncated('  {"a":1}  ')).toBe(false)
  })

  it('treats empty text as not truncated (empty is its own failure)', () => {
    expect(isTruncated('')).toBe(false)
    expect(isTruncated('   ')).toBe(false)
  })
})

describe('classifyHttpStatus', () => {
  it('treats 429 and 5xx as transient', () => {
    expect(classifyHttpStatus(429)).toEqual({ code: 'AI_UNREACHABLE', retryable: true })
    expect(classifyHttpStatus(500)).toEqual({ code: 'AI_UNREACHABLE', retryable: true })
    expect(classifyHttpStatus(503)).toEqual({ code: 'AI_UNREACHABLE', retryable: true })
  })

  it('treats 4xx as permanent', () => {
    expect(classifyHttpStatus(400).retryable).toBe(false)
    expect(classifyHttpStatus(401).retryable).toBe(false)
    expect(classifyHttpStatus(403).retryable).toBe(false)
    expect(classifyHttpStatus(404).retryable).toBe(false)
  })
})

describe('extractText', () => {
  it('joins all candidate parts', () => {
    const response = {
      candidates: [{ content: { parts: [{ text: '{"a":' }, { text: '1}' }] } }],
    }
    expect(extractText(response)).toBe('{"a":1}')
  })

  it('returns empty string for malformed/empty responses (never throws)', () => {
    expect(extractText(null)).toBe('')
    expect(extractText(undefined)).toBe('')
    expect(extractText({})).toBe('')
    expect(extractText({ candidates: [] })).toBe('')
    expect(extractText({ candidates: [{ content: {} }] })).toBe('')
  })
})

describe('validateLeadAnalysis (the R-02 reference validator)', () => {
  const valid = {
    score: 95,
    category: 'HOT',
    intent: 'HIGH',
    course: 'IELTS',
    timeline: '3 weeks',
    summary: 'Urgent scholarship lead.',
    recommended_action: 'Call today.',
  }

  it('accepts a valid payload and normalizes optional fields', () => {
    const r = validateLeadAnalysis(valid)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.course).toBe('IELTS')
      expect(r.data.timeline).toBe('3 weeks')
    }
  })

  it('coerces missing optional fields to null', () => {
    const r = validateLeadAnalysis({ ...valid, course: undefined, timeline: undefined })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.course).toBeNull()
      expect(r.data.timeline).toBeNull()
    }
  })

  it('rejects out-of-range and non-integer scores', () => {
    for (const score of [-1, 101, 95.5, '95', null, undefined]) {
      const r = validateLeadAnalysis({ ...valid, score: score as never })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errors.join(' ')).toMatch(/score/)
    }
  })

  it('rejects invalid enum values', () => {
    for (const category of ['hot', 'Hot', 'WARMISH', '', null]) {
      const r = validateLeadAnalysis({ ...valid, category: category as never })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errors.join(' ')).toMatch(/category/)
    }
    for (const intent of ['high', 'URGENT', '', null]) {
      const r = validateLeadAnalysis({ ...valid, intent: intent as never })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errors.join(' ')).toMatch(/intent/)
    }
  })

  it('rejects empty/missing summary and recommended_action', () => {
    for (const summary of ['', '   ', null, undefined]) {
      const r = validateLeadAnalysis({ ...valid, summary: summary as never })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errors.join(' ')).toMatch(/summary/)
    }
    for (const action of ['', null, undefined]) {
      const r = validateLeadAnalysis({ ...valid, recommended_action: action as never })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errors.join(' ')).toMatch(/recommended_action/)
    }
  })

  it('collects ALL errors, not just the first', () => {
    const r = validateLeadAnalysis({ score: 200, category: 'X', intent: 'Y' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.length).toBeGreaterThanOrEqual(5)
    }
  })

  it('rejects null/non-object payloads without throwing', () => {
    for (const garbage of [null, undefined, 42, 'x', [], true]) {
      expect(() => validateLeadAnalysis(garbage)).not.toThrow()
      expect(validateLeadAnalysis(garbage).ok).toBe(false)
    }
  })
})
