import { describe, expect, it } from 'vitest'
import { canSubmitLeads, canViewAutomation } from '@/lib/roles'
import { isUuid, timeAgo } from '@/lib/format'
import { parseLeadFilters, parseRunFilters } from '@/lib/filters'

describe('role predicates (lib/roles)', () => {
  it('ops/admin can view automation, nobody else', () => {
    expect(canViewAutomation('operations')).toBe(true)
    expect(canViewAutomation('admin')).toBe(true)
    expect(canViewAutomation('admissions')).toBe(false)
    expect(canViewAutomation('marketing')).toBe(false)
    expect(canViewAutomation('teacher')).toBe(false)
    expect(canViewAutomation('unknown')).toBe(false)
  })

  it('admissions/admin can submit leads, nobody else', () => {
    expect(canSubmitLeads('admissions')).toBe(true)
    expect(canSubmitLeads('admin')).toBe(true)
    expect(canSubmitLeads('operations')).toBe(false)
    expect(canSubmitLeads('marketing')).toBe(false)
    expect(canSubmitLeads('teacher')).toBe(false)
    expect(canSubmitLeads('unknown')).toBe(false)
  })
})

describe('isUuid (detail-route guard)', () => {
  it('accepts standard uuid v4 shapes (any variant)', () => {
    expect(isUuid('341f0f1f-46c5-4180-85a5-95d9bd31cffa')).toBe(true)
    expect(isUuid('00000000-0000-0000-0000-000000000000')).toBe(true)
    expect(isUuid('341F0F1F-46C5-4180-85A5-95D9BD31CFFA')).toBe(true) // uppercase ok
  })

  it('rejects garbage before it can reach PostgREST', () => {
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(isUuid('')).toBe(false)
    expect(isUuid('341f0f1f46c5418085a595d9bd31cffa')).toBe(false) // no dashes
    expect(isUuid('341f0f1f-46c5-4180-85a5-95d9bd31cff')).toBe(false) // short
    expect(isUuid('341f0f1f-46c5-4180-85a5-95d9bd31cffaa')).toBe(false) // long
    expect(isUuid('g41f0f1f-46c5-4180-85a5-95d9bd31cffa')).toBe(false) // non-hex
  })
})

describe('timeAgo (non-tech friendly labels)', () => {
  it('labels recent times in plain English', () => {
    expect(timeAgo(new Date(Date.now() - 5_000).toISOString())).toBe('just now')
    expect(timeAgo(new Date(Date.now() - 3 * 60_000).toISOString())).toBe('3 minutes ago')
    expect(timeAgo(new Date(Date.now() - 60 * 60_000).toISOString())).toBe('1 hour ago')
    expect(timeAgo(new Date(Date.now() - 5 * 3_600_000).toISOString())).toBe('5 hours ago')
    expect(timeAgo(new Date(Date.now() - 2 * 86_400_000).toISOString())).toBe('2 days ago')
  })

  it('falls back to the raw input for unparseable values (never crashes)', () => {
    expect(timeAgo('not-a-date')).toBe('not-a-date')
  })
})

describe('parseLeadFilters (dashboard URL whitelist)', () => {
  it('accepts known categories, case-insensitively', () => {
    expect(parseLeadFilters({ category: 'hot' }).category).toBe('HOT')
    expect(parseLeadFilters({ category: 'COLD' }).category).toBe('COLD')
  })

  it('falls back to no filter on unknown values', () => {
    expect(parseLeadFilters({ category: 'garbage' }).category).toBeNull()
    expect(parseLeadFilters({ category: ['HOT', 'COLD'] }).category).toBeNull() // arrays rejected
    expect(parseLeadFilters({}).category).toBeNull()
  })

  it('whitelists periods, defaulting to all time', () => {
    expect(parseLeadFilters({ days: '7' }).period.days).toBe(7)
    expect(parseLeadFilters({ days: '30' }).period.days).toBe(30)
    expect(parseLeadFilters({ days: 'all' }).period.days).toBeNull()
    expect(parseLeadFilters({ days: 'yesterday' }).period.key).toBe('all')
    expect(parseLeadFilters({}).period.key).toBe('all')
  })
})

describe('parseRunFilters (logs URL whitelist + page clamp)', () => {
  it('whitelists status', () => {
    expect(parseRunFilters({ status: 'failed' }).status).toBe('failed')
    expect(parseRunFilters({ status: 'FAILED' }).status).toBeNull() // case-sensitive, falls back
    expect(parseRunFilters({ status: 'anything' }).status).toBeNull()
  })

  it('clamps the page param into a sane range', () => {
    expect(parseRunFilters({}).page).toBe(1)
    expect(parseRunFilters({ page: '3' }).page).toBe(3)
    expect(parseRunFilters({ page: '0' }).page).toBe(1)
    expect(parseRunFilters({ page: '-5' }).page).toBe(1)
    expect(parseRunFilters({ page: 'abc' }).page).toBe(1)
    expect(parseRunFilters({ page: '99999999999' }).page).toBe(10_000)
  })

  it('whitelists periods (24h / 7d for runs)', () => {
    expect(parseRunFilters({ days: '1' }).period.days).toBe(1)
    expect(parseRunFilters({ days: '30' }).period.key).toBe('all') // 30 not offered for runs
  })
})
