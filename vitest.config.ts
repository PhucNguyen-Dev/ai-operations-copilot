import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Unit tests only — deterministic, no network, no env deps.
// Integration tests (real Gemini calls) live in tests/integration and run
// via `npm run test:integration` with vitest.integration.config.ts.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
})
