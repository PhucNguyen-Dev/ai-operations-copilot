// =============================================================
// Build guard — decision logic (pure, no I/O; see build.mjs).
//
// Failure mode this prevents (hit 3x the week of 2026-09-15):
// running `next build` while the dev server is up corrupts the shared
// .next directory — chunks 404, the browser silently stops hydrating,
// login dies, and eval suites fail for "mysterious" reasons.
//
// Outcomes:
//   refuse   - dev server detected, no override  -> caller must exit 1
//   isolate  - override requested                -> build into a private distDir
//   proceed  - port free                         -> normal build
// =============================================================

const DEV_PORT_DEFAULT = 3000

// Matches a netstat -ano LISTENING line for `:3000 ` (trailing space
// avoids matching :30001) and returns the owning PID.
export function pidListeningOnPort(netstatOutput, port) {
  for (const line of String(netstatOutput).split(/\r?\n/)) {
    if (!/LISTENING/i.test(line)) continue
    if (!line.includes(`:${port} `)) continue
    const pid = Number(line.trim().split(/\s+/).pop())
    if (pid) return pid
  }
  return null
}

// Reads the dev port from package.json's dev script: --port N or -p N.
function parsePortFromDevScript(devScript) {
  const m = /(?:--port[=\s]+|-p\s+)(\d+)/.exec(devScript ?? '')
  return m ? Number(m[1]) : DEV_PORT_DEFAULT
}

export function parseBuildEnv(env) {
  return {
    buildAnyway: env.BUILD_ANYWAY === '1' || env.BUILD_ANYWAY === 'true',
    distDir: env.NEXT_DIST_DIR || null,
  }
}

// Decision 1: should the build be allowed to touch the default .next?
export function mayUseDefaultDistDir({ devListening, buildAnyway }) {
  return !(devListening && !buildAnyway)
}

// Decision 2: which distDir does the build get?
// Only true when we chose to isolate (override + dev server detected).
export function isolatedDistDir({ devListening, buildAnyway, explicitDistDir }) {
  if (explicitDistDir) return explicitDistDir
  if (devListening && buildAnyway) return '.next-build'
  return null
}

export function refusalMessage({ pid, port, devScript }) {
  const portNote = (devScript ?? '').includes(`-p ${port}`)
    ? `package.json "dev" runs on port ${port}`
    : `assumed from package.json "dev" (port ${port})`
  return [
    `✗ Refusing to build: a dev server appears to be running (pid ${pid}, port ${port} — ${portNote}).`,
    ``,
    `  A production build into .next corrupts the live dev server (chunks 404,`,
    `  hydration dies — this bit us three times). Choose one:`,
    ``,
    `  1. Stop the dev server, then run: npm run build`,
    `  2. Keep it running with an ISOLATED artifact: BUILD_ANYWAY=1 npm run build`,
    `     (builds into .next-build instead — the dev server is untouched;`,
    `     smoke-test it separately, e.g. npm run start:isolated)`,
  ].join('\n')
}

export { DEV_PORT_DEFAULT, parsePortFromDevScript }
