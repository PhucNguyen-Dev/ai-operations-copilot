#!/usr/bin/env node
// =============================================================
// Situation #1 cleanup (docs/SITUATION_OCCUR.md): the wrong-target run
// of 2026-09-19 left a real follow-up task and a dry_run email draft
// for the WRONG lead (Emma Nguyen) — "Harmless (dry-run), but should be
// deleted or acknowledged at some point." This is that acknowledgment.
//
// Dry-run by default: prints what it found and what it WOULD delete.
//   node scripts/cleanup-situation1.mjs          # report only
//   node scripts/cleanup-situation1.mjs --yes    # actually delete
//
// Scope guard (deliberately narrow): only rows on leads whose name
// matches the case (~emma%), created by agent runs (created_by LIKE
// 'agent:%'), within the incident window — never bulk cleanup.
// =============================================================
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnv() {
  const env = {}
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const eq = line.indexOf('=')
      if (eq > 0 && !env[line.slice(0, eq).trim()]) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
    }
  } catch {
    /* no .env — rely on process env */
  }
  return env
}

const ENV = loadEnv()
if (!ENV.NEXT_PUBLIC_SUPABASE_URL || !ENV.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — cannot reach the database.')
  process.exit(1)
}
const REST = `${ENV.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, '')}/rest/v1`
const SVC = {
  apikey: ENV.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
}
const APPLY = process.argv.includes('--yes')
// Incident window: the wrong-target run was ~2026-09-19.
const WINDOW = 'created_at=gte.2026-09-18T00:00:00Z&created_at=lte.2026-09-21T00:00:00Z'
const LEAD_MATCH = 'name=ilike.*emma*'

async function svcGet(path) {
  const res = await fetch(`${REST}/${path}`, { headers: SVC })
  if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}`)
  return res.json()
}
async function svcDelete(path) {
  const res = await fetch(`${REST}/${path}`, { method: 'DELETE', headers: SVC })
  if (!res.ok) throw new Error(`DELETE ${path} -> HTTP ${res.status}`)
}

const leads = await svcGet(`leads?${LEAD_MATCH}&select=id,name,email,status,created_at`)
if (!leads.length) {
  console.log('No leads matching the case found — nothing to clean up (it may already be gone).')
  process.exit(0)
}
console.log(`Leads matching the case: ${leads.length}`)
for (const l of leads) console.log(`  - ${l.name} <${l.email}> (${l.id}, created ${l.created_at})`)

let deletions = 0
for (const lead of leads) {
  const base = `lead_id=eq.${lead.id}&${WINDOW}`
  // The dry_run email draft left by the wrong-target run.
  const emails = await svcGet(`sent_emails?${base}&status=eq.dry_run&created_by=like.agent:*)&select=id,subject,status,created_by,created_at`)
  for (const e of emails) {
    console.log(`  draft  ${e.id} "${e.subject}" by ${e.created_by} (${e.created_at})`)
    if (APPLY) await svcDelete(`sent_emails?id=eq.${e.id}`)
    deletions++
  }
  // The follow-up task the run created for the wrong lead.
  const tasks = await svcGet(`tasks?${base}&created_by=like.agent:*)&select=id,title,priority,status,created_by,created_at`)
  for (const t of tasks) {
    console.log(`  task   ${t.id} "${t.title}" (${t.priority}/${t.status}) by ${t.created_by} (${t.created_at})`)
    if (APPLY) await svcDelete(`tasks?id=eq.${t.id}`)
    deletions++
  }
}

console.log(APPLY ? `Deleted ${deletions} row(s).` : `Dry run complete: ${deletions} row(s) WOULD be deleted. Re-run with --yes to apply.`)
