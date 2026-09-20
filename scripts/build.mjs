// =============================================================
// `npm run build` wrapper — the guard + isolation entry point.
// Logic lives in build-guard.mjs (unit-tested); this file does I/O.
// =============================================================
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isolatedDistDir,
  mayUseDefaultDistDir,
  parseBuildEnv,
  parsePortFromDevScript,
  pidListeningOnPort,
  refusalMessage,
} from './build-guard.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const env = parseBuildEnv(process.env)

const port = parsePortFromDevScript(pkg.scripts?.dev)
const netstat = spawnSync('netstat', ['-ano'], { encoding: 'utf8', shell: true })
const devPid = netstat.stdout ? pidListeningOnPort(netstat.stdout, port) : null
const devListening = devPid !== null

if (!mayUseDefaultDistDir({ devListening, buildAnyway: env.buildAnyway })) {
  console.error(refusalMessage({ pid: devPid, port, devScript: pkg.scripts?.dev ?? '' }))
  process.exit(1)
}

const distDir = isolatedDistDir({
  devListening,
  buildAnyway: env.buildAnyway,
  explicitDistDir: env.distDir,
})

if (distDir) {
  // Fresh isolated artifact every time — stale chunks were half the pain.
  rmSync(join(root, distDir), { recursive: true, force: true })
  console.log(`⚠ Dev server detected (pid ${devPid ?? 'unknown'}) — building into isolated ${distDir} (BUILD_ANYWAY).`)
  console.log('')
}

const result = spawnSync('npx', ['next', 'build'], {
  stdio: 'inherit',
  shell: true,
  cwd: root,
  env: distDir ? { ...process.env, NEXT_DIST_DIR: distDir } : process.env,
})
process.exit(result.status ?? 1)
