// =============================================================
// `npm run ci` — one command to know if CI is green on your branch.
//
// Read-only (GitHub REST). Token resolution: GH_TOKEN, then
// GITHUB_TOKEN, then unauthenticated (public repos, but rate limits
// bite fast — expect an honest warning, not silent breakage).
// Exit 0 only when the latest run on this branch succeeded.
// =============================================================
import { execSync } from 'node:child_process'

const red = (s) => `\x1b[31m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`

function git(args) {
  try {
    return execSync(`git ${args}`, { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

const branch = git('rev-parse --abbrev-ref HEAD')
if (!branch || branch === 'HEAD') {
  console.error(red('✗ not on a branch (detached HEAD?) — cannot determine which runs to check.'))
  process.exit(1)
}

const remoteUrl = git('remote get-url origin')
if (!remoteUrl) {
  console.error(red('✗ no origin remote — cannot locate the repo on GitHub.'))
  process.exit(1)
}
const m = /github\.com[:/](.+?)\/(.+?)(?:\.git)?$/.exec(remoteUrl)
if (!m) {
  console.error(red(`✗ origin is not GitHub: ${remoteUrl}`))
  process.exit(1)
}
const repo = `${m[1]}/${m[2]}`

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || null
const headers = { accept: 'application/vnd.github+json' }
if (token) headers.authorization = `Bearer ${token}`
else console.warn(yellow('⚠ no GH_TOKEN/GITHUB_TOKEN — unauthenticated GitHub API (rate limit: 60 req/h per IP).'))

const api = `https://api.github.com/repos/${repo}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=1`
let res
try {
  res = await fetch(api, { headers })
} catch (e) {
  console.error(red(`✗ GitHub API unreachable: ${e.message}`))
  process.exit(1)
}

if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
  console.error(red('✗ GitHub rate limit hit (no/limited token). Set GH_TOKEN or wait an hour.'))
  process.exit(1)
}
if (!res.ok) {
  console.error(red(`✗ GitHub API ${res.status}: ${(await res.text()).slice(0, 200)}`))
  process.exit(1)
}

const data = await res.json()
const run = data.workflow_runs?.[0]
if (!run) {
  console.error(yellow(`⚠ no CI runs found for branch "${branch}" on ${repo}.`))
  console.error(yellow('  Actions must be enabled on the repo and triggered by a push (or PR).'))
  process.exit(1)
}

const head = git('rev-parse HEAD')
const onCurrentHead = run.head_sha.startsWith(head ?? '~~~')
const when = new Date(run.created_at).toLocaleString()
const dur = run.run_started_at && run.updated_at
  ? `${Math.max(1, Math.round((new Date(run.updated_at) - new Date(run.run_started_at)) / 60000))}m`
  : '?'

const ICONS = {
  success: green('✓ SUCCESS'),
  failure: red('✗ FAILURE'),
  cancelled: yellow('⊘ cancelled'),
  startup_failure: red('✗ startup_failure'),
}
const icon = ICONS[run.status === 'completed' ? run.conclusion : 'running'] ?? yellow(`… ${run.status}${run.conclusion ? ` (${run.conclusion})` : ''}`)

console.log(`CI on ${repo} @ ${branch}`)
console.log(`  latest run: ${icon}`)
console.log(`  commit:     ${run.head_sha.slice(0, 7)}${onCurrentHead ? '' : yellow(' (not your current HEAD)')}`)
console.log(`  workflow:   ${run.name} · ${when} · ${dur}`)
console.log(`  url:        ${run.html_url}`)

if (run.status !== 'completed') process.exit(2)
process.exit(run.conclusion === 'success' ? 0 : 1)
