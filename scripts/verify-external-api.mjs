#!/usr/bin/env node
// =============================================================
// Phase 9 Milestone E — live verification of the external API:
// 1. provision a temp client (direct DB via service key — the
//    provisioning ROUTE is session-authenticated and covered by ops UI),
// 2. GET capability discovery,
// 3. POST a goal → governed run,
// 4. GET the run's trace ("traceable result"),
// 5. verify a wrong secret is rejected, then clean up the client.
// Requires migration 012 + dev server on :3000 + GEMINI_API_KEY.
// =============================================================

import { readFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'

const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8')
const env = {}
for (const line of raw.split(/\r?\n/)) {
  const eq = line.indexOf('=')
  if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
}
const REST = `${env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, '')}/rest/v1`
const SVC = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }
const BASE = process.env.EXTERNAL_BASE_URL || 'http://localhost:3000'

const clientId = `ac_${randomBytes(8).toString('hex')}`
const secret = `sk_${randomBytes(32).toString('base64url')}`
const secretHash = createHash('sha256').update(secret, 'utf8').digest('hex')

// Find the provisioning admin for attribution (ops/admin demo user).
const admins = await fetch(`${REST}/profiles?role=eq.admin&select=id&limit=1`, { headers: SVC }).then((r) => r.json())
const createdBy = admins[0]?.id

const ins = await fetch(`${REST}/agent_api_clients`, {
  method: 'POST', headers: { ...SVC, Prefer: 'return=minimal' },
  body: JSON.stringify({ name: 'verify-external-api', client_id: clientId, secret_hash: secretHash, created_by: createdBy }),
})
if (!ins.ok) { console.error('client insert failed:', ins.status, await ins.text()); process.exit(1) }
console.log('client provisioned:', clientId)

const HEADERS = { 'x-api-client': clientId, 'x-api-secret': secret, 'Content-Type': 'application/json' }
try {
  // Wrong secret must be rejected (401)
  const bad = await fetch(`${BASE}/api/external/agent/runs`, {
    method: 'POST', headers: { ...HEADERS, 'x-api-secret': 'sk_wrong' }, body: JSON.stringify({ goal: 'test' }),
  })
  console.log('wrong-secret check:', bad.status, bad.status === 401 ? 'OK' : 'FAIL')

  // Capability discovery
  const tools = await fetch(`${BASE}/api/external/agent/tools`, { headers: HEADERS }).then((r) => r.json())
  console.log('capability discovery:', JSON.stringify(tools))

  // Governed run
  const run = await fetch(`${BASE}/api/external/agent/runs`, {
    method: 'POST', headers: HEADERS,
    body: JSON.stringify({ goal: 'Search your visible leads and summarize the newest one: name, category and the recommended next step from its analysis.' }),
  }).then((r) => r.json())
  console.log('run:', JSON.stringify(run))
  if (!['completed', 'escalated', 'awaiting_approval', 'failed'].includes(run.status)) throw new Error('unexpected run status')

  // Traceable result
  const trace = await fetch(`${BASE}/api/external/agent/runs/${run.runId}`, { headers: HEADERS }).then((r) => r.json())
  console.log('trace steps:', (trace.steps || []).map((s) => `${s.tool_name}:${s.status}`).join(' → '))
  if (trace.run?.client_id !== clientId) throw new Error('run is not attributed to the client!')
  console.log('client attribution: OK')
} finally {
  await fetch(`${REST}/agent_api_clients?client_id=eq.${clientId}`, { method: 'DELETE', headers: SVC })
  console.log('temp client removed')
}
