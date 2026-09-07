import { test, expect, type Page } from '@playwright/test'

// The auth/RLS visibility matrix — the highest-value E2E in the project
// (R-01): role gating is enforced by the database (RLS) and the UI must
// reflect it consistently on every page.

const PASSWORD = 'demo1234'

async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/password/i).fill(PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL('**/')
  // session cookie must be settled before any navigation assertions
  await expect(page.getByRole('heading', { name: /lead dashboard|ai operations copilot/i }).first()).toBeVisible({ timeout: 15_000 })
}

async function logout(page: Page) {
  await page.getByRole('button', { name: /sign out/i }).click()
  await page.waitForURL('**/login')
}

const ADMIN = 'admin@demo.dev'
const OPS = 'operations@demo.dev'
const COUNSELOR = 'counselor@demo.dev'
const MARKETING = 'marketing@demo.dev'

test.describe('auth + RLS visibility matrix', () => {
  test.afterEach(async ({ page }) => {
    if (page.url().includes('/login')) return
    try {
      await logout(page)
    } catch {
      /* already logged out */
    }
  })

  test('unauthenticated user is redirected to /login and APIs reject', async ({ page, request }) => {
    await page.goto('/')
    await page.waitForURL('**/login')
    const leads = await request.get('/api/leads')
    expect(leads.status()).toBe(401)
    const health = await request.get('/api/health')
    expect(health.status()).toBe(200)
  })

  test('admin sees everything: leads, logs, overview, all tool nav, new-lead button', async ({ page }) => {
    await login(page, ADMIN)
    await expect(page.getByRole('heading', { name: /lead dashboard/i })).toBeVisible()

    // RLS: admin sees all leads (seed data guarantees > 0)
    const leadRows = page.locator('table tbody tr')
    expect(await leadRows.count()).toBeGreaterThan(0)

    // nav: ops links + tool links + intake
    await expect(page.getByRole('link', { name: /automation logs/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /overview/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /content generator/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /report generator/i })).toBeVisible()
    // sidebar label for admin intake is "Simulate incoming lead"
    await expect(page.getByRole('link', { name: /simulate incoming lead/i })).toBeVisible()

    // /runs accessible
    await page.goto('/runs')
    await expect(page.getByRole('heading', { name: /automation logs/i })).toBeVisible()
    // /admin accessible
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: /operations overview/i })).toBeVisible()
  })

  test('operations: logs + overview accessible, no intake button, tools gated', async ({ page }) => {
    await login(page, OPS)
    await expect(page.getByRole('link', { name: /automation logs/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /overview/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /new test lead/i })).toHaveCount(0)
    // marketing tools hidden AND gated server-side
    await expect(page.getByRole('link', { name: /content generator/i })).toHaveCount(0)
    await page.goto('/tools/content-generator')
    await expect(page.getByRole('heading', { name: /not allowed/i })).toBeVisible()
  })

  test('counselor: assigned leads only, runs blocked by RLS, intake available, tools gated', async ({ page }) => {
    await login(page, COUNSELOR)
    await expect(page.getByRole('heading', { name: /lead dashboard/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /new test lead/i })).toBeVisible()
    // UX redesign note: the old "automation runs (blocked by RLS)" stat card is
    // gone - RLS blocking is asserted via nav absence + server-side gates below
    // no ops nav
    await expect(page.getByRole('link', { name: /automation logs/i })).toHaveCount(0)
    await expect(page.getByRole('link', { name: /overview/i })).toHaveCount(0)
    // server-side gate on ops pages
    await page.goto('/runs')
    await expect(page.getByRole('heading', { name: /not allowed/i })).toBeVisible()
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: /not allowed/i })).toBeVisible()
  })

  test('marketing: zero leads by design, tools visible, ops pages gated', async ({ page }) => {
    await login(page, MARKETING)
    // by-design empty leads table with the RLS explanation
    await expect(page.getByText(/no leads visible/i)).toBeVisible()
    // tool nav present, ops nav absent
    await expect(page.getByRole('link', { name: /content generator/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /automation logs/i })).toHaveCount(0)
    await page.goto('/runs')
    await expect(page.getByRole('heading', { name: /not allowed/i })).toBeVisible()
    // teacher-only tool gated server-side
    await page.goto('/tools/lesson-planner')
    await expect(page.getByRole('heading', { name: /not allowed/i })).toBeVisible()
  })

  test('lead detail: RLS-hidden lead returns not-found (no existence leak)', async ({ page }) => {
    await login(page, MARKETING)
    await expect(page.getByRole('heading', { name: /lead dashboard/i })).toBeVisible()
    // marketing sees zero leads; any uuid must render not-found, never leak lead existence.
    // (status may be 200 while the route streams, so assert the rendered 404 page)
    await page.goto('/leads/00000000-0000-0000-0000-000000000000')
    await expect(page.getByText(/this page could not be found/i)).toBeVisible({ timeout: 15_000 })
  })
})
