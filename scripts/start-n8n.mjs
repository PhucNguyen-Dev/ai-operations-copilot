// Launch n8n locally with the project's secrets from .env.
// Usage: npm run n8n  (first run downloads n8n via npx, takes a minute)
// Editor UI: http://localhost:5678
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
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

const child = spawn('npx', ['n8n', 'start'], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    ...secrets,
    N8N_PORT: '5678',
    N8N_SECURE_COOKIE: 'false',
    N8N_DIAGNOSTICS_ENABLED: 'false',
    N8N_PERSONALIZATION_ENABLED: 'false',
    N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
    N8N_BLOCK_ENV_ACCESS_IN_NODE: 'false',
    GENERIC_TIMEZONE: 'Asia/Ho_Chi_Minh',
  },
})

child.on('exit', (code) => process.exit(code ?? 0))
