// Emergency stop for the local n8n/Telegram stack.
// Usage:  npm run kill-stack
//
// Kills anything listening on the n8n ports and any stray localtunnel
// processes left over from earlier launcher runs.
import { spawnSync } from 'node:child_process'

const ports = [5678, 5679]

function netstat() {
  return spawnSync('netstat', ['-ano'], { encoding: 'utf8', shell: true }).stdout ?? ''
}

const pids = new Set()
for (const line of netstat().split(/\r?\n/)) {
  if (!/LISTENING/i.test(line)) continue
  for (const port of ports) {
    if (line.includes(`:${port} `)) {
      const pid = Number(line.trim().split(/\s+/).pop())
      if (pid) pids.add(pid)
    }
  }
}

for (const line of netstat().split(/\r?\n/)) {
  if (/127\.0\.0\.1:5678\s+127\.0\.0\.1:\d+\s+ESTABLISHED/i.test(line)) continue
}

// Stray localtunnel clients and orphaned n8n processes (they may no longer
// listen on the n8n ports after unclean kills). Match command lines — never
// kill arbitrary node.exe processes.
const tasklist = spawnSync('tasklist', ['/fi', 'imagename eq node.exe', '/fo', 'csv'], {
  encoding: 'utf8',
  shell: true,
}).stdout ?? ''
for (const line of tasklist.split(/\r?\n/)) {
  if (!line.toLowerCase().includes('node.exe')) continue
  const pid = Number(line.split('","')[0]?.replace(/^"/, ''))
  if (!pid || pids.has(pid)) continue
  const detail = spawnSync(
    'wmic',
    ['process', 'where', `ProcessId=${pid}`, 'get', 'CommandLine', '/value'],
    { encoding: 'utf8', shell: true },
  ).stdout ?? ''
  if (/lt\.js|localtunnel|n8n/i.test(detail)) pids.add(pid)
}

if (pids.size === 0) {
  console.log('✓ Nothing to kill — stack is already stopped.')
  process.exit(0)
}

for (const pid of pids) {
  console.log(`→ Killing pid ${pid}`)
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'inherit', shell: true })
}
console.log('✓ Stack stopped.')
