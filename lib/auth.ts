import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export type Role = 'admin' | 'admissions' | 'operations' | 'marketing' | 'teacher' | 'unknown'

/**
 * Session data shared by every page: the authed user, their app_metadata
 * role, and their profile row (full_name). Redirects to /login when there
 * is no session.
 */
export async function requireUser(): Promise<{
  id: string
  email: string
  role: Role
  fullName: string
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const role = ((user.app_metadata as Record<string, string> | undefined)?.role ?? 'unknown') as Role

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single()

  return {
    id: user.id,
    email: user.email ?? '',
    role,
    fullName: profile?.full_name ?? user.email ?? '',
  }
}

const OPS_ADMIN: Role[] = ['operations', 'admin']
const ADMISSIONS_ADMIN: Role[] = ['admissions', 'admin']

/** Can see the Automation Logs Viewer and the Ops/Admin overview. */
export function canViewAutomation(role: Role): boolean {
  return OPS_ADMIN.includes(role)
}

/** Can submit test leads (F-001). */
export function canSubmitLeads(role: Role): boolean {
  return ADMISSIONS_ADMIN.includes(role)
}
