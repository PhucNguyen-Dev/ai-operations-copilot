// Short-TTL response cache for AI tool calls (Part A1 of the project
// revision). Identical repeat submissions (same tool + model + prompt)
// return instantly and cost zero Gemini tokens — free-tier daily quota is
// the real constraint (LESSONS-LEARNED §2.3).
//
// In-memory Map, same demo-adequate tradeoff as lib/rate-limit.ts:
// per-instance, resets on restart. Multi-instance deploy would move this to
// shared storage alongside the rate limiter (ROADMAP "Path to production").

import { createHash } from 'node:crypto'

type Entry = { value: unknown; expiresAt: number }

const TTL_MS = 10 * 60_000
const MAX_ENTRIES = 50

const store = new Map<string, Entry>()

/**
 * Stable cache key for one generation: tool + model + a hash of the exact
 * request payload (system prompt, user prompt, generation config).
 * `sha256` hex — collision-safe for this use.
 */
export function cacheKey(parts: {
  tool: string
  model: string
  system: string
  user: string
  temperature?: number
  maxOutputTokens?: number
}): string {
  const payload = JSON.stringify([parts.tool, parts.model, parts.system, parts.user, parts.temperature ?? null, parts.maxOutputTokens ?? null])
  return `${parts.tool}:${createHash('sha256').update(payload).digest('hex')}`
}

/** Returns the cached value when present and unexpired; evicts lazily. */
export function cacheGet(key: string): { hit: boolean; value?: unknown } {
  const entry = store.get(key)
  if (!entry) return { hit: false }
  if (entry.expiresAt < Date.now()) {
    store.delete(key)
    return { hit: false }
  }
  // Refresh recency so hot entries are the last evicted.
  store.delete(key)
  store.set(key, entry)
  return { hit: true, value: entry.value }
}

export function cacheSet(key: string, value: unknown): void {
  // Simple recency eviction once the cap is reached.
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value
    if (oldest !== undefined) store.delete(oldest)
  }
  store.set(key, { value, expiresAt: Date.now() + TTL_MS })
}

/** Test helper — clear all state between unit tests. */
export function resetCache(): void {
  store.clear()
}
