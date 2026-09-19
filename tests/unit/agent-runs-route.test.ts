import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as startRun } from '@/app/api/agent/runs/route'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  serverClient: vi.fn(),
  admin: vi.fn(),
  check: vi.fn(),
  start: vi.fn(),
}))

vi.mock('@/lib/auth-server', () => ({ getApiUser: mocks.session }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.serverClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }))
vi.mock('@/lib/agent/model', () => ({ geminiAgentModel: {} }))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: mocks.check } }))
vi.mock('@/lib/agent/runtime', () => ({ startAgentRun: mocks.start }))

function request(body: unknown) {
  return new NextRequest('http://localhost/api/agent/runs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ userId: 'user-1', role: 'admissions' })
  mocks.serverClient.mockResolvedValue({})
  mocks.admin.mockReturnValue({})
  mocks.check.mockResolvedValue({ ok: true, retryAfterSec: 0, remaining: 1 })
  mocks.start.mockResolvedValue({ runId: 'r1', status: 'completed', finalOutcome: null, error: null, pendingApprovalId: null, stepCount: 0 })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('agent runs route — approval policy combination', () => {
  it.each([
    { env: 'false', request: false },
    { env: 'false', request: true },
    { env: 'true', request: false },
    { env: 'true', request: true },
  ])('env GMAIL_AGENT_DRY_RUN=$env with requireApproval=$request passes the server flag and the opt-in separately', async ({ env, request: req }) => {
    vi.stubEnv('GMAIL_AGENT_DRY_RUN', env)
    await startRun(request({ goal: 'Review the lead and follow up', requireApproval: req }))
    expect(mocks.start).toHaveBeenCalledTimes(1)
    const [deps, input] = mocks.start.mock.calls[0]
    expect(deps.dryRunEmail).toBe(env !== 'false')
    expect(input.requireApproval).toBe(req)
  })

  it('cannot weaken a server-required approval via requireApproval=false', async () => {
    vi.stubEnv('GMAIL_AGENT_DRY_RUN', 'false')
    await startRun(request({ goal: 'Review the lead and follow up', requireApproval: false }))
    const [deps] = mocks.start.mock.calls[0]
    expect(deps.dryRunEmail).toBe(false)
  })
})
