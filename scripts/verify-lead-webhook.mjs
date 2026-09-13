#!/usr/bin/env node
// =============================================================
// Phase 9 Milestone F — live verification of the real lead trigger:
// 1. sign a Facebook-Leads-shaped payload (R-04 scheme, Web Crypto),
// 2. POST to /api/webhooks/lead → 202, lead stored with external_key,
// 3. re-deliver the SAME event → duplicate ack, no second lead/run,
// 4. wait for the governed triage run to complete and print its trace,
// 5. verify a tampered payload is rejected,
// 6. clean up (lead cascades; agent run removed).
// Requires migration 013 + dev server on :3000 + GEMINI_API_KEY
// + LEAD_WEBHOOK_SECRET (falls back to N8N_WEBHOOK_SECRET).
// =============================================================

import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8')
const env = {}
for (const line of raw.split(/\r?\n/)) {
  const eq = line.indexOf('=')
  if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
}
const REST = `${env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, '')}/rest/v1`
const SVC = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }
const BASE = process.env.EXTERNAL_BASE_URL || 'http://localhost:3000'
const SECRET = env.LEAD_WEBHOOK_SECRET ?? env.N8N_WEBHOOK_SECRET
if (!SECRET) { console.error('No webhook secret in .env'); process.exit(1) }

async function hmacHex(payload, secret) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function sendLead(payload, overrideSecret) {
  const timestamp = Date.now()
  const signature = await hmacHex(`${timestamp}.${JSON.stringify(payload)}`, overrideSecret ?? SECRET)
  return fetch(`${BASE}/api/webhooks/lead`, {
    method: 'POST',
    headers: { 'x-webhook-secret': overrideSecret ?? SECRET, 'Content-Type': 'application/json' },
    body: JSON.stringify({ timestamp, signature, payload }),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
}

const externalId = `leadgen-${randomBytes(6).toString('hex')}`
const SOURCE = 'facebook-test'

// Facebook-Leads-shaped payload (nested field_data + aliases) to prove normalization.
const payload = {
  source: SOURCE,
  external_id: externalId,
  object: 'page',
  entry: [{ changes: [{ field_data: [
    { name: 'full_name', values: ['Tran Thi Bich'] },
    { name: 'email', values: [`bich.${externalId.slice(-6)}@fb-leads.example`] },
    { name: 'phone_number', values: ['+84901234567'] },
    { name: 'questions', values: ['I want to join the IELTS Intensive course next month, is the early-bird discount still available?'] },
    { name: 'program', values: ['IELTS Intensive'] },
  ] }] }],
}

// 1. Accepted
const first = await sendLead(payload)
console.log('first delivery:', first.status, JSON.stringify(first.body))
if (first.status !== 202 || first.body.duplicate) throw new Error('first delivery should be accepted as new')

// 2. Duplicate re-delivery (same external_id)
const second = await sendLead(payload)
console.log('re-delivery:', second.status, JSON.stringify(second.body))
if (!second.body.duplicate || second.body.leadId !== first.body.leadId) throw new Error('re-delivery should be a duplicate ack for the SAME lead')

// 3. Tampered payload rejected — sign the ORIGINAL, swap the payload
// in the envelope afterwards (real tampering), expect 401.
{
  const timestamp = Date.now()
  const signature = await hmacHex(`${timestamp}.${JSON.stringify(payload)}`, SECRET)
  const tampered = await fetch(`${BASE}/api/webhooks/lead`, {
    method: 'POST',
    headers: { 'x-webhook-secret': SECRET, 'Content-Type': 'application/json' },
    body: JSON.stringify({ timestamp, signature, payload: { ...payload, external_id: 'evil-rewritten' } }),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
  console.log('tampered payload:', tampered.status, tampered.status === 401 ? 'OK (signature mismatch)' : 'FAIL')
  if (tampered.status !== 401) throw new Error('tampered payload should be rejected')
}

// 4. Governed triage run — poll agent_runs for the goal tag
const goalTag = `[lead-webhook:${SOURCE}]`
let run = null
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 3000))
  const runs = await fetch(`${REST}/agent_runs?goal=ilike.*${encodeURIComponent(goalTag)}*&select=id,status,final_outcome,error&order=started_at.desc&limit=1`, { headers: SVC }).then((r) => r.json())
  if (runs[0] && runs[0].status !== 'running') { run = runs[0]; break }
  if (runs[0]) console.log('… triage run status:', runs[0].status)
}
if (!run) throw new Error('triage run did not finish in time')
console.log('triage run:', run.status, '|', (run.final_outcome || run.error || '').slice(0, 200))
const steps = await fetch(`${REST}/agent_run_steps?select=tool_name,status,error&run_id=eq.${run.id}&order=step_index`, { headers: SVC }).then((r) => r.json())
console.log('triage trace:', steps.map((s) => `${s.tool_name}:${s.status}`).join(' → '))
if (!['completed', 'escalated'].includes(run.status)) throw new Error('triage run did not complete cleanly')

// 5. Cleanup: delete the eval lead (cascades) and the run
await fetch(`${REST}/leads?source=eq.${SOURCE}`, { method: 'DELETE', headers: SVC })
await fetch(`${REST}/agent_runs?id=eq.${run.id}`, { method: 'DELETE', headers: SVC })
console.log('cleanup done — live verification PASSED')
