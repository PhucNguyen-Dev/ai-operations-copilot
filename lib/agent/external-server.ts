import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { isValidClientId, secretsMatch } from '@/lib/agent/external-auth'

// =============================================================
// 9.10 — Server-side authentication for external API routes.
// Credentials travel as headers (x-api-client / x-api-secret); the
// secret is verified timing-safely against the stored hash; the
// client row must be enabled. This is the ONLY way into the external
// surface — no session cookies, no shared platform secrets.
// =============================================================

export type ExternalClient = {
  id: string
  name: string
  client_id: string
  scopes: string[]
  allowed_agents: string[]
  max_runs_per_hour: number
  enabled: boolean
  created_by: string | null
}

export async function authenticateExternalClient(
  _request: NextRequest
): Promise<{ client: ExternalClient; admin: SupabaseClient } | { response: NextResponse }> {
  const clientId = _request.headers.get('x-api-client') ?? ''
  const secret = _request.headers.get('x-api-secret') ?? ''
  if (!isValidClientId(clientId) || !secret) {
    return { response: NextResponse.json({ error: 'Missing or malformed API credentials' }, { status: 401 }) }
  }

  let admin: SupabaseClient
  try {
    admin = createAdminClient()
  } catch {
    return { response: NextResponse.json({ error: 'External API is not configured on the server.' }, { status: 500 }) }
  }

  const { data, error } = await admin
    .from('agent_api_clients')
    .select('id, name, client_id, secret_hash, scopes, allowed_agents, max_runs_per_hour, enabled, created_by')
    .eq('client_id', clientId)
    .limit(1)
  if (error || !data?.length) {
    // Unknown client — identical response to a bad secret (no existence leak).
    return { response: NextResponse.json({ error: 'Invalid API credentials' }, { status: 401 }) }
  }
  const row = data[0] as ExternalClient & { secret_hash: string }
  if (!secretsMatch(secret, row.secret_hash) || !row.enabled) {
    return { response: NextResponse.json({ error: 'Invalid API credentials' }, { status: 401 }) }
  }
  const { secret_hash: _omit, ...client } = row
  return { client, admin }
}
