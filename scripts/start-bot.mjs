// One-command bot stack: cloudflared quick tunnel -> n8n with WEBHOOK_URL=<tunnel url>.
// Usage:  npm run bot
//
// Registration rules (see docs/TELEGRAM-INCIDENT-2026-09-07.md):
// - At startup, n8n itself registers the Telegram webhook (with its internal
//   secret) when the chatbot workflow activates. The launcher NEVER calls
//   setWebhook at startup — only verifies, so it cannot clobber n8n's
//   secret-protected registration.
// - If the tunnel dies mid-session, the watchdog opens a fresh one and
//   re-registers with setWebhook INCLUDING the same secret n8n uses
//   (<workflowId>_<triggerNodeId>, sanitized) — exactly equivalent to n8n's
//   own registration.
//
// Invariants: exactly one tunnel and one n8n. n8n is started once; if it
// exits, the whole stack shuts down. Healing only ever replaces the tunnel.
import { spawn, spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import http from 'node:http'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = 5678
const bypassHeaders = { 'bypass-tunnel-reminder': '1' }
const WEBHOOK_PATH = '/webhook/tg-parent-chatbot/webhook'
// R-11 fix: the Telegram trigger's secret is env-backed (workflow node reads
// $env.TELEGRAM_WEBHOOK_SECRET; n8n uses it for setWebhook AND validates the
// X-Telegram-Bot-Api-Secret-Token header on every update). The launcher reads
// the same value - deterministic across workflow re-imports, never hardcoded.
const envSecret = (() => {
  try {
    const line = readFileSync(join(root, '.env'), 'utf8')
      .split(/\r?\n/)
      .find((value) => value.trim().startsWith('TELEGRAM_WEBHOOK_SECRET='))
    return line?.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')
  } catch {
    return undefined
  }
})()
const TELEGRAM_SECRET = envSecret
if (!TELEGRAM_SECRET) {
// Stable URL across restarts (fewer Telegram re-registrations). If the relay
  console.error("? TELEGRAM_WEBHOOK_SECRET is missing from .env - the launcher cannot register/heal the webhook securely.")
// has a stale registry entry for it (zombie -> 502), we verify and fall back
  console.error("  Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"")
// to a random subdomain automatically.
  console.error("  then add TELEGRAM_WEBHOOK_SECRET=<value> to .env and re-run.")
}

let url = null
let n8n = null
let lt = null
let shuttingDown = false
let healing = false
let probeStrikes = 0

const token = (() => {
  const line = readFileSync(join(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .find((value) => value.trim().startsWith('TELEGRAM_BOT_TOKEN='))
  return line?.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')
})()
if (!token) {
  console.error('✗ TELEGRAM_BOT_TOKEN is missing from .env — the bot cannot run.')
  process.exit(1)
}

function killPid(pid) {
  // shell:true spawns a cmd -> node tree; .kill() alone leaves orphans on
  // Windows. taskkill /T takes down the whole tree.
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { shell: true, stdio: 'ignore' })
}

function killPort() {
  if (process.platform !== 'win32') return
  const result = spawnSync('netstat', ['-ano'], { encoding: 'utf8', shell: true })
  const pids = new Set()
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.includes(`:${port} `) && /LISTENING/i.test(line)) {
      const pid = Number(line.trim().split(/\s+/).pop())
      if (pid) pids.add(pid)
    }
  }
  for (const pid of pids) {
    console.log(`→ Stopping stale process on port ${port} (pid ${pid})`)
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'inherit', shell: true })
  }
}

async function probe(target, headers) {
  try {
    const response = await fetch(target, { headers, signal: AbortSignal.timeout(10000) })
    return response.status < 500 ? response : null
  } catch {
    return null
  }
}

async function waitFor(target, label, options = {}) {
  const deadline = Date.now() + (options.timeout ?? 60000)
  while (Date.now() < deadline) {
    const response = await probe(target, options.headers)
    if (response) return response
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  throw new Error(`${label} did not become healthy: ${target}`)
}

async function telegramRequest(method, body) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10000),
      })
      const result = await response.json()
      if (response.status !== 429 || attempt === 4) return result
      const waitSeconds = Number(result.parameters?.retry_after || 5)
      console.log(`→ Telegram rate-limited (${method}); retrying in ${waitSeconds}s`)
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000))
    } catch (error) {
      if (attempt === 4) return { ok: false, description: String(error) }
    }
  }
}

