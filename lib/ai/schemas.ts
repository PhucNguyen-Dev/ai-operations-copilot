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
