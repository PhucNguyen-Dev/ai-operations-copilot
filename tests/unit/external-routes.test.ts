import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { GET as listRuns, POST as startRun } from '@/app/api/external/agent/runs/route'
import { GET as getRun } from '@/app/api/external/agent/runs/[id]/route'
import { POST as provision } from '@/app/api/agent/external-clients/route'
import { checkRateLimit, resetRateLimits } from '@/lib/rate-limit'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  session: vi.fn(),
  admin: vi.fn(),
  start: vi.fn(),
  check: vi.fn(),
}))

vi.mock('@/lib/agent/external-server', () => ({ authenticateExternalClient: mocks.authenticate }))
vi.mock('@/lib/auth-server', () => ({ getApiUser: mocks.session }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }))
vi.mock('@/lib/agent/runtime', () => ({ startAgentRun: mocks.start }))
vi.mock('@/lib/agent/model', () => ({ geminiAgentModel: {} }))
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/rate-limit')>(),
  rateLimiter: { check: mocks.check },
}))

function request(body?: unknown) {
  return new NextRequest('http://localhost/api/external/agent/runs', body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

function database(data: unknown = []) {
  const query = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(), single: vi.fn().mockReturnThis(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve),
  }
  return { from: vi.fn(() => query), query }
}

const client = {
  client_id: 'client-a', created_by: 'admin-1', scopes: ['agent.run'],
  allowed_agents: ['external-lead-support'], max_runs_per_hour: 10,
}

beforeEach(() => {
  vi.clearAllMocks()
  resetRateLimits()
  mocks.check.mockImplementation(async (key, limit, window) => checkRateLimit(key, limit, window))
  mocks.session.mockResolvedValue({ userId: 'admin-1', role: 'admin' })
  mocks.start.mockResolvedValue({ runId: 'run-1', status: 'completed' })
})

afterEach(() => vi.restoreAllMocks())

describe('external run read limits', () => {
  it.each(['list', 'detail'])('limits %s before database reads and returns Retry-After', async (route) => {
    const admin = database()
    mocks.authenticate.mockResolvedValue({ client, admin })
    mocks.check.mockResolvedValue({ ok: false, retryAfterSec: 42, remaining: 0 })
    const response = route === 'list' ? await listRuns(request())
      : await getRun(request(), { params: Promise.resolve({ id: 'run-1' }) })
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('42')
    expect(mocks.check).toHaveBeenCalledWith('ext-agent-read:client-a', 60, 60_000)
    expect(admin.from).not.toHaveBeenCalled()
  })

  it('shares the read budget across routes and isolates clients', async () => {
    const admin = database()
    mocks.authenticate.mockResolvedValue({ client, admin })
    for (let i = 0; i < 60; i++) expect((await listRuns(request())).status).toBe(200)
    expect((await getRun(request(), { params: Promise.resolve({ id: 'run-1' }) })).status).toBe(429)
    mocks.authenticate.mockResolvedValue({ client: { ...client, client_id: 'client-b' }, admin })
    expect((await listRuns(request())).status).toBe(200)
    expect(admin.query.eq).toHaveBeenCalledWith('client_id', 'client-b')
  })

  it('preserves detail ownership checks before fetching the trace', async () => {
    const admin = database()
    mocks.authenticate.mockResolvedValue({ client, admin })
    expect((await getRun(request(), { params: Promise.resolve({ id: 'other-run' }) })).status).toBe(404)
    expect(admin.query.eq).toHaveBeenCalledWith('client_id', client.client_id)
    expect(admin.from).toHaveBeenCalledTimes(1)
  })

  it.each(['list', 'detail'])('rejects unauthenticated %s before limiting', async (route) => {
    mocks.authenticate.mockResolvedValue({ response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) })
    const response = route === 'list' ? await listRuns(request())
      : await getRun(request(), { params: Promise.resolve({ id: 'run-1' }) })
    expect(response.status).toBe(401)
    expect(mocks.check).not.toHaveBeenCalled()
  })
})

describe('external run attribution', () => {
  it('refuses missing created_by with 500 without starting a run', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.authenticate.mockResolvedValue({ client: { ...client, created_by: null }, admin: database() })
    const response = await startRun(request({ goal: 'Review the lead' }))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Client configuration error: provisioning user is missing' })
    expect(mocks.start).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('created_by is null'))
  })

  it('uses the actual provisioning user', async () => {
    mocks.authenticate.mockResolvedValue({ client, admin: database() })
    expect((await startRun(request({ goal: 'Review the lead' }))).status).toBe(200)
    expect(mocks.start).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: 'admin-1', clientId: 'client-a' }))
  })
})

describe('external client provisioning', () => {
  it.each([
    { allowedAgents: ['unknown-agent'] },
    { allowedAgents: ['external-lead-support', 'unknown-agent'] },
    { allowedAgents: [123] },
    { allowedAgents: ['external-lead-support', null] },
    { allowedAgents: 'external-lead-support' },
  ])('rejects invalid allowedAgents: $allowedAgents', async ({ allowedAgents }) => {
    const response = await provision(request({ name: 'Test client', allowedAgents }))
    expect(response.status).toBe(400)
    expect(mocks.admin).not.toHaveBeenCalled()
  })

  it.each([undefined, ['external-lead-support']])('provisions registered/default agents: %j', async (allowedAgents) => {
    const admin = database({ id: 'new-client' })
    mocks.admin.mockReturnValue(admin)
    expect((await provision(request({ name: 'Test client', allowedAgents }))).status).toBe(201)
    expect(admin.query.insert).toHaveBeenCalledWith(expect.objectContaining({ allowed_agents: ['external-lead-support'], created_by: 'admin-1' }))
  })
})
