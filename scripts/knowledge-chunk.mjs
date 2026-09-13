// =============================================================
// Pure knowledge-chunking helpers (Phase 9 Milestone B). Kept in a
// dependency-free .mjs module so BOTH the ingestion script (plain
// node) and the vitest unit tests import the exact same logic —
// no duplicated chunker.
// =============================================================

/** Default chunk size in characters (~2-3 paragraphs). */
export const CHUNK_SIZE = 800
/** Character overlap between consecutive chunks. */
export const CHUNK_OVERLAP = 150

/**
 * Split text into overlapping chunks. Splits preferentially at
 * sentence/paragraph boundaries so chunks stay human-coherent;
 * falls back to a hard cut for pathological input (no separators,
 * e.g. long token strings). Pure — unit-tested.
 *
 * @returns {string[]} chunks, each <= size chars; empty input -> []
 */
export function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const clean = String(text ?? '').trim()
  if (!clean) return []
  if (overlap >= size) throw new Error('overlap must be smaller than size')

  // Split into sentences (keep the separators), then pack greedily.
  const pieces = clean.split(/(?<=[.!?])\s+|\n{2,}/).filter((p) => p.trim().length > 0)
  const chunks = []
  let current = ''

  for (const piece of pieces) {
    // A single piece longer than the size limit gets hard-cut into
    // slices (with overlap) so it can never blow the embedding input.
    if (piece.length > size) {
      if (current.trim()) chunks.push(current.trim())
      current = ''
      let start = 0
      while (start < piece.length) {
        chunks.push(piece.slice(start, start + size).trim())
        start += size - overlap
      }
      continue
    }
    if ((current + ' ' + piece).trim().length > size) {
      if (current.trim()) chunks.push(current.trim())
      // Carry overlap from the tail of the previous chunk so context
      // is not lost at the boundary.
      current = current.slice(Math.max(0, current.length - overlap)) + ' ' + piece
    } else {
      current = current ? current + ' ' + piece : piece
    }
  }
  if (current.trim()) chunks.push(current.trim())

  return chunks.filter((c) => c.length > 0)
}

/** Serialize a float array into a pgvector string literal: '[0.1,0.2,...]' */
export function toPgVectorLiteral(values) {
  if (!Array.isArray(values) || values.length === 0 || !values.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    throw new Error('embedding must be a non-empty array of finite numbers')
  }
  return `[${values.join(',')}]`
}
