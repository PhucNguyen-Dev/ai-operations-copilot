// Pure URL-param parsing for the dashboard and logs pages (R-01).
// Whitelist discipline: unknown values fall back to "no filter" — callers
// never see garbage from the URL.

export type ParamBag = Record<string, string | string[] | undefined>

export type Period = { key: string; label: string; days: number | null }

export const LEAD_CATEGORIES = ['HOT', 'WARM', 'COLD'] as const
export type LeadCategory = (typeof LEAD_CATEGORIES)[number]

export const LEAD_PERIODS: Period[] = [
  { key: 'all', label: 'All time', days: null },
  { key: '7', label: '7 days', days: 7 },
  { key: '30', label: '30 days', days: 30 },
]

export type LeadFilters = {
  category: LeadCategory | null
  period: Period
}

export function parseLeadFilters(params: ParamBag): LeadFilters {
  const raw = typeof params.category === 'string' ? params.category.toUpperCase() : ''
  const category = (LEAD_CATEGORIES as readonly string[]).includes(raw) ? (raw as LeadCategory) : null
  const period = LEAD_PERIODS.find((p) => p.key === (typeof params.days === 'string' ? params.days : 'all')) ?? LEAD_PERIODS[0]
  return { category, period }
}

export const RUN_STATUSES = ['running', 'success', 'failed'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

export const RUN_PERIODS: Period[] = [
  { key: 'all', label: 'All time', days: null },
  { key: '1', label: '24 hours', days: 1 },
  { key: '7', label: '7 days', days: 7 },
]

export type RunFilters = {
  status: RunStatus | null
  period: Period
  /** Always >= 1 and <= MAX_PAGE — garbage URLs land on a sane page. */
  page: number
}

export const RUNS_PAGE_SIZE = 20
export const RUNS_MAX_PAGE = 10_000

export function parseRunFilters(params: ParamBag): RunFilters {
  const raw = typeof params.status === 'string' ? params.status : ''
  const status = (RUN_STATUSES as readonly string[]).includes(raw) ? (raw as RunStatus) : null
  const period = RUN_PERIODS.find((p) => p.key === (typeof params.days === 'string' ? params.days : 'all')) ?? RUN_PERIODS[0]
  const parsed = Number.parseInt(typeof params.page === 'string' ? params.page : '1', 10)
  const page = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, RUNS_MAX_PAGE) : 1
  return { status, period, page }
}
