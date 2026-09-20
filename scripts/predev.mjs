// =============================================================
// `npm run dev` pre-hook — kills the silent-confusion class.
// Non-blocking: only prints, never exits nonzero.
//   * dev port already LISTENING → your new server would land on
//     :3001 with a different localStorage scope ("why is my session
//     gone / where did my data go?" — and agents porting scripts to
//     :3000 would hit the OLD server).
//   * stale .next with no dev marker → advise a clean start.
// =============================================================
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pidListeningOnPort } from './build-guard.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function devPort() {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const m = /--port[=\s]+(\d+)/.exec(pkg.scripts?.dev ?? '')
    if (m) return Number(m[1])
  } catch { /* fall through */ }
  return 3000
}

const port = devPort()
let netstatOut = ''
try {
  netstatOut = spawnSync('netstat', ['-ano'], { encoding: 'utf8', shell: true }).stdout ?? ''
} catch { /* netstat unavailable — skip silently */ }

const pid = netstatOut ? pidListeningOnPort(netstatOut, port) : null
if (pid) {
  console.warn(`⚠ Port ${port} is already serving (pid ${pid}). Your new dev server will start on a different port (${port + 1}+) unless you stop it first.`)
}

const nextDir = join(root, '.next')
if (existsSync(nextDir)) {
  const marker = join(nextDir, 'dev-server-running.json')
  if (!existsSync(marker)) {
    console.warn(`⚠ .next exists without a dev-server marker — likely a stale production build. If the page won't load or hydration is broken, run: rm -rf .next && npm run dev`)
  }
}
