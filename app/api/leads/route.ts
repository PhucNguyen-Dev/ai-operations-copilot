import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { signPayload } from '@/lib/webhook-signing'

/** GET /api/leads — list leads under the caller's RLS scope. */
export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('leads')
    .select('id, name, email, phone, source, course_interest, status, created_at, lead_analyses(score, category, intent)')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    // R-03: full detail in server logs only; the client gets a generic 500.
    console.error('[api/leads] GET query failed:', error.message)
    return NextResponse.json({ error: 'Could not load leads' }, { status: 500 })
  }

  return NextResponse.json({ count: data.length, leads: data })
}

/** POST /api/leads — Test Lead intake (F-001). Auth + payload shape check, then forwards to the n8n webhook (F-002). The pipeline, not this route, persists the lead. */
export async function POST(request: NextRequest) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const role = (user.app_metadata as Record<string, string> | undefined)?.role
  if (role !== 'admissions' && role !== 'admin') {
    return NextResponse.json(
      { error: `Role "${role}" is not allowed to submit leads` },
      { status: 403 }
    )
  }

  const body = await request.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const email = typeof body?.email === 'string' ? body.email.trim() : ''

  if (!name || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json(
      { error: 'Fields "name" and a valid "email" are required' },
      { status: 400 }
    )
  }

  const webhookUrl = process.env.N8N_WEBHOOK_URL
  const webhookSecret = process.env.N8N_WEBHOOK_SECRET
  if (!webhookUrl || !webhookSecret) {
    return NextResponse.json(
      { error: 'Pipeline not configured (missing N8N_WEBHOOK_URL / N8N_WEBHOOK_SECRET)' },
      { status: 500 }
    )
  }

  // R-05: each submission triggers a paid AI call — cap per user.
  const limit = checkRateLimit(`lead:${user.id}`, 10, 60_000)
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Too many leads submitted — try again in ${limit.retryAfterSec}s.` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
    )
  }

  // R-04: the payload is HMAC-signed (tamper evidence + replay window) on
  // top of the shared-secret header — see lib/webhook-signing.ts.
  const payload = {
    name,
    email,
    phone: body.phone ?? null,
    source: body.source ?? 'test',
    course_interest: body.course_interest ?? null,
    budget: body.budget ?? null,
    timeline: body.timeline ?? null,
    message: body.message ?? null,
  }
  const timestamp = Date.now()
  const { signature } = await signPayload(payload, webhookSecret, timestamp)

  let upstream: Response
  try {
    upstream = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-secret': webhookSecret,
      },
      body: JSON.stringify({ timestamp, signature, payload }),
      cache: 'no-store',
    })
  } catch {
    return NextResponse.json(
      { accepted: false, error: 'Pipeline unreachable — is n8n running? (npm run n8n)' },
      { status: 502 }
    )
  }

  const data = await upstream.json().catch(() => ({}))

  if (!upstream.ok) {
    // The n8n webhook's own validation errors (401/422) are intentional and
    // user-relevant — pass the pipeline's message through. Anything else
    // (500s from upstream infrastructure) is logged, not leaked.
    if (upstream.status === 401 || upstream.status === 422) {
      return NextResponse.json(
        { ...data, error: data?.error ?? `Pipeline rejected the lead (HTTP ${upstream.status})` },
        { status: upstream.status }
      )
    }
    console.error(`[api/leads] webhook returned HTTP ${upstream.status}:`, data)
    return NextResponse.json(
      { accepted: false, error: 'The pipeline failed unexpectedly — the run was logged. Try again.' },
      { status: 502 }
    )
  }

  return NextResponse.json(data, { status: 200 })
}
