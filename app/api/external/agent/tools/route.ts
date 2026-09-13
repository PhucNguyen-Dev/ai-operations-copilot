import { NextRequest, NextResponse } from 'next/server'
import { getAgent } from '@/lib/agent/agents'
import { authenticateExternalClient } from '@/lib/agent/external-server'

// GET /api/external/agent/tools — capability discovery for the
// authenticated client: the tools of each agent it is allowed to use.
export async function GET(request: NextRequest) {
  const auth = await authenticateExternalClient(request)
  if ('response' in auth) return auth.response
  const { client } = auth

  const agents = client.allowed_agents
    .map((id) => getAgent(id))
    .filter((a): a is NonNullable<ReturnType<typeof getAgent>> => Boolean(a))
    .map((a) => ({
      id: a.id,
      displayName: a.displayName,
      description: a.description,
      tools: a.allowedTools,
    }))

  return NextResponse.json({ scopes: client.scopes, agents })
}
