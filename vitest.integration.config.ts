import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Integration tests call the REAL Gemini API (quota-aware). Run explicitly:
//   npm run test:integration
// Never part of `npm test`.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['tests/integration/load-env.ts'],
    testTimeout: 60_000,
  },
})
