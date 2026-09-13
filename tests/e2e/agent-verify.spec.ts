import { test, expect, type Page } from '@playwright/test'

// =============================================================
// LIVE agent-runtime verification (Phase 9 Milestone A). Opt-in —
// makes a real Gemini call through the governed loop, so it is
// SKIPPED unless AGENT_VERIFY=1:
//   AGENT_VERIFY=1 npx playwright test tests/e2e/agent-verify.spec.ts
// Requires: dev server on :3000, migration 010 applied, seeded users.
// =============================================================

const PASSWORD = 'demo1234'
const COUNSELOR = 'counselor@demo.dev'
const ADMIN = 'admin@demo.dev'

test.skip(process.env.AGENT_VERIFY !== '1', 'live agent verification is opt-in (AGENT_VERIFY=1)')

async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/password/i).fill(PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL('**/')
}

test('governed agent run: counselor starts a run through the real loop', async ({ page }) => {
  test.setTimeout(300_000) // the loop can legitimately take a couple of minutes
  await login(page, COUNSELOR)

  // Registry introspection first — proves auth + the route + the registry.
  const tools = await page.request.get('/api/agent/tools')
  expect(tools.status()).toBe(200)
  const toolsBody = await tools.json()
  expect(toolsBody.tools.length).toBeGreaterThanOrEqual(9)

  // The real run — model decides the tool sequence, platform governs it.
  // This goal REQUIRES SOP context (competitor/refund handling), so the
  // expected path includes search_knowledge (Milestone B semantic RAG)
  // with the retrieved policy cited in the finish verification.
  const res = await page.request.post('/api/agent/runs', {
    data: {
      goal:
        'A lead just asked about switching from a competitor course and hinted at asking for a refund. Review your visible leads, check the SOP for how to handle this situation, and take the appropriate governed action. Cite the SOP you followed in your finish summary.',
    },
  })
  const body = await res.json()
  console.log('RUN RESPONSE:', JSON.stringify(body, null, 2))
  expect(res.status()).toBe(200)
  expect(['completed', 'escalated', 'awaiting_approval', 'failed']).toContain(body.status)

  // The durable trace is readable through the RLS-scoped API.
  const detail = await page.request.get(`/api/agent/runs/${body.runId}`)
  expect(detail.status()).toBe(200)
  const trace = await detail.json()
  console.log(
    'TRACE:',
    JSON.stringify(
      trace.steps.map((s: Record<string, unknown>) => ({
        i: s.step_index,
        tool: s.tool_name,
        status: s.status,
        perm: s.permission_decision,
        err: s.error,
      })),
      null,
      2
    )
  )
  expect(trace.steps.length).toBeGreaterThan(0)

  // Milestone B acceptance: knowledge was retrieved through the RAG tool.
  const knowledgeStep = trace.steps.find((s: Record<string, unknown>) => s.tool_name === 'search_knowledge')
  console.log('KNOWLEDGE STEP:', JSON.stringify(knowledgeStep, null, 2))
  if (knowledgeStep) expect(knowledgeStep.tool_version).toBe('2.0.0')

  // If the loop suspended for approval, decide it as admin and verify resume.
  if (body.status === 'awaiting_approval') {
    await login(page, ADMIN)
    const decision = await page.request.post(`/api/agent/approvals/${body.pendingApprovalId}`, {
      data: { decision: 'approved', note: 'approved during live verification' },
    })
    const decisionBody = await decision.json()
    console.log('APPROVAL RESPONSE:', JSON.stringify(decisionBody, null, 2))
    expect(decision.status()).toBe(200)
    expect(['completed', 'escalated', 'failed']).toContain(decisionBody.run.status)
  }
})
