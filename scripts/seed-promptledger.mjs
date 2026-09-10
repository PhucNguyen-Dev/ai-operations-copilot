#!/usr/bin/env node
// Seed the PromptLedger registry with the committed Copilot prompts.
//
// Single source of truth: reads prompts/*.json — the same files the
// runtime fallback (lib/promptledger.ts) uses — so the version registered
// here is byte-identical to what the app shipped with (cutover changes no
// behavior until a human edits the prompt in PromptLedger).
//
// This is also the WRITE half of the owned-workflow pattern (see
// docs: logPrompt-on-edit): whenever a prompt changes in the repo, run
// this script to register the new version.
//
// Usage:
//   node scripts/seed-promptledger.mjs
//
// Env:
//   PROMPTLEDGER_URL        default http://localhost:4747
//   PROMPTLEDGER_API_KEY    required when the server has auth enabled

import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const promptsDir = join(root, 'prompts')
const baseUrl = (process.env.PROMPTLEDGER_URL || 'http://localhost:4747').replace(/\/+$/, '')
const apiKey = process.env.PROMPTLEDGER_API_KEY
const APP = 'ops-copilot'

if (!apiKey) {
  console.error('PROMPTLEDGER_API_KEY is not set — PromptLedger auth would reject every write.')
  console.error('Get a key from the PromptLedger admin (POST /api/admin/keys or scripts/bootstrap_key.py).')
  process.exit(1)
}

async function logPrompt({ name, text, note }) {
  const res = await fetch(`${baseUrl}/api/prompts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ name, app: APP, text, note, author: 'seed-script', status: 'live' }),
  })
  if (!res.ok) {
    throw new Error(`registering ${name} failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`)
  }
  return res.json()
}

const files = readdirSync(promptsDir).filter((f) => f.endsWith('.json'))
if (files.length === 0) {
  console.error(`no prompt files found in ${promptsDir}`)
  process.exit(1)
}

let failed = false
for (const file of files) {
  const name = file.replace(/\.json$/, '')
  const { system } = JSON.parse(readFileSync(join(promptsDir, file), 'utf-8'))
  try {
    const saved = await logPrompt({ name, text: system, note: `seeded from repo ${file} (committed copy)` })
    console.log(`registered ${APP}/${name} v${saved.version} (${saved.status})`)
  } catch (e) {
    failed = true
    console.error(`FAILED ${name}: ${e.message}`)
  }
}

process.exit(failed ? 1 : 0)
