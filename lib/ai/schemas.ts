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