// Startup: n8n registers the webhook itself (with its secret); we only wait
// for that registration to appear.
async function verifyWebhook(publicUrl, timeoutMs = 180000) {
  const expected = `${publicUrl}${WEBHOOK_PATH}`
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = await telegramRequest('getWebhookInfo')
    if (last.ok && last.result?.url === expected) {
      if (last.result.last_error_message) {
        console.log(`ℹ Telegram reports an earlier delivery error (may predate this start): ${last.result.last_error_message}`)
      }
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }
  console.error(`✗ Webhook URL never matched. Expected: ${expected}`)
  console.error(`  Telegram has: ${last?.result?.url || '(nothing registered)'}`)
  if (last?.description) console.error(`  Telegram said: ${last.description}`)
  return false
}

// Healing (tunnel died mid-session): re-register WITH the secret — exactly
// what n8n itself would have registered.
async function registerWebhook(publicUrl) {
  const expected = `${publicUrl}${WEBHOOK_PATH}`
  const result = await telegramRequest('setWebhook', {
    url: expected,
    secret_token: TELEGRAM_SECRET,
    allowed_updates: ['message'],
  })
  if (!result.ok) {
    console.error(`✗ setWebhook rejected: ${result.description || 'unknown error'}`)
    return false
  }
  return verifyWebhook(publicUrl, 30000)
}

