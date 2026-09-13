import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role client — RLS does not apply. Like the n8n pipeline (which
 * writes with the service key by design), this client exists for ONE job:
 * the agent runtime persisting runs/steps/approvals and governed tool
 * writes that passed the server-side capability + resource checks first.
 * Every call site must be reachable from a permission decision recorded
 * in the agent trace. Do not use it to read user data for UI features.
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error(
      'Agent runtime not configured: SUPABASE_SERVICE_ROLE_KEY is required for agent state writes.'
    )
  }
  return createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
