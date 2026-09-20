// =============================================================
// Serve the ISOLATED build artifact (.next-build) on a spare port —
// a real production smoke test that never touches the dev server.
// Usage: npm run start:isolated   (Ctrl+C to stop)
// =============================================================
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, '.next-build')

if (!existsSync(dist)) {
  console.error('✗ No .next-build artifact. Build one first:  BUILD_ANYWAY=1 npm run build')
  process.exit(1)
}

const port = process.env.ISOLATED_PORT || '3100'
console.log(`▸ Serving the isolated build on http://localhost:${port} (dev server untouched)`)
const child = spawn('npx', ['next', 'start', '--port', String(port)], {
  stdio: 'inherit',
  shell: true,
  cwd: root,
  env: { ...process.env, NEXT_DIST_DIR: '.next-build', PORT: String(port) },
})
child.on('exit', (code) => process.exit(code ?? 0))
