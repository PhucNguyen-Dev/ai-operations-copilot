import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { searchKnowledgeTool } from '@/lib/agent/tools/knowledge'
import { prepareEmailTool } from '@/lib/agent/tools/comms'
import { testContext } from './helpers/agent-test-kit'

const embedding = vi.hoisted(() => vi.fn())
vi.mock('@/lib/gemini', () => ({ generateEmbedding: embedding }))

beforeEach(() => {
  vi.clearAllMocks()
  embedding.mockResolvedValue({ ok: false })
})

describe('knowledge keyword fallback', () => {
  function database() {
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [
        { title: 'Policy', doc_type: 'sop', department: 'admissions', content: 'Visible policy', allowed_roles: ['admissions'] },
        { title: 'Private', doc_type: 'sop', department: 'operations', content: 'Hidden', allowed_roles: ['operations'] },
      ], error: null }).then(resolve),
    }
    return { from: vi.fn(() => query), query }
  }

  it('sanitizes PostgREST punctuation and wildcard characters while preserving role and department filters', async () => {
    const db = database()
    const out = await searchKnowledgeTool.execute(testContext({ userClient: db as unknown as SupabaseClient }), {
      query: 'Policy, (course). "fees" \\ %_*: discount', department: 'admissions',
    })
    expect(db.query.or).toHaveBeenCalledWith('title.ilike.%Policy course fees discount%,content.ilike.%Policy course fees discount%')
    expect(db.query.eq).toHaveBeenCalledWith('department', 'admissions')
    expect(db.query.eq).toHaveBeenCalledWith('is_active', true)
    expect(out).toEqual({ ok: true, result: { results: [
      { title: 'Policy', doc_type: 'sop', department: 'admissions', excerpt: 'Visible policy' },
    ] } })
  })

  it('keeps Unicode search terms', async () => {
    const db = database()
    await searchKnowledgeTool.execute(testContext({ userClient: db as unknown as SupabaseClient }), { query: 'học phí', department: null })
    expect(db.query.or).toHaveBeenCalledWith('title.ilike.%học phí%,content.ilike.%học phí%')
  })

  it('does not turn punctuation-only input into a match-all query', async () => {
    const db = database()
    expect(await searchKnowledgeTool.execute(testContext({ userClient: db as unknown as SupabaseClient }), {
      query: ',().:"\\%_*', department: null,
    })).toEqual({ ok: true, result: { results: [] } })
    expect(db.from).not.toHaveBeenCalled()
  })

  it('leaves parameterized requester reads unchanged', async () => {
    const requesterRead = vi.fn().mockResolvedValue([])
    await searchKnowledgeTool.execute(testContext({ requesterRead }), { query: 'course, fees', department: null })
    expect(requesterRead).toHaveBeenCalledWith('knowledge_keyword', { query: 'course, fees', department: null })
  })
})

describe('prepare_email recipient validation', () => {
  const args = { lead_id: 'lead-1', subject: 'Course information', body: 'Your requested information.' }

  it.each([null, undefined, 123, '', 'not-an-email', 'a@b', 'a b@example.com', 'a@example.com\r\nBcc: b@example.com', 'a@example.com,b@example.com', 'Name <a@example.com>'])('refuses invalid recipient %j before recording', async (email) => {
    const from = vi.fn()
    const ctx = testContext({
      requesterRead: vi.fn().mockResolvedValue({ id: 'lead-1', email }),
      adminClient: { from } as unknown as SupabaseClient,
    })
    expect(await prepareEmailTool.execute(ctx, args)).toEqual({
      ok: false, error: 'INVALID_ARGUMENTS: lead email must be a valid recipient address', retryable: false,
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('records a valid recipient derived from the visible lead', async () => {
    const query = { insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { id: 'email-1' }, error: null }) }
    const ctx = testContext({
      requesterRead: vi.fn().mockResolvedValue({ id: 'lead-1', email: 'student+course@example.com' }),
      adminClient: { from: vi.fn(() => query) } as unknown as SupabaseClient,
    })
    expect(await prepareEmailTool.execute(ctx, args)).toEqual({ ok: true, result: { email_id: 'email-1', to_address: 'student+course@example.com', status: 'dry_run' } })
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({ to_address: 'student+course@example.com', status: 'dry_run' }))
  })

  it('preserves the refusal path for an invisible lead', async () => {
    const from = vi.fn()
    const ctx = testContext({ requesterRead: vi.fn().mockResolvedValue(null), adminClient: { from } as unknown as SupabaseClient })
    expect(await prepareEmailTool.execute(ctx, args)).toEqual({ ok: false, error: 'LEAD_NOT_FOUND: no such lead in your visible scope', retryable: false })
    expect(from).not.toHaveBeenCalled()
  })
})
