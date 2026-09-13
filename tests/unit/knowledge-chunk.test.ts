import { describe, expect, it } from 'vitest'
import { chunkText, toPgVectorLiteral } from '../../scripts/knowledge-chunk.mjs'

// 9.7 Milestone B — pure chunking helpers shared by the ingestion
// script and this test (single source of truth, no duplicated logic).
// =============================================================

describe('chunkText', () => {
  it('returns [] for empty input', () => {
    expect(chunkText('')).toEqual([])
    expect(chunkText(null)).toEqual([])
    expect(chunkText('   ')).toEqual([])
  })

  it('returns a single chunk for short text', () => {
    const chunks = chunkText('Short SOP text about refunds.')
    expect(chunks).toEqual(['Short SOP text about refunds.'])
  })

  it('respects the size limit and produces multiple chunks', () => {
    const sentence = 'The counselor must review the lead before contacting the family. '
    const text = sentence.repeat(40) // ~2400 chars
    const chunks = chunkText(text, 800, 150)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(800)
  })

  it('carries overlap across chunk boundaries (context is not lost)', () => {
    const sentence = 'Payment plans allow two installments. '
    const text = sentence.repeat(40)
    const [first, second] = chunkText(text, 800, 150)
    // The tail of chunk 1 should appear at the start of chunk 2.
    const tail = first.slice(-80)
    expect(second.startsWith(tail.slice(0, 40).trim()) || second.includes(tail.trim())).toBe(true)
  })

  it('hard-cuts pathological input with no sentence separators', () => {
    const text = 'x'.repeat(2500)
    const chunks = chunkText(text, 800, 150)
    expect(chunks.length).toBe(4) // ceil((2500-150)/650) boundary math
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(800)
  })

  it('keeps paragraph breaks as split points', () => {
    const text = `${'a'.repeat(500)}\n\n${'b'.repeat(500)}`
    const chunks = chunkText(text, 800, 150)
    expect(chunks.length).toBe(2)
  })

  it('rejects overlap >= size', () => {
    expect(() => chunkText('abc', 100, 100)).toThrow()
  })
})

describe('toPgVectorLiteral', () => {
  it('serializes floats into a pgvector literal', () => {
    expect(toPgVectorLiteral([0.1, -0.25, 3])).toBe('[0.1,-0.25,3]')
  })

  it('rejects empty, non-array or non-finite input', () => {
    expect(() => toPgVectorLiteral([])).toThrow()
    expect(() => toPgVectorLiteral('nope' as unknown as number[])).toThrow()
    expect(() => toPgVectorLiteral([Number.NaN])).toThrow()
    expect(() => toPgVectorLiteral([Infinity])).toThrow()
  })
})
