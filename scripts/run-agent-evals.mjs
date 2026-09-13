#!/usr/bin/env node
// Cross-platform runner for the agent behavior eval suite (9.8).
// Usage: npm run evals:agent — sets AGENT_EVALS=1 and spawns Playwright.
import { spawnSync } from 'node:child_process'

const isWindows = process.platform === 'win32'
const npx = isWindows ? 'npx.cmd' : 'npx'
const result = spawnSync(npx, ['playwright', 'test', 'tests/e2e/agent-evals.spec.ts', '--workers=1'], {
  stdio: 'inherit',
  env: { ...process.env, AGENT_EVALS: '1' },
  shell: isWindows,
})
process.exit(result.status ?? 1)
