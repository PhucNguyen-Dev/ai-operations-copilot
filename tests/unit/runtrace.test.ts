import { afterEach, describe, expect, it, vi } from 'vitest'
import { traceAiRun, type RunTrace } from '@/lib/runtrace'

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

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.PROMPTLEDGER_URL
    else process.env.PROMPTLEDGER_URL = originalUrl
    if (originalKey === undefined) delete process.env.PROMPTLEDGER_API_KEY
    else process.env.PROMPTLEDGER_API_KEY = originalKey
    vi.unstubAllGlobals()
  })

  it('posts the run to /api/runs with the key header and snake_case body', async () => {
    process.env.PROMPTLEDGER_URL = 'http://127.0.0.1:4747/'
    process.env.PROMPTLEDGER_API_KEY = 'plk_x'
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true } as Response))
    vi.stubGlobal('fetch', fetchMock)

    traceAiRun(baseTrace)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:4747/api/runs')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('plk_x')
    const body = JSON.parse(String(init.body))
    expect(body.name).toBe('report-generator')
    expect(body.prompt_version).toBe(3)
    expect(body.prompt_source).toBe('live')
    expect(body.model).toBe('gemini-2.0-flash')
    expect(body.latency_ms).toBe(42)
    expect(body.ok).toBe(true)
    expect(body.input).toBe('user message')
    expect(body.output).toBe('{"ok":true}')
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
