import { describe, it, expect, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { createAdapter, readConfig } from '../../mcp/server.mjs'

const env = {
  NODE_ENV: 'test' as const,
  COPILOT_API_URL: 'http://localhost:3000/',
  COPILOT_API_CLIENT: 'ac_test',
  COPILOT_API_SECRET: 'test-secret',
}
const initialize = (protocolVersion = '2025-11-25') => ({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion, capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
})
const request = (method: string, params = {}) => ({ jsonrpc: '2.0', id: 2, method, params })
const mockFetch = () => vi.fn<typeof fetch>()

async function setup(fetchImpl = mockFetch()) {
  const handle = createAdapter(readConfig(env), fetchImpl)
  await handle(initialize())
  await handle({ jsonrpc: '2.0', method: 'notifications/initialized' })
  return { handle, fetchImpl }
}

async function call(handle: ReturnType<typeof createAdapter>, name = 'list_capabilities', args = {}) {
  const reply = await handle(request('tools/call', { name, arguments: args }))
  expect(reply?.error).toBeUndefined()
  return { result: reply!.result, data: JSON.parse(reply!.result.content[0].text) }
}

describe('MCP thin adapter', () => {
  it.each(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'])('negotiates supported protocol %s', async (version) => {
    const handle = createAdapter(readConfig(env), mockFetch())
    expect(await handle(initialize(version))).toEqual({
      jsonrpc: '2.0', id: 1,
      result: { protocolVersion: version, capabilities: { tools: {} }, serverInfo: { name: 'copilot-mcp', version: '1.0.0' } },
    })
  })

  it('offers its preferred version for an unsupported protocol', async () => {
    const handle = createAdapter(readConfig(env), mockFetch())
    expect((await handle(initialize('unknown')))?.result.protocolVersion).toBe('2025-11-25')
  })

  it('requires initialization and the initialized notification', async () => {
    const handle = createAdapter(readConfig(env), mockFetch())
    expect((await handle(request('tools/list')))?.error.code).toBe(-32002)
    await handle(initialize())
    expect((await handle(request('tools/list')))?.error.code).toBe(-32002)
    expect(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
    expect((await handle(request('tools/list')))?.result.tools).toHaveLength(3)
  })

  it('lists exactly three tools with input schemas without calling the API', async () => {
    const { handle, fetchImpl } = await setup()
    const tools = (await handle(request('tools/list')))?.result.tools
    expect(tools.map((tool: { name: string }) => tool.name)).toEqual(['list_capabilities', 'run_agent_goal', 'get_run_trace'])
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object')
      expect(tool.inputSchema.additionalProperties).toBe(false)
      expect(tool.inputSchema.properties).toBeDefined()
    }
    expect(tools[1].inputSchema.required).toEqual(['goal'])
    expect(tools[1].inputSchema.properties.goal).toMatchObject({ minLength: 5, maxLength: 2000 })
    expect(tools[2].inputSchema.required).toEqual(['id'])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    ['list_capabilities', {}, '/api/external/agent/tools', 'GET', { scopes: ['agent.run'], agents: [] }],
    ['run_agent_goal', { goal: '  Summarize leads  ', agentId: 'external-lead-support' }, '/api/external/agent/runs', 'POST', { runId: 'run-1', status: 'failed', error: 'Model unavailable' }],
    ['get_run_trace', { id: 'run-1' }, '/api/external/agent/runs/run-1', 'GET', { run: { id: 'run-1' }, steps: [], approvals: [] }],
  ] as const)('maps %s HTTP 200 and preserves the API payload', async (name, args, path, method, payload) => {
    const { handle, fetchImpl } = await setup()
    fetchImpl.mockResolvedValue(new Response(JSON.stringify(payload)))
    const { result, data } = await call(handle, name, args)
    expect(result.isError).toBe(false)
    expect(data).toEqual(payload)
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(`http://localhost:3000${path}`, {
      method,
      headers: { 'x-api-client': env.COPILOT_API_CLIENT, 'x-api-secret': env.COPILOT_API_SECRET, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      body: method === 'POST' ? JSON.stringify({ goal: 'Summarize leads', agentId: 'external-lead-support' }) : undefined,
      redirect: 'manual',
    })
  })

  it.each([401, 403, 429, 500, 503, 404])('maps HTTP %s to a tool error without retrying', async (status) => {
    const { handle, fetchImpl } = await setup()
    fetchImpl.mockResolvedValue(new Response(JSON.stringify({ error: 'API error' }), {
      status, headers: status === 429 ? { 'Retry-After': '60' } : {},
    }))
    const { result, data } = await call(handle)
    expect(result.isError).toBe(true)
    expect(data).toEqual({ code: `HTTP_${status}`, status, body: { error: 'API error' }, ...(status === 429 ? { retryAfter: '60' } : {}) })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('preserves an HTTP-date Retry-After and non-JSON error body', async () => {
    const { handle, fetchImpl } = await setup()
    const retryAfter = 'Fri, 18 Sep 2026 12:00:00 GMT'
    fetchImpl.mockResolvedValue(new Response('Slow down', { status: 429, headers: { 'Retry-After': retryAfter } }))
    expect((await call(handle)).data).toEqual({ code: 'HTTP_429', status: 429, retryAfter, body: 'Slow down' })
  })

  it('maps network errors to a transport code without leaking credentials or retrying', async () => {
    const { handle, fetchImpl } = await setup()
    fetchImpl.mockRejectedValue(new Error(env.COPILOT_API_SECRET))
    const { result, data } = await call(handle)
    expect(result.isError).toBe(true)
    expect(data.code).toBe('TRANSPORT_FAILURE')
    expect(JSON.stringify(data)).not.toContain(env.COPILOT_API_SECRET)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('reports invalid JSON success as a tool error', async () => {
    const { handle, fetchImpl } = await setup()
    fetchImpl.mockResolvedValue(new Response('<html>not JSON</html>'))
    const { result, data } = await call(handle)
    expect(result.isError).toBe(true)
    expect(data).toMatchObject({ code: 'INVALID_API_RESPONSE', status: 200 })
  })

  it.each([
    { name: 'unknown' },
    { name: 'run_agent_goal', arguments: { goal: '   abcd   ' } },
    { name: 'run_agent_goal', arguments: { goal: 'a'.repeat(2001) } },
    { name: 'run_agent_goal', arguments: { goal: 'Valid goal', agentId: 42 } },
    { name: 'get_run_trace', arguments: { id: '../tools' } },
    { name: 'get_run_trace', arguments: {} },
    { name: 'list_capabilities', arguments: { url: 'http://other' } },
  ])('rejects invalid tool call %# before HTTP', async (params) => {
    const { handle, fetchImpl } = await setup()
    expect((await handle(request('tools/call', params)))?.error.code).toBe(-32602)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('handles ping, unsupported methods, invalid requests and silent notifications', async () => {
    const { handle } = await setup()
    expect((await handle(request('ping')))?.result).toEqual({})
    expect((await handle(request('resources/list')))?.error.code).toBe(-32601)
    expect((await handle(request('prompts/list')))?.error.code).toBe(-32601)
    expect((await handle([]))?.error.code).toBe(-32600)
    expect(await handle({ jsonrpc: '2.0', method: 'unknown' })).toBeNull()
  })

  it.each(['COPILOT_API_URL', 'COPILOT_API_CLIENT', 'COPILOT_API_SECRET'])('fails cleanly when %s is unset', (key) => {
    expect(() => readConfig({ ...env, [key]: '' })).toThrow(`Missing required environment variables: ${key}`)
  })

  it.each(['not a URL', 'file:///tmp/api', 'https://user:password@example.com', 'http://localhost:3000?secret=bad'])('rejects invalid base URL %s', (url) => {
    expect(() => readConfig({ ...env, COPILOT_API_URL: url })).toThrow('COPILOT_API_URL')
  })

  it('exits nonzero with stderr only for missing startup configuration', async () => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../mcp/server.mjs', import.meta.url))], {
      env: { ...process.env, COPILOT_API_URL: '', COPILOT_API_CLIENT: '', COPILOT_API_SECRET: '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    const [code] = await once(child, 'close')
    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('Missing required environment variables: COPILOT_API_URL, COPILOT_API_CLIENT, COPILOT_API_SECRET')
  })

  it('speaks newline-delimited JSON-RPC on stdout and survives a parse error', async () => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../mcp/server.mjs', import.meta.url))], {
      env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.stdin.end(`not-json\n${JSON.stringify(initialize())}\n${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n${JSON.stringify(request('tools/list'))}\n`)
    const [code] = await once(child, 'close')
    expect(code).toBe(0)
    expect(stderr).toBe('')
    const replies = stdout.trim().split('\n').map((line) => JSON.parse(line))
    expect(replies).toHaveLength(3)
    expect(replies.find((reply) => reply.id === null).error.code).toBe(-32700)
    expect(replies.find((reply) => reply.id === 1).result.protocolVersion).toBe('2025-11-25')
    expect(replies.find((reply) => reply.id === 2).result.tools).toHaveLength(3)
  })
})
