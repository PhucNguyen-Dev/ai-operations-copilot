import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/roles'

/**
 * Session for API routes: returns session data or a ready-to-send 401
 * response (no redirect — route handlers must answer with JSON).
 */
export async function getApiUser(
  _request: NextRequest
): Promise<{ userId: string; role: Role } | { response: NextResponse }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const role = ((user.app_metadata as Record<string, string> | undefined)?.role ?? 'unknown') as Role
  return { userId: user.id, role }
}