// Open one tunnel client, wait for its URL, then verify it actually serves.
// Returns the URL or null (cloudflared failure / no URL in time).
//
// Tunnel backend: cloudflared quick tunnel (free, no account/domain, far
// more stable than localtunnel - the localtunnel zombie-502 incidents are
// documented in docs/TELEGRAM-INCIDENT-2026-09-07.md). The quick-tunnel URL
// is random per start, which is fine: the launcher re-registers the Telegram
// webhook with whatever URL comes up.
// Backend is swappable via .env TUNNEL_BACKEND ('cloudflared' | 'localtunnel').
function spawnTunnel() {
  return new Promise((resolve) => {
    const backend = (process.env.TUNNEL_BACKEND || 'cloudflared').toLowerCase()
    let child
    let gotUrl = null

    if (backend === 'cloudflared') {
      // `npx cloudflared` downloads the binary on first use (cached after).
      // NOTE: cloudflared prints ALL logs (incl. the URL box) to stderr —
      // both streams must be scanned for the URL (the old localtunnel only
      // printed to stdout, which is where the stdout-only listener came from).
      child = spawn('npx', ['--yes', 'cloudflared', 'tunnel', '--url', `http://localhost:${port}`, '--no-autoupdate'], {
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } else {
      const args = ['localtunnel', '--port', String(port)]
      child = spawn('npx', args, {
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    }
    lt = child

    const handleLine = (line) => {
      console.log('[tunnel]', line)
      let m = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
      if (!m && backend === 'localtunnel') m = line.match(/https:\/\/[a-z0-9-]+\.loca\.lt/)
      if (m && !gotUrl) {
        gotUrl = m[0]
        resolve(m[0])
      }
    }
    createInterface({ input: child.stdout }).on('line', handleLine)
    createInterface({ input: child.stderr }).on('line', handleLine)
    child.on('exit', (code) => {
      if (shuttingDown) return
      if (!gotUrl) resolve(null)
      else if (!healing) {
        console.warn(`⚠ tunnel exited (code ${code}) — healing...`)
        heal()
      }
    })
    setTimeout(() => {
      if (!gotUrl) resolve(null)
    }, 30_000).unref()
  })
}

// Verify the tunnel truly serves. (Quick tunnels have no fixed subdomain to
// claim, so the old fixed-vs-random fallback logic is gone by design.)
async function acquireTunnel() {
  return spawnTunnel()
}

function banner() {
  console.log(`  Editor:  http://localhost:${port}`)
  console.log(`  Public:  ${url}`)
  console.log(`  Telegram webhook: ${url}${WEBHOOK_PATH}`)
}

// One-time bot profile setup: the empty-chat description (what a parent sees
// BEFORE tapping Start) and the command menu. Idempotent — same values every
// start, so re-running is always safe. Static until changed, per Bot API docs.
async function configureBotProfile() {
  const description = 'Enrollment assistant for our English courses — ask about IELTS, TOEFL or Business English (tuition, schedules, free placement test), or press Start to register. Ban co the tro chuyen bang tieng Viet!'
  const commands = [
    { command: 'start', description: 'Register or ask about our courses' },
    { command: 'help', description: 'What the bot can do' },
    { command: 'stop', description: 'Stop follow-up check-ins (say /start to re-enable)' },
  ]
  const okDesc = await telegramRequest('setMyDescription', { description })
  const okCmds = await telegramRequest('setMyCommands', { commands })
  if (okDesc?.ok && okCmds?.ok) console.log('✓ Bot profile set (description + command menu)')
  else console.warn('⚠ Bot profile setup incomplete (setMyDescription/setMyCommands failed) — non-fatal')
}

async function startN8n() {
  console.log(`→ Tunnel ready: ${url} — starting n8n with WEBHOOK_URL...`)
  n8n = spawn('node', ['scripts/start-n8n.mjs'], {
    cwd: root,
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, WEBHOOK_URL: url + '/' },
  })
  n8n.on('exit', (code) => {
    console.log(`n8n exited (code ${code}) — stopping stack.`)
    shutdown(code ?? 0)
  })

  await waitFor('http://localhost:5678/healthz', 'local n8n', { timeout: 180000 })
  await waitFor(`${url}/healthz`, 'public n8n', { headers: bypassHeaders, timeout: 120000 })

  const ok = await verifyWebhook(url)
  if (!ok) throw new Error('Telegram webhook verification failed')
  await configureBotProfile()
  console.log('✓ Bot stack ready (webhook registered by n8n, secret intact)')
  banner()
  console.log(`\n  Next steps: open http://localhost:${port} to edit workflows,`)
  console.log(`  then send your bot a FRESH message on Telegram to test it.`)
  console.log(`  (Telegram does not queue — offline messages are lost.)`)
}

// Single heal path: replace ONLY the tunnel, then re-register the webhook
// with the secret against the new URL. Never touches n8n.
async function heal() {
  if (shuttingDown || healing) return
  healing = true
  try {
    if (lt?.pid) killPid(lt.pid)
    url = null
    // n8n is already running here, so acquireTunnel's health probe hits the
    // real backend: fixed claim verified live, random fallback if zombie.
    url = await Promise.race([
      acquireTunnel(),
      new Promise((resolve) => setTimeout(resolve, 90000, null)),
    ])
    if (!url) {
      console.error('✗ Watchdog could not obtain a new tunnel URL; retrying next cycle.')
      if (lt?.pid) killPid(lt.pid)
      return
    }
    const okPublic = await waitFor(`${url}/healthz`, 'fresh public tunnel', {
      headers: bypassHeaders,
      timeout: 60000,
    }).then(() => true).catch(() => false)
    if (!okPublic) {
      console.error('✗ Fresh tunnel never became healthy; retrying next cycle.')
      return
    }
    const ok = await registerWebhook(url)
    probeStrikes = 0
    if (ok) {
      console.log('✓ Healed — bot online again (Telegram re-registered with secret).')
      banner()
    } else {
      console.error('✗ Webhook re-registration failed; will retry next cycle.')
    }
  } finally {
    healing = false
  }
}

function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  if (n8n?.pid) killPid(n8n.pid)
  if (lt?.pid) killPid(lt.pid)
  process.exit(code)
}

function fail(error) {
  console.error(`✗ ${error.message}`)
  shutdown(1)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGBREAK', () => shutdown(0))

// Temporary stand-in for n8n during tunnel claim, so a fixed-subdomain
// health probe can succeed before n8n is started.
function startStub() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
    })
    server.listen(port, () => resolve(server))
  })
}

function stopStub(server) {
  return new Promise((resolve) => {
    if (!server) return resolve()
    server.close(() => resolve())
  })
}

// Main flow
killPort()
;(async () => {
  const stub = await startStub()
  try {
    url = await acquireTunnel()
  } finally {
    await stopStub(stub)
  }
  killPort() // make sure the stub is fully released before n8n binds
  if (!url) throw new Error('Tunnel started but no URL was captured in time — see [tunnel] lines above')
  await startN8n()

  // Watchdog: require 2 consecutive public failures before healing, so a
  // single relay blip doesn't replace a healthy tunnel.
  setInterval(async () => {
    if (shuttingDown || healing || !url) return
    const response = await probe(`${url}/healthz`, bypassHeaders)
    if (response) {
      probeStrikes = 0
      return
    }
    probeStrikes += 1
    if (probeStrikes >= 3) {
      console.warn('⚠ Tunnel is down (3 consecutive failed probes) — healing...')
      await heal()
    }
  }, 30000).unref()
})().catch(fail)
