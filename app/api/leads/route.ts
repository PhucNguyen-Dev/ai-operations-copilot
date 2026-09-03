import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ count: data.length, leads: data })
}

/** POST /api/leads — Test Lead intake (F-001). Shape check only; in Phase 3 this forwards to n8n instead of inserting directly. */
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

  const { data, error } = await supabase
    .from('leads')
    .insert({
      name: name.slice(0, 200),
      email: email.slice(0, 320),
      phone: body.phone?.slice(0, 40) ?? null,
      source: body.source?.slice(0, 50) ?? 'test',
      course_interest: body.course_interest?.slice(0, 100) ?? null,
      budget: body.budget?.slice(0, 100) ?? null,
      timeline: body.timeline?.slice(0, 100) ?? null,
      message: body.message?.slice(0, 4000) ?? null,
      status: 'new',
      submitted_by: user.id,
    })
    .select('id, name, email, status')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ lead: data }, { status: 201 })
}
