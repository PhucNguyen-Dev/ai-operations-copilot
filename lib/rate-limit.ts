// R-05 — simple per-key rate limiting (demo-adequate, per the risk doc).
//
// In-memory token counter: state resets on server restart and is per
// server instance — accepted tradeoff, documented in ROADMAP. For a
// multi-instance deployment this would move to shared storage.

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
