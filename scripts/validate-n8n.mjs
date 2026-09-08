// Validate n8n workflow JSONs BEFORE pushing them into n8n.
// Catches the classes of errors that have actually bitten this project:
//   E1. expression braces without the '=' prefix (renders literally →
//       "Expected 3 parts in JWT" / wrong URLs at runtime)   [FATAL]
//   E2. $env.VAR references not present in .env (undefined at runtime) [WARN]
//   E3. connections pointing at node names that don't exist  [FATAL]
//   E4. malformed JSON                                       [FATAL]
// Usage: node scripts/validate-n8n.mjs   (wired into `npm run push:n8n`)

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const n8nDir = join(root, 'n8n')

// start-n8n.mjs injects every .env key into n8n's env, plus derived ones.
const AVAILABLE_ENV = new Set([
  'SUPABASE_URL', 'N8N_WEBHOOK_URL', 'N8N_PIPELINE_JWT', 'N8N_PORT', 'WEBHOOK_URL',
])
const envPath = join(root, '.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_0-9]+)\s*=/)
    if (m) AVAILABLE_ENV.add(m[1])
  }
}

let failures = 0
let warnings = 0
const fail = (file, msg) => { failures++; console.error(`  ✗ ${file}: ${msg}`) }
const warn = (file, msg) => { warnings++; console.warn(`  ⚠ ${file}: ${msg}`) }

// Walk every string value in the parsed workflow; yields (path, value).
function* strings(node, path = '') {
  if (typeof node === 'string') yield [path, node]
  else if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) yield* strings(node[i], `${path}[${i}]`)
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) yield* strings(v, path ? `${path}.${k}` : k)
  }
}

for (const file of readdirSync(n8nDir).filter((f) => f.endsWith('.json'))) {
  const src = readFileSync(join(n8nDir, file), 'utf8')
  let wf
  try { wf = JSON.parse(src) } catch (e) { fail(file, `E4 malformed JSON: ${e.message}`); continue }
  console.log(`Checking ${file} …`)

  const nodeNames = new Set((wf.nodes || []).map((n) => n.name))

  for (const [path, value] of strings(wf)) {
    if (!value.includes('{{')) continue
    // Skip Code-node bodies — plain JS, braces are normal code there.
    if (/\.jsCode$/.test(path)) continue
    // E1 — braces without '=' prefix (n8n renders them literally).
    if (!value.startsWith('=')) {
      fail(file, `E1 expression without '=' prefix at ${path} → "${value.slice(0, 70)}"`)
    }
    // E2 — env vars that won't exist inside n8n.
    for (const m of value.matchAll(/\$env\.([A-Z_0-9]+)/g)) {
      if (!AVAILABLE_ENV.has(m[1])) warn(file, `E2 $env.${m[1]} not in .env (at ${path}) — undefined at runtime unless injected elsewhere`)
    }
  }

  // E3 — dangling connections.
  for (const [from, conns] of Object.entries(wf.connections || {})) {
    if (!nodeNames.has(from)) fail(file, `E3 connection source "${from}" is not a node`)
    for (const branches of Object.values(conns)) {
      for (const branch of branches || []) {
        for (const c of branch || []) {
          if (!nodeNames.has(c.node)) fail(file, `E3 connection "${from}" → "${c.node}" target does not exist`)
        }
      }
    }
  }
  if (!failures) console.log(`  ✓ ${file} clean`)
}

if (failures) {
  console.error(`\nn8n validation FAILED (${failures} problem${failures > 1 ? 's' : ''}${warnings ? `, ${warnings} warning${warnings > 1 ? 's' : ''}` : ''}) — fix before pushing.`)
  process.exit(1)
}
console.log(`\n✓ All n8n workflow JSONs valid.${warnings ? ` (${warnings} warning${warnings > 1 ? 's' : ''})` : ''}`)
