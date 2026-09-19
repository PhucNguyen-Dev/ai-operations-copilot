#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const versions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const tools = [
  {
    name: 'list_capabilities',
    description: 'Get the authenticated client scopes and allowed agents and tools.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'run_agent_goal',
    description: 'Run a governed goal synchronously. Inspect status and error; HTTP success is not goal completion.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string', minLength: 5, maxLength: 2000 },
        agentId: { type: 'string', default: 'external-lead-support' },
      },
      required: ['goal'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_run_trace',
    description: 'Get the trace of a run owned by the authenticated client.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', minLength: 1, pattern: '^[A-Za-z0-9_-]+$' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
]

export function readConfig(env = process.env) {
  const keys = ['COPILOT_API_URL', 'COPILOT_API_CLIENT', 'COPILOT_API_SECRET']
  const missing = keys.filter((key) => !env[key]?.trim())
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
  let url
  try {
    url = new URL(env.COPILOT_API_URL)
  } catch {
    throw new Error('COPILOT_API_URL must be an absolute HTTP(S) base URL')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('COPILOT_API_URL must be HTTP(S), without credentials, query or fragment')
  }
  return { base: url.href.replace(/\/+$/, ''), client: env.COPILOT_API_CLIENT, secret: env.COPILOT_API_SECRET }
}

const toolResult = (data, isError = false) => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
  isError,
})

export function createAdapter(config, fetchImpl = fetch) {
  let initialized = false
  let ready = false

  async function callTool(params) {
    const tool = tools.find((entry) => entry.name === params?.name)
    if (!tool) return { error: { code: -32602, message: 'Unknown tool' } }
    const args = params.arguments ?? {}
    const properties = tool.inputSchema.properties
    if (!object(args) || Object.keys(args).some((key) => !Object.hasOwn(properties, key))) {
      return { error: { code: -32602, message: 'Invalid tool arguments' } }
    }
    let path = '/api/external/agent/tools'
    let body
    if (tool.name === 'run_agent_goal') {
      if (typeof args.goal !== 'string' || args.goal.trim().length < 5 || args.goal.trim().length > 2000 ||
          (args.agentId !== undefined && typeof args.agentId !== 'string')) {
        return { error: { code: -32602, message: 'goal must be 5-2000 trimmed characters; agentId must be a string' } }
      }
      path = '/api/external/agent/runs'
      body = JSON.stringify({ goal: args.goal.trim(), ...(args.agentId !== undefined ? { agentId: args.agentId } : {}) })
    } else if (tool.name === 'get_run_trace') {
      if (typeof args.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(args.id)) {
        return { error: { code: -32602, message: 'id must be a nonempty run identifier' } }
      }
      path = `/api/external/agent/runs/${encodeURIComponent(args.id)}`
    }
    let response
    let text
    try {
      response = await fetchImpl(`${config.base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'x-api-client': config.client,
          'x-api-secret': config.secret,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body,
        redirect: 'manual',
      })
      text = await response.text()
    } catch {
      return { result: toolResult({ code: 'TRANSPORT_FAILURE', message: 'External API transport failed; no retry was attempted', ...(response ? { status: response.status } : {}) }, true) }
    }
    let data
    try {
      data = JSON.parse(text)
    } catch {
      data = text
      if (response.ok) return { result: toolResult({ code: 'INVALID_API_RESPONSE', status: response.status, message: 'External API returned non-JSON success' }, true) }
    }
    if (!response.ok) {
      return { result: toolResult({
        code: `HTTP_${response.status}`,
        status: response.status,
        body: data,
        ...(response.headers.has('Retry-After') ? { retryAfter: response.headers.get('Retry-After') } : {}),
      }, true) }
    }
    return { result: toolResult(data) }
  }

  return async function handle(message) {
    const validId = typeof message?.id === 'string' || (typeof message?.id === 'number' && Number.isFinite(message.id))
    const reply = (payload) => ({ jsonrpc: '2.0', id: validId ? message.id : null, ...payload })
    const error = (code, text) => reply({ error: { code, message: text } })
    if (!object(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' ||
        (Object.hasOwn(message, 'id') && !validId)) return error(-32600, 'Invalid Request')
    if (!Object.hasOwn(message, 'id')) {
      if (message.method === 'notifications/initialized' && initialized) ready = true
      return null
    }
    if (message.params !== undefined && !object(message.params)) return error(-32602, 'Invalid params')
    if (message.method === 'initialize') {
      const params = message.params
      if (initialized || typeof params?.protocolVersion !== 'string' || !object(params.capabilities) ||
          !object(params.clientInfo) || typeof params.clientInfo.name !== 'string' || typeof params.clientInfo.version !== 'string') {
        return error(-32602, 'Invalid initialize params or already initialized')
      }
      initialized = true
      return reply({ result: {
        protocolVersion: versions.includes(params.protocolVersion) ? params.protocolVersion : versions[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'copilot-mcp', version: '1.0.0' },
      } })
    }
    if (message.method === 'ping') return reply({ result: {} })
    if (!ready) return error(-32002, 'Server not initialized')
    if (message.method === 'tools/list') return reply({ result: { tools } })
    if (message.method === 'tools/call') return reply(await callTool(message.params))
    return error(-32601, 'Method not found')
  }
}

export function startStdio(config) {
  const handle = createAdapter(config)
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
  const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
  input.on('line', async (line) => {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      return
    }
    try {
      const reply = await handle(message)
      if (reply) send(reply)
    } catch {
      console.error('MCP request failed')
      if (message?.id !== undefined) send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'Internal error' } })
    }
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    startStdio(readConfig())
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
