// =============================================================
// PromptLedger consumer adapter (platform service #2). The registry
// owns prompt text: AI tool routes fetch their LIVE system prompt at
// run time instead of hardcoding one, so promoting a new version in
// PromptLedger changes behavior on the next run — no redeploy.
//
// Conventions (mirror lib/gateway-client.ts):
//   - server-only: never import from client components (secret header)
//   - UNCONFIGURED (no PROMPTLEDGER_URL) -> committed fallback from
//     prompts/ with a loud warning, so the app stays runnable standalone
//   - CONFIGURED but unreachable / no live version / bad key -> FAIL
//     CLOSED (typed PromptLedgerError, no silent stale prompt)
//   - 60s in-memory TTL cache: absorbs registry blips and keeps the
//     fetch off the request hot path, same demo-adequate tradeoff as
//     lib/ai/cache.ts (resets on restart; swap to shared storage when
//     the app goes multi-instance)
// =============================================================

import committedReportGenerator from '@/prompts/report-generator.json'
import committedCampaignAnalyzer from '@/prompts/campaign-analyzer.json'
import committedContentGenerator from '@/prompts/content-generator.json'
import committedLessonPlanner from '@/prompts/lesson-planner.json'
import committedQuizGenerator from '@/prompts/quiz-generator.json'

const TIMEOUT_MS = 10_000
const TTL_MS = 60_000

export type PromptSource = 'live' | 'committed'

export type LivePrompt = {
  version: number
  text: string
  status: 'draft' | 'live' | 'deprecated'
}

export type PromptLedgerErrorCode =
  | 'PL_NOT_CONFIGURED' // no PROMPTLEDGER_URL — committed fallback used
  | 'PL_UNREACHABLE' // network error / timeout / 5xx
  | 'PL_NO_LIVE' // registry up, but no live version promoted
  | 'PL_AUTH' // key missing/rejected (401/403)

export class PromptLedgerError extends Error {
  code: PromptLedgerErrorCode
  retryable: boolean

  constructor(code: PromptLedgerErrorCode, message: string, retryable: boolean) {
    super(message)
    this.name = 'PromptLedgerError'
    this.code = code
    this.retryable = retryable
  }
}

/** Committed fallbacks, single-sourced in prompts/ (seed script reads the same files). */
export function committedPrompt(name: string): string {
  switch (name) {
    case 'report-generator':
      return committedReportGenerator.system
    case 'campaign-analyzer':
      return committedCampaignAnalyzer.system
    case 'content-generator':
      return committedContentGenerator.system
    case 'lesson-planner':
      return committedLessonPlanner.system
    case 'quiz-generator':
      return committedQuizGenerator.system
    default:
      throw new PromptLedgerError('PL_NO_LIVE', `no committed prompt for "${name}"`, false)
  }
}

/** True when the app is wired to a PromptLedger registry. */
export function promptLedgerConfigured(): boolean {
  return Boolean(process.env.PROMPTLEDGER_URL)
}

type CacheEntry = { value: LivePrompt; expiresAt: number }
const cache = new Map<string, CacheEntry>()

/** Test helper — clear state between unit tests. */
export function resetPromptLedgerCache(): void {
  cache.clear()
}

function baseUrl(): string {
  return (process.env.PROMPTLEDGER_URL || '').replace(/\/+$/, '')
}

/**
 * Fetch the live system prompt for one owned prompt. Resolves to
 * `{ source: 'live', ... }` or, when PromptLedger is not configured,
 * `{ source: 'committed' }`. Configured-but-broken throws
 * PromptLedgerError — the route decides how loudly to fail (fail closed).
 */
export async function getSystemPrompt(args: {
  app: string
  name: string
}): Promise<{ source: PromptSource; version: number | null; text: string }> {
  const { app, name } = args
  const url = process.env.PROMPTLEDGER_URL

  if (!url) {
    console.warn(
      `[promptledger] PROMPTLEDGER_URL not set — using committed prompt for ${app}/${name}. ` +
        `Behavior changes to this prompt now require a redeploy until the registry is wired.`
    )
    return { source: 'committed', version: null, text: committedPrompt(name) }
  }

  const cacheKey = `${app}/${name}`
  const hit = cache.get(cacheKey)
  if (hit && hit.expiresAt >= Date.now()) {
    return { source: 'live', version: hit.value.version, text: hit.value.text }
  }

  const apiKey = process.env.PROMPTLEDGER_API_KEY
  let res: Response
  try {
    res = await fetch(`${baseUrl()}/api/prompts/${encodeURIComponent(app)}/${encodeURIComponent(name)}/live`, {
      headers: apiKey ? { 'x-api-key': apiKey } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    cache.delete(cacheKey)
    throw new PromptLedgerError(
      'PL_UNREACHABLE',
      `PromptLedger unreachable at ${baseUrl()} while fetching ${app}/${name}: ${String(e)}`,
      true
    )
  }

  if (res.status === 404) {
    cache.delete(cacheKey)
    throw new PromptLedgerError(
      'PL_NO_LIVE',
      `PromptLedger has no live version of ${app}/${name}. Promote one (dashboard or POST /api/prompts with status "live").`,
      false
    )
  }
  if (res.status === 401 || res.status === 403) {
    cache.delete(cacheKey)
    throw new PromptLedgerError(
      'PL_AUTH',
      `PromptLedger rejected the API key (${res.status}) for ${app}/${name}. Check PROMPTLEDGER_API_KEY.`,
      false
    )
  }
  if (!res.ok) {
    cache.delete(cacheKey)
    // 429/5xx are transient; other 4xx are permanent (bad request shape)
    const retryable = res.status === 429 || res.status >= 500
    throw new PromptLedgerError('PL_UNREACHABLE', `PromptLedger returned HTTP ${res.status} for ${app}/${name}`, retryable)
  }

  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new PromptLedgerError('PL_UNREACHABLE', `PromptLedger returned a non-JSON body for ${app}/${name}`, true)
  }
  const live = json as { version?: unknown; text?: unknown; status?: unknown }
  if (typeof live.text !== 'string' || !live.text.trim() || typeof live.version !== 'number') {
    throw new PromptLedgerError('PL_UNREACHABLE', `PromptLedger returned a malformed live prompt for ${app}/${name}`, true)
  }

  const value: LivePrompt = {
    version: live.version,
    text: live.text,
    status: (live.status as LivePrompt['status']) ?? 'live',
  }
  cache.set(cacheKey, { value, expiresAt: Date.now() + TTL_MS })
  return { source: 'live', version: value.version, text: value.text }
}
