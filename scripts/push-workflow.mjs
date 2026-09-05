// Push every workflow JSON in n8n/*.json into the local n8n instance using
// n8n's built-in CLI (import:workflow + publish:workflow) — no API key needed.
//
// Usage:  npm run push:n8n
// Flags (all optional):
//   --input <file>   push a single file instead of all n8n/*.json
//   --url <base>     n8n base URL for the running-check (default http://localhost:5678)
//   --kill           if n8n is still running, kill its process tree automatically
//   --force          skip the "n8n should be stopped" check entirely
//
// The CLI writes directly to n8n's database, so:
//   1. n8n must be STOPPED while importing (avoids SQLite lock conflicts)
//   2. changes take effect after you start n8n again (npm run n8n)
import { readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined
}
const hasFlag = (name) => argv.includes(`--${name}`)

const single = flag('input')
const files = single
  ? [single]
  : readdirSync(join(root, 'n8n'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => join(root, 'n8n', f))
if (!files.length) {
  console.error('✗ No workflow JSON files found in n8n/')
  process.exit(1)
}

const baseUrl = (flag('url') || 'http://localhost:5678').replace(/\/+$/, '')

// Parse + validate all files before touching n8n
const workflows = []
for (const file of files) {
  let wf
  try {
    wf = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    console.error(`✗ ${basename(file)} is not valid JSON: ${err.message}`)
    process.exit(1)
  }
  workflows.push({ file, wf })
}

// 1. n8n should be stopped — the server holds the same database the CLI writes.
async function n8nUp() {
  try {
    const res = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

function pidsOnPort(port) {
  if (process.platform === 'win32') {
    const out = spawnSync('netstat', ['-ano'], { shell: true, encoding: 'utf8' })
    const pids = new Set()
    for (const line of (out.stdout || '').split('\n')) {
      if (line.includes(`:${port} `) && /LISTENING/i.test(line)) {
        const pid = parseInt(line.trim().split(/\s+/).pop(), 10)
        if (pid) pids.add(pid)
      }
    }
    return [...pids]
  }
  const out = spawnSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf8' })
  return (out.stdout || '').split('\n').map((s) => parseInt(s, 10)).filter(Boolean)
}

if (!hasFlag('force')) {
  if (await n8nUp()) {
    if (hasFlag('kill')) {
      const port = Number(new URL(baseUrl).port || 80)
      const pids = pidsOnPort(port)
      if (!pids.length) {
        console.error(`✗ n8n answers at ${baseUrl} but no PID was found on port ${port} — kill it manually, then re-run.`)
        process.exit(1)
      }
      for (const pid of pids) {
        console.log(`→ Killing leftover n8n process (pid ${pid}) and its children`)
        if (process.platform === 'win32') {
          spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'inherit', shell: true })
        } else {
          spawnSync('kill', ['-9', String(pid)], { stdio: 'inherit' })
        }
      }
      await new Promise((r) => setTimeout(r, 1500))
      if (await n8nUp()) {
        console.error('✗ n8n is still answering after the kill — stop it manually, then re-run.')
        process.exit(1)
      }
      console.log('✓ n8n stopped.')
    } else {
      console.error(`✗ n8n is running at ${baseUrl} — stop it first (Ctrl+C in the "npm run n8n" terminal), then re-run.
  (the CLI writes the same database; importing while it runs risks a lock conflict)
  Tip: closing the terminal window does NOT kill n8n on Windows — re-run with --kill to stop it automatically.`)
      process.exit(1)
    }
  }
}

const run = (args) => spawnSync('npx', args, { stdio: 'inherit', shell: true, cwd: root })

// 2. Import each workflow — upserts by the id in the file, so it updates in place.
let failed = false
for (const { file, wf } of workflows) {
  console.log(`→ Importing "${wf.name}" (${wf.nodes.length} nodes, id ${wf.id || 'new'}) from ${basename(file)}`)
  const imp = run(['n8n', 'import:workflow', `--input=${file}`])
  if (imp.status !== 0) {
    console.error(`✗ import failed for ${basename(file)} — see output above.`)
    failed = true
  }
}
if (failed) process.exit(1)

// 3. Publish each so its triggers/webhooks are live.
for (const { wf } of workflows) {
  if (!wf.id) {
    console.error(`⚠ "${wf.name}" has no id — open the n8n editor and publish it manually.`)
    continue
  }
  console.log(`→ Publishing workflow ${wf.id} ("${wf.name}")`)
  const pub = run(['n8n', 'publish:workflow', `--id=${wf.id}`])
  if (pub.status !== 0) {
    console.error(`⚠ publish failed for "${wf.name}" — open the n8n editor and publish manually.`)
  }
}

console.log(`✓ Done. Start n8n again with:  npm run n8n
  Live webhook will be: ${baseUrl}/webhook/admissions-lead`)
