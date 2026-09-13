// Short-TTL response cache for AI tool calls (Part A1 of the project
// revision). Identical repeat submissions (same tool + model + prompt)
// return instantly and cost zero Gemini tokens — free-tier daily quota is
// the real constraint (LESSONS-LEARNED §2.3).
//
// Phase 9 Milestone H (9.13): the cache is now SHARED state — the
// ai_response_cache table when the service-role key is configured
// (survives restarts, correct across instances), the original in-memory
// Map otherwise (unit tests, bare envs). `cacheGet`/`cacheSet` are
// async; callers await them.

import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

const TTL_MS = 10 * 60_000
const MAX_ENTRIES = 50

type Entry = { value: unknown; expiresAt: number }

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

function usePostgres(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) && process.env.CACHE_BACKEND !== 'memory'
}

let adminCache: SupabaseClient | null = null
function admin(): SupabaseClient {
  if (!adminCache) adminCache = createAdminClient()
  return adminCache
}

/** Returns the cached value when present and unexpired (lazy eviction). */
export async function cacheGet(key: string): Promise<{ hit: boolean; value?: unknown }> {
  if (usePostgres()) {
    try {
      const { data, error } = await admin()
        .from('ai_response_cache')
        .select('value, expires_at')
        .eq('key', key)
        .limit(1)
      if (error) throw new Error(error.message)
      const row = (data ?? [])[0] as { value: unknown; expires_at: string } | undefined
      if (!row) return { hit: false }
      if (new Date(row.expires_at).getTime() < Date.now()) {
        // Lazy eviction — best-effort.
        await admin().from('ai_response_cache').delete().eq('key', key)
        return { hit: false }
      }
      return { hit: true, value: row.value }
    } catch (e) {
      console.error(`[ai-cache] postgres cache unavailable, treating as miss: ${String(e)}`)
      return { hit: false }
    }
  }

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

export async function cacheSet(key: string, value: unknown): Promise<void> {
  if (usePostgres()) {
    try {
      await admin().from('ai_response_cache').upsert({
        key,
        value,
        expires_at: new Date(Date.now() + TTL_MS).toISOString(),
      })
    } catch (e) {
      // A cache-write failure must never break the response.
      console.error(`[ai-cache] postgres cache write failed: ${String(e)}`)
    }
    return
  }

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
