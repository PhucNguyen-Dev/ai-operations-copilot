import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as decide } from '@/app/api/agent/approvals/[id]/route'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  serverClient: vi.fn(),
  admin: vi.fn(),
  storeDecide: vi.fn(),
  storeGetApproval: vi.fn(),
  storeGetRun: vi.fn(),
  resume: vi.fn(),
}))

vi.mock('@/lib/auth-server', () => ({ getApiUser: mocks.session }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.serverClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }))
vi.mock('@/lib/agent/model', () => ({ geminiAgentModel: {} }))
vi.mock('@/lib/agent/runtime', () => ({ resumeAgentRun: mocks.resume }))

vi.mock('@/lib/agent/store', () => ({
  SupabaseAgentStateStore: class {
    async decideApproval(...args: unknown[]) { return mocks.storeDecide(...args) }
    async getApproval(...args: unknown[]) { return mocks.storeGetApproval(...args) }
    async getRun(...args: unknown[]) { return mocks.storeGetRun(...args) }
  },
}))

function request(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/agent/approvals/${id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

function userDatabase(approval: Record<string, unknown> | null) {
  const query = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: approval ? [approval] : [], error: null }).then(resolve),
  }
  return { from: vi.fn(() => query), query }
}

const APPROVAL = { id: 'approval-1', run_id: 'run-1', status: 'pending', requested_by: 'user-1' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ userId: 'ops-1', role: 'operations' })
  mocks.admin.mockReturnValue({})
  mocks.resume.mockResolvedValue({ runId: 'run-1', status: 'completed' })
  // Default: the run is live and untouched by migration 024's stop path.
  mocks.storeGetRun.mockResolvedValue({ id: 'run-1', status: 'running' })
})

afterEach(() => vi.restoreAllMocks())

describe('agent approvals decision route', () => {
  it('rejects a self-decision before any mutation', async () => {
    mocks.session.mockResolvedValue({ userId: 'user-1', role: 'admin' })
    mocks.serverClient.mockResolvedValue(userDatabase(APPROVAL))
    const response = await decide(request('approval-1', { decision: 'approved' }), { params: Promise.resolve({ id: 'approval-1' }) })
    expect(response.status).toBe(403)
    expect(mocks.storeDecide).not.toHaveBeenCalled()
    expect(mocks.resume).not.toHaveBeenCalled()
  })

  it('rejects a decision from a non-automation role before any mutation', async () => {
    mocks.session.mockResolvedValue({ userId: 'ops-1', role: 'admissions' })
    mocks.serverClient.mockResolvedValue(userDatabase(APPROVAL))
    const response = await decide(request('approval-1', { decision: 'approved' }), { params: Promise.resolve({ id: 'approval-1' }) })
    expect(response.status).toBe(403)
    expect(mocks.storeDecide).not.toHaveBeenCalled()
  })

  it('retries the same immutable decision and resumes without re-deciding', async () => {
    mocks.serverClient.mockResolvedValue(userDatabase({ ...APPROVAL, status: 'approved' }))
    mocks.storeDecide.mockResolvedValue(null)
    mocks.storeGetApproval.mockResolvedValue({ id: 'approval-1', run_id: 'run-1', status: 'approved' })
    const response = await decide(request('approval-1', { decision: 'approved' }), { params: Promise.resolve({ id: 'approval-1' }) })
    expect(response.status).toBe(200)
    expect(mocks.storeDecide).toHaveBeenCalledWith('approval-1', 'approved', 'ops-1', null)
    expect(mocks.resume).toHaveBeenCalledWith(expect.anything(), { runId: 'run-1', approvalId: 'approval-1' })
    const body = await response.json()
    expect(body.approval.status).toBe('approved')
  })

  it('refuses a decision on a cancelled run instead of resurrecting it', async () => {
    // Migration 024: stopping a suspended run withdraws its pending
    // approval, so the decision finds nothing to decide. The run must not
    // resume, and the operator gets a reason rather than a generic 409.
    mocks.serverClient.mockResolvedValue(userDatabase({ ...APPROVAL, status: 'rejected' }))
    mocks.storeDecide.mockResolvedValue(null)
    mocks.storeGetRun.mockResolvedValue({ id: 'run-1', status: 'cancelled' })
    const response = await decide(request('approval-1', { decision: 'approved' }), { params: Promise.resolve({ id: 'approval-1' }) })
    expect(response.status).toBe(409)
    expect(mocks.resume).not.toHaveBeenCalled()
    const body = await response.json()
    expect(body.error).toMatch(/cancelled/i)
  })

  it('refuses a decision on a run cancelled while the inbox still showed it pending', async () => {
    // The realistic race: the browser holds a stale 'pending' view, the
    // row was already withdrawn, so the decision returns null. Same
    // refusal, same reason — the run must not come back to life.
    mocks.serverClient.mockResolvedValue(userDatabase(APPROVAL))
    mocks.storeDecide.mockResolvedValue(null)
    mocks.storeGetRun.mockResolvedValue({ id: 'run-1', status: 'cancelled' })
    const response = await decide(request('approval-1', { decision: 'approved' }), { params: Promise.resolve({ id: 'approval-1' }) })
    expect(response.status).toBe(409)
    expect(mocks.resume).not.toHaveBeenCalled()
    const body = await response.json()
    expect(body.error).toMatch(/cancelled/i)
  })

  it('refuses a conflicting decision on an already-decided approval', async () => {
    mocks.serverClient.mockResolvedValue(userDatabase({ ...APPROVAL, status: 'rejected' }))
    const response = await decide(request('approval-1', { decision: 'approved' }), { params: Promise.resolve({ id: 'approval-1' }) })
    expect(response.status).toBe(409)
    expect(mocks.storeDecide).not.toHaveBeenCalled()
    expect(mocks.resume).not.toHaveBeenCalled()
  })

  it('decides a pending approval once and resumes exactly once', async () => {
    mocks.serverClient.mockResolvedValue(userDatabase(APPROVAL))
    mocks.storeDecide.mockResolvedValue({ id: 'approval-1', run_id: 'run-1', status: 'approved' })
    const response = await decide(request('approval-1', { decision: 'approved' }), { params: Promise.resolve({ id: 'approval-1' }) })
    expect(response.status).toBe(200)
    expect(mocks.storeDecide).toHaveBeenCalledTimes(1)
    expect(mocks.resume).toHaveBeenCalledTimes(1)
    expect(mocks.resume).toHaveBeenCalledWith(expect.anything(), { runId: 'run-1', approvalId: 'approval-1' })
  })
})
