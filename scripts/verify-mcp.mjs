#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const live = process.env.RUN_MCP_LIVE === '1'
const env = {
  ...process.env,
  COPILOT_API_URL: process.env.COPILOT_API_URL || 'http://localhost:3000',
  COPILOT_API_CLIENT: process.env.COPILOT_API_CLIENT || (live ? '' : 'offline-verifier'),
  COPILOT_API_SECRET: process.env.COPILOT_API_SECRET || (live ? '' : 'offline-verifier'),
}
const child = spawn(process.execPath, [fileURLToPath(new URL('../mcp/server.mjs', import.meta.url))], {
  env, stdio: ['pipe', 'pipe', 'pipe'],
})
const pending = new Map()
let nextId = 0
let stopping = false
let failure
const failPending = (error) => {
  failure = error
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer)
    reject(error)
  }
  pending.clear()
}
child.on('error', () => failPending(new Error('Could not start MCP child')))
child.on('exit', (code) => {
  if (!stopping) failPending(new Error(`MCP child exited unexpectedly (${code})`))
})
child.stdin.on('error', () => {
  if (!stopping) failPending(new Error('MCP stdin failed'))
})
child.stderr.pipe(process.stderr)
const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
lines.on('line', (line) => {
  try {
    const reply = JSON.parse(line)
    assert.equal(reply.jsonrpc, '2.0')
    const item = pending.get(reply.id)
    assert.ok(item, 'Unexpected response id')
    pending.delete(reply.id)
    clearTimeout(item.timer)
    if (reply.error) item.reject(new Error(`JSON-RPC error ${reply.error.code}: ${reply.error.message}`))
    else item.resolve(reply.result)
  } catch {
    failPending(new Error('Invalid MCP stdout protocol response'))
  }
})

function request(method, params = {}) {
  if (failure) return Promise.reject(failure)
  const id = ++nextId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Timed out: ${method}; no retry attempted`))
    }, live ? 180_000 : 10_000)
    pending.set(id, { resolve, reject, timer })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })
}

function toolData(result) {
  assert.ok(Array.isArray(result?.content), 'Missing tool content')
  const data = JSON.parse(result.content[0].text)
  if (result.isError) throw new Error(`Tool failed: ${data.code}; status=${data.status ?? 'none'}; Retry-After=${data.retryAfter ?? 'none'}`)
  return data
}

try {
  const init = await request('initialize', {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'verify-mcp', version: '1.0.0' },
  })
  assert.equal(init.protocolVersion, '2025-11-25')
  assert.deepEqual(init.capabilities, { tools: {} })
  console.log('PASS initialize negotiation (tools only)')
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
  const { tools } = await request('tools/list')
  assert.deepEqual(tools.map((tool) => tool.name), ['list_capabilities', 'run_agent_goal', 'get_run_trace'])
  for (const tool of tools) assert.equal(tool.inputSchema.type, 'object')
  console.log('PASS tools/list (3 tools with schemas)')
  if (live) {
    assert.ok(env.COPILOT_API_CLIENT.trim() && env.COPILOT_API_SECRET.trim(), 'Live mode requires provisioned credentials')
    toolData(await request('tools/call', { name: 'list_capabilities', arguments: {} }))
    console.log('PASS live capability discovery')
    const run = toolData(await request('tools/call', {
      name: 'run_agent_goal', arguments: { goal: 'Summarize the available synthetic leads and cite the follow-up SOP.' },
    }))
    assert.equal(typeof run.runId, 'string')
    assert.ok(run.runId.length > 0, 'Missing runId')
    assert.ok(['completed', 'escalated', 'awaiting_approval'].includes(run.status) && !run.error, 'Run failed or returned an unexpected status')
    console.log(`PASS live run (${run.status}; not necessarily completed)`)
    const trace = toolData(await request('tools/call', { name: 'get_run_trace', arguments: { id: run.runId } }))
    assert.equal(trace.run?.id, run.runId)
    assert.ok(Array.isArray(trace.steps) && Array.isArray(trace.approvals), 'Invalid trace')
    console.log('PASS live run trace')
  } else {
    console.log('SKIP live API calls (set RUN_MCP_LIVE=1 with provisioned credentials)')
  }
  if (failure) throw failure
  process.exitCode = 0
} catch (error) {
  console.error(`FAIL ${error.message}`)
  process.exitCode = 1
} finally {
  stopping = true
  for (const { timer } of pending.values()) clearTimeout(timer)
  pending.clear()
  lines.close()
  child.stdin.end()
  child.kill()
}
