import { NextRequest } from 'next/server'
import { getApiUser } from '@/lib/auth-server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimiter } from '@/lib/rate-limit'
import { geminiAgentModel } from '@/lib/agent/model'
import { getAgent } from '@/lib/agent/agents'
import { SupabaseAgentStateStore } from '@/lib/agent/store'
import { startAgentRun, type RuntimeDeps, type RuntimeEvent } from '@/lib/agent/runtime'

// =============================================================
// POST /api/agent/runs/stream — the governed run front door, streamed.
// Bundle B: identical auth, role gate, rate limit and session checks
// as POST /api/agent/runs (this route NEVER weakens a gate — it only
// changes the transport). The response is an SSE event stream:
//
//   data: {"type":"run_started",...}
//   data: {"type":"turn_delta","text":"<accumulated>",...}
//   data: {"type":"tool_executed","tool":"search_leads",...}
//   data: {"type":"awaiting_approval",...} | run_completed | run_failed
//   data: {"final": {...same JSON body as the non-streaming route...}}
//
// Events are advisory progress; the durable agent_runs trace remains
// the single source of truth (scoring, resume, audit). The existing
// JSON route is untouched — the external API contract is unchanged.
// =============================================================

export async function POST(request: NextRequest) {
  const session = await getApiUser(request)
  if ('response' in session) return session.response
  const { userId, role } = session

  const body = (await request.json().catch(() => null)) as {
    goal?: unknown
    agentId?: unknown
    requireApproval?: unknown
    sessionId?: unknown
    ephemeralContext?: unknown
  } | null
  const goal = typeof body?.goal === 'string' ? body.goal.trim() : ''
  const agentId = typeof body?.agentId === 'string' && body.agentId ? body.agentId : 'admissions-followup'
  const requireApproval = body?.requireApproval === true
  const sessionId = typeof body?.sessionId === 'string' && /^[0-9a-f-]{36}$/i.test(body.sessionId) ? body.sessionId : null
  const ephemeralContext = typeof body?.ephemeralContext === 'string' ? body.ephemeralContext.slice(0, 4000) : undefined
  if (goal.length < 5 || goal.length > 2000) {
    return Response.json({ error: 'Field "goal" is required (5-2000 chars)' }, { status: 400 })
  }

  const agent = getAgent(agentId)
  if (!agent) {
    return Response.json({ error: `Unknown agent "${agentId}"` }, { status: 400 })
  }
  if (role !== 'admin' && !agent.allowedRoles.includes(role)) {
    return Response.json({ error: `Your role (${role}) is not allowed to use the ${agent.displayName}.` }, { status: 403 })
  }

  const limit = await rateLimiter.check(`agent-run:${userId}`, 5, 60_000)
  if (!limit.ok) {
    return Response.json(
      { error: `Too many agent runs — try again in ${limit.retryAfterSec}s.` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
    )
  }

  const supabase = await createClient()
  if (sessionId) {
    const admin = createAdminClient()
    const { data: sessionRun } = await admin.from('agent_runs').select('user_id').eq('session_id', sessionId).limit(1)
    if (sessionRun?.length && sessionRun[0].user_id !== userId) {
      return Response.json({ error: 'Session does not belong to this user' }, { status: 403 })
    }
  }

  let adminClient
  try {
    adminClient = createAdminClient()
  } catch {
    return Response.json(
      { error: 'Agent runtime is not configured on the server (missing service-role key).' },
      { status: 500 }
    )
  }

  const encoder = new TextEncoder()
  const send = (controller: ReadableStreamDefaultController, payload: unknown) => {
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
    } catch {
      // Client disconnected mid-stream — the run keeps going; its result
      // stays in agent_runs and the normal UI can pick it up there.
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      const deps: RuntimeDeps = {
        store: new SupabaseAgentStateStore(adminClient),
        model: geminiAgentModel,
        userClient: supabase,
        adminClient,
        dryRunEmail: process.env.GMAIL_AGENT_DRY_RUN !== 'false',
        onEvent: (event: RuntimeEvent) => send(controller, event),
      }
      try {
        const output = await startAgentRun(deps, { agentId, userId, userRole: role, goal, sessionId, ephemeralContext, requireApproval })
        send(controller, { final: output })
      } catch (e) {
        console.error('[api/agent/runs/stream] POST failed:', e)
        // One contract for the client: always a closing event, error or
        // final — never a silent stream end.
        send(controller, { error: 'The agent run failed unexpectedly — the run trace was logged.' })
      } finally {
        try {
          controller.close()
        } catch {
          /* already closed by a disconnect */
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
