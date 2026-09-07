import { defineConfig } from '@playwright/test'

// E2E — auth/RLS visibility matrix. Requires: Next.js dev server on :3000
// and seeded demo users (npm run seed:users). Run: npm run test:e2e
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1, // sequential: same account state, avoid rate-limit flakiness
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    headless: true,
  },
  reporter: [['list']],
})
