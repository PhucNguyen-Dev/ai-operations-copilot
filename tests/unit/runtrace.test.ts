import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDeploymentPins, traceAiRun, type RunTrace } from '@/lib/runtrace'

const baseTrace: RunTrace = {
  app: 'ops-copilot',
  name: 'report-generator',
  promptVersion: 3,
  promptSource: 'live',
  model: 'gemini-2.0-flash',
  input: 'user message',
  output: '{"ok":true}',
  latencyMs: 42,
  ok: true,
}

describe('traceAiRun', () => {
  const originalUrl = process.env.PROMPTLEDGER_URL
  const originalKey = process.env.PROMPTLEDGER_API_KEY

  beforeEach(() => {
    resetDeploymentPins()
  })

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.PROMPTLEDGER_URL
    else process.env.PROMPTLEDGER_URL = originalUrl
    if (originalKey === undefined) delete process.env.PROMPTLEDGER_API_KEY
    else process.env.PROMPTLEDGER_API_KEY = originalKey
    vi.unstubAllGlobals()
  })

  function deploymentFetchMock(runPosts: unknown[]) {
    return vi.fn((url: string | URL, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/api/deployments?')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([]),
        } as Response)
      }
      if (u.endsWith('/api/deployments')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 77 }),
        } as Response)
      }
      runPosts.push(JSON.parse(String(init?.body)))
      return Promise.resolve({ ok: true } as Response)
    })
  }

  it('pins the deployment and posts the run to /api/runs with snake_case body', async () => {
    process.env.PROMPTLEDGER_URL = 'http://127.0.0.1:4747/'
    process.env.PROMPTLEDGER_API_KEY = 'plk_x'
    const runPosts: unknown[] = []
    const fetchMock = deploymentFetchMock(runPosts)
    vi.stubGlobal('fetch', fetchMock)

    traceAiRun(baseTrace)
    await vi.waitFor(() => expect(runPosts).toHaveLength(1))

    const runCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/api/runs')) as unknown as [
      string,
      RequestInit,
    ]
    expect(runCall[0]).toBe('http://127.0.0.1:4747/api/runs')
    expect(runCall[1].method).toBe('POST')
    expect((runCall[1].headers as Record<string, string>)['x-api-key']).toBe('plk_x')
    const body = runPosts[0] as Record<string, unknown>
    expect(body.name).toBe('report-generator')
    expect(body.prompt_version).toBe(3)
    expect(body.prompt_source).toBe('live')
    expect(body.model).toBe('gemini-2.0-flash')
    expect(body.latency_ms).toBe(42)
    expect(body.ok).toBe(true)
    expect(body.input).toBe('user message')
    expect(body.output).toBe('{"ok":true}')
    expect(body.deployment_id).toBe(77)
  })

  it('reuses an ACTIVE deployment pinning the same version (no create)', async () => {
    process.env.PROMPTLEDGER_URL = 'http://127.0.0.1:4747'
    const runPosts: unknown[] = []
    const fetchMock = vi.fn((url: string | URL, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/api/deployments?')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 41,
                status: 'active',
                items: [{ prompt_name: 'report-generator', prompt_version: 3 }],
              },
            ]),
        } as Response)
      }
      if (u.endsWith('/api/deployments')) {
        throw new Error('must not create when an active pin exists')
      }
      runPosts.push(JSON.parse(String(init?.body)))
      return Promise.resolve({ ok: true } as Response)
    })
    vi.stubGlobal('fetch', fetchMock)

    traceAiRun(baseTrace)
    await vi.waitFor(() => expect(runPosts).toHaveLength(1))
    expect((runPosts[0] as Record<string, unknown>).deployment_id).toBe(41)
    expect(
      fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/deployments'))
    ).toHaveLength(1)
  })

  it('caches the pin per prompt version (second trace does zero deployment calls)', async () => {
    process.env.PROMPTLEDGER_URL = 'http://127.0.0.1:4747'
    const runPosts: unknown[] = []
    const fetchMock = deploymentFetchMock(runPosts)
    vi.stubGlobal('fetch', fetchMock)

    traceAiRun(baseTrace)
    await vi.waitFor(() => expect(runPosts).toHaveLength(1))
    traceAiRun({ ...baseTrace, input: 'second call' })
    await vi.waitFor(() => expect(runPosts).toHaveLength(2))

    const deploymentCalls = fetchMock.mock.calls.filter(([u]) =>
      String(u).includes('/api/deployments')
    )
    expect(deploymentCalls).toHaveLength(2) // one list + one create, total
    expect((runPosts[1] as Record<string, unknown>).deployment_id).toBe(77)
  })

  it('still traces (without pin) when the deployment lookup fails — fail-open', async () => {
    process.env.PROMPTLEDGER_URL = 'http://127.0.0.1:4747'
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const runPosts: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL, init?: RequestInit) => {
        if (String(url).includes('/api/deployments')) {
          return Promise.reject(new Error('ECONNREFUSED'))
        }
        runPosts.push(JSON.parse(String(init?.body)))
        return Promise.resolve({ ok: true } as Response)
      })
    )

    traceAiRun(baseTrace)
    await vi.waitFor(() => expect(runPosts).toHaveLength(1))
    expect((runPosts[0] as Record<string, unknown>).deployment_id).toBeNull()
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('deployment pin failed'))
    consoleError.mockRestore()
  })

  it('never throws when the registry is down (fail-open telemetry)', async () => {
    process.env.PROMPTLEDGER_URL = 'http://127.0.0.1:4747'
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED 127.0.0.1:4747')))
    )

    expect(() => traceAiRun(baseTrace)).not.toThrow()
    await new Promise((r) => setTimeout(r, 10))
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('run trace failed'), expect.any(String))
    consoleError.mockRestore()
  })

  it('is a no-op when PROMPTLEDGER_URL is unset (committed mode)', async () => {
    delete process.env.PROMPTLEDGER_URL
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    traceAiRun(baseTrace)
    await new Promise((r) => setTimeout(r, 10))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
