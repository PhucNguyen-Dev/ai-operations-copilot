// R-05 — per-key rate limiting. Phase 9 Milestone H (9.13): the
// swap-ready interface from Part E1 now has BOTH implementations:
//   * PostgresRateLimiter — atomic fixed-window counters in Supabase
//     (rate_limit_hit() RPC, one upsert statement — correct across
//     instances and restarts). Default whenever the service-role key
//     is configured, which is every runtime that runs agents.
//   * The original in-memory counter — per-instance, reset on restart;
//     used only when no DB is configured (pure unit tests, bare envs).
// All call sites go through the single `rateLimiter` swap point and
// await `check()`.

import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

/** Periodically purge dead buckets so the map cannot grow unbounded. */
function sweep(now: number): void {
  if (buckets.size < 1_000) return
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key)
  }
}

export type RateLimitResult = {
  ok: boolean
  /** Seconds until the window resets (for Retry-After) when ok is false. */
  retryAfterSec: number
  remaining: number
}

/**
 * Count one hit for `key`. `limit` hits per `windowMs` are allowed.
 * Pure-ish (only state is the module-level map) so it can be unit-tested.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  sweep(now)

  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, retryAfterSec: 0, remaining: limit - 1 }
  }

  bucket.count += 1
  if (bucket.count > limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)), remaining: 0 }
  }
  return { ok: true, retryAfterSec: 0, remaining: limit - bucket.count }
}

/** Test helper — clear all state between unit tests. */
export function resetRateLimits(): void {
  buckets.clear()
}

/**
 * Swap-ready interface (Part E1): `check` is async — the Postgres
 * implementation performs an RPC; the memory one resolves immediately.
 */
export interface RateLimiter {
  check(key: string, limit: number, windowMs: number): Promise<RateLimitResult>
}

class MemoryRateLimiter implements RateLimiter {
  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    return checkRateLimit(key, limit, windowMs)
  }
}

/**
 * Fixed-window counter in Postgres via the atomic rate_limit_hit()
 * function (migration 014). RPC failures follow an explicit fail-mode
 * policy instead of a blanket fail-open:
 *
 *   * closed (default) — deny with a short Retry-After. Every current
 *     call site is cost-bearing (AI calls, leads, external API), so a
 *     limiter outage must not turn into an unmetered spend window.
 *   * open — availability wins (the historical behavior). Opt in per
 *     key prefix via RATE_LIMIT_FAIL_OPEN_KEYS (comma-separated) or
 *     globally via RATE_LIMIT_FAIL_MODE=open.
 *
 * Either way the decision is LOUD: one server log per failure with the
 * key, the mode and the error.
 */
export type RateLimitFailMode = 'open' | 'closed'

export function rateLimitFailMode(key?: string): RateLimitFailMode {
  if (key) {
    const alwaysOpen = (process.env.RATE_LIMIT_FAIL_OPEN_KEYS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (alwaysOpen.some((p) => key === p || key.startsWith(`${p}:`) || key.startsWith(`${p}-`))) return 'open'
  }
  return process.env.RATE_LIMIT_FAIL_MODE === 'open' ? 'open' : 'closed'
}

class PostgresRateLimiter implements RateLimiter {
  private admin: SupabaseClient | null = null

  private client(): SupabaseClient {
    if (!this.admin) this.admin = createAdminClient()
    return this.admin
  }

  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    try {
      const { data, error } = await this.client().rpc('rate_limit_hit', {
        p_key: key,
        p_limit: limit,
        p_window_ms: windowMs,
      })
      if (error) throw new Error(error.message)
      const r = data as { ok: boolean; remaining: number; retry_after_sec: number }
      return { ok: r.ok, retryAfterSec: r.retry_after_sec, remaining: r.remaining }
    } catch (e) {
      const mode = rateLimitFailMode(key)
      if (mode === 'open') {
        console.error(`[rate-limit] postgres limiter unavailable; FAIL-OPEN (availability over metering, requests are not rate limited) key=${key}: ${String(e)}`)
        return { ok: true, retryAfterSec: 0, remaining: limit }
      }
      // Fail-closed: a limiter outage must not become an unmetered spend
      // window for cost-bearing keys. Deny briefly — the next window or
      // a recovered limiter admits traffic again.
      console.error(`[rate-limit] postgres limiter unavailable; FAIL-CLOSED (deny with short retry, no unmetered spend) key=${key}: ${String(e)}`)
      return { ok: false, retryAfterSec: 5, remaining: 0 }
    }
  }
}

function usingPostgres(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) && process.env.RATE_LIMIT_BACKEND !== 'memory'
}

/** The single swap point. All call sites go through this object. */
export const rateLimiter: RateLimiter = usingPostgres() ? new PostgresRateLimiter() : new MemoryRateLimiter()

/** Introspection for the health endpoint. */
export function rateLimiterStats(): { backend: 'postgres' | 'in-memory'; keys: number; failMode: RateLimitFailMode } {
  if (usingPostgres()) return { backend: 'postgres', keys: buckets.size, failMode: rateLimitFailMode() }
  return { backend: 'in-memory', keys: buckets.size, failMode: 'open' }
}
