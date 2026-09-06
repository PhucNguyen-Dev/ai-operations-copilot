import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { canViewAutomation, canSubmitLeads, canUseTool, type Role } from '@/lib/roles'

export type { Role }
export { canViewAutomation, canSubmitLeads, canUseTool }

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

/**
 * Governance back office (Tool Lab, evaluations, adoption decisions) is the
 * AI specialist's workspace: admin + operations only. Staff are sent to the
 * AI Guidelines portal instead (PHASE7-SUMMARY §10 — the registry loop's
 * decision-maker vs access-holder split).
 */
export async function requireGovernanceAccess(): Promise<{
  role: Role
  fullName: string
}> {
  const { role, fullName } = await requireUser()
  if (role !== 'admin' && role !== 'operations') redirect('/guidelines')
  return { role, fullName }
}
