// =============================================================
// AI Operations Copilot — create the 5 demo users
// Sets app_metadata.role, which drives RLS (AD-11) and triggers
// profile creation. Idempotent: existing users get updated.
//
// Usage:
//   1. cp .env.example .env   (fill in SUPABASE_SERVICE_ROLE_KEY + URL)
//   2. node scripts/seed-users.mjs
// =============================================================
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// Minimal .env loader (no dependency needed)
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const PASSWORD = 'demo1234' // demo-only credential, all users

const USERS = [
  { email: 'admin@demo.dev',      full_name: 'Alex Admin',       role: 'admin' },
  { email: 'marketing@demo.dev',  full_name: 'Marta Marketing',  role: 'marketing' },
  { email: 'counselor@demo.dev',  full_name: 'Chris Counselor',  role: 'admissions' },
  { email: 'teacher@demo.dev',    full_name: 'Tania Teacher',    role: 'teacher' },
  { email: 'operations@demo.dev', full_name: 'Omar Operations',  role: 'operations' },
]

const supabase = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } })

async function findUserIdByEmail(email) {
  let page = 1
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const hit = data.users.find((u) => u.email === email)
    if (hit) return hit.id
    if (page >= Math.ceil((data.total ?? 0) / 200)) return null
    page++
  }
}

for (const { email, full_name, role } of USERS) {
  const payload = {
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name },
    app_metadata: { role },
  }

  const { data, error } = await supabase.auth.admin.createUser(payload)

  if (error?.message?.includes('already')) {
    const id = await findUserIdByEmail(email)
    const { error: updErr } = await supabase.auth.admin.updateUserById(id, {
      user_metadata: { full_name },
      app_metadata: { role },
    })
    console.log(updErr ? `✗ ${email}: update failed — ${updErr.message}` : `↻ ${email}: already existed, role set to ${role}`)
  } else if (error) {
    console.log(`✗ ${email}: ${error.message}`)
  } else {
    console.log(`✓ ${email} created with role "${role}" (profile auto-created)`)
  }
}

console.log(`\nAll demo passwords: ${PASSWORD}`)
console.log('Next step: run supabase/post_seed.sql in the SQL Editor.')
