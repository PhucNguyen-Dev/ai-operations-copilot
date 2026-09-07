// Launch n8n locally with the project's secrets from .env.
// Usage:
//   npm run n8n            (Layer 1: plain localhost — editor + admissions
//                           pipeline; Telegram trigger stays offline, which
//                           is expected — use `npm run bot` for the bot)
//   npm run bot            (Layer 2: tunnel + n8n + Telegram webhook)
// Editor UI: http://localhost:5678
//
// Precedence: .env WINS over any inherited environment variable. This is a
// deliberate deviation from the usual "existing env wins" convention —
// see docs/WEAK_POINTS_AND_RISKS.md R-09: a stale GEMINI_API_KEY in the
// Windows user environment silently shadowed the project's real key.
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { Socket } from 'node:net'
import { createHmac } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const secrets = {}
for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && m[2] && !m[2].startsWith('PASTE_')) secrets[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

if (!secrets.SUPABASE_URL) secrets.SUPABASE_URL = secrets.NEXT_PUBLIC_SUPABASE_URL
if (!secrets.SUPABASE_SERVICE_ROLE_KEY) secrets.SUPABASE_SERVICE_ROLE_KEY = secrets.SUPABASE_SERVICE_ROLE_KEY
// n8n calls its own admissions webhook on this same instance. This must never
// be the public Telegram tunnel URL.
secrets.N8N_WEBHOOK_URL = 'http://localhost:5678/webhook/admissions-lead'

// R-08 (least-privilege pipeline): mint a JWT whose `role` claim is
// `n8n_pipeline` - a Postgres role with grants ONLY on the tables the
// pipeline writes (migration 008). PostgREST acts as that role, so n8n
// no longer writes with the all-powerful service-role claim. Requires
// SUPABASE_JWT_SECRET in .env (Dashboard -> Settings -> API -> JWT Secret);
// falls back to service-role auth when absent so nothing breaks mid-setup.
if (secrets.SUPABASE_JWT_SECRET) {
  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const header = b64url({ alg: 'HS256', typ: 'JWT' })
  const claims = b64url({ role: 'n8n_pipeline', iss: 'supabase', iat: now, exp: now + 60 * 60 * 24 * 365 })
  const sig = createHmac('sha256', secrets.SUPABASE_JWT_SECRET).update(`${header}.${claims}`).digest('base64url')
  secrets.N8N_PIPELINE_JWT = `${header}.${claims}.${sig}`
} else {
  console.warn('⚠ SUPABASE_JWT_SECRET not set - n8n falls back to service-role writes (R-08 still open).')
}

// WEBHOOK_URL is optional: `npm run bot` supplies a fresh public HTTPS URL;
// plain `npm run n8n` runs without one (Telegram trigger stays offline).
const publicUrl = process.env.WEBHOOK_URL || secrets.WEBHOOK_URL
if (publicUrl && !/^https:\/\//.test(publicUrl)) {
  console.error('✗ WEBHOOK_URL must be a public HTTPS URL (supplied by `npm run bot`).')
  process.exit(1)
}

const child = spawn('npx', ['n8n', 'start'], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    ...secrets,
    N8N_PORT: '5678',
    ...(publicUrl ? { WEBHOOK_URL: publicUrl.endsWith('/') ? publicUrl : `${publicUrl}/` } : {}),
    N8N_SECURE_COOKIE: 'false',
    N8N_DIAGNOSTICS_ENABLED: 'false',
    N8N_PERSONALIZATION_ENABLED: 'false',
    N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
    N8N_BLOCK_ENV_ACCESS_IN_NODE: 'false',
    GENERIC_TIMEZONE: 'Asia/Ho_Chi_Minh',
  },
})

// Fail fast with a human hint when port 5678 is already owned by another
// n8n (B2) — a raw EADDRINUSE stack trace is not actionable.
setTimeout(() => {
  const net = new Socket()
  net.once('connect', () => {
    console.error('✗ Port 5678 is already in use — another n8n (or the bot stack) is running.')
    console.error('  Use `npm run kill-stack` first, then start again. Editor: http://localhost:5678')
    net.destroy()
    child.kill()
    process.exit(1)
  })
  net.once('error', () => { /* port free — normal path */ })
  net.connect(5678, '127.0.0.1')
}, 500)

child.on('exit', (code) => process.exit(code ?? 0))
