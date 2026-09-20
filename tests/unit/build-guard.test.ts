import { describe, expect, it } from 'vitest'
import {
  DEV_PORT_DEFAULT,
  isolatedDistDir,
  mayUseDefaultDistDir,
  parsePortFromDevScript,
  pidListeningOnPort,
  refusalMessage,
} from '../../scripts/build-guard.mjs'

const LISTEN = `

  TCP    0.0.0.0:5678           0.0.0.0:0              LISTENING       4242
  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       5678
  TCP    [::]:3000              [::]:0                 LISTENING       5678
  TCP    0.0.0.0:30001          0.0.0.0:0              LISTENING       99
`
const EMPTY = `
  TCP    0.0.0.0:5678           0.0.0.0:0              LISTENING       4242
`

describe('pidListeningOnPort', () => {
  it('finds the pid on the dev port (ipv4 + ipv6)', () => {
    expect(pidListeningOnPort(LISTEN, 3000)).toBe(5678)
  })
  it('does not match :30001 when looking for :3000', () => {
    expect(pidListeningOnPort(LISTEN, 3001)).toBeNull()
  })
  it('returns null when the port is free', () => {
    expect(pidListeningOnPort(EMPTY, 3000)).toBeNull()
  })
})

describe('parsePortFromDevScript', () => {
  it('defaults to 3000', () => {
    expect(parsePortFromDevScript('next dev')).toBe(3000)
    expect(parsePortFromDevScript(undefined)).toBe(3000)
  })
  it('reads --port', () => {
    expect(parsePortFromDevScript('next dev --port 3100')).toBe(3100)
    expect(parsePortFromDevScript('next dev -p 3100')).toBe(3100)
  })
})

describe('mayUseDefaultDistDir', () => {
  it('refuses when a dev server is live and no override', () => {
    expect(mayUseDefaultDistDir({ devListening: true, buildAnyway: false })).toBe(false)
  })
  it('allows when the port is free', () => {
    expect(mayUseDefaultDistDir({ devListening: false, buildAnyway: false })).toBe(true)
  })
  it('allows with the override even when a dev server is live', () => {
    expect(mayUseDefaultDistDir({ devListening: true, buildAnyway: true })).toBe(true)
  })
})

describe('isolatedDistDir', () => {
  it('isolates only on override + live dev server', () => {
    expect(isolatedDistDir({ devListening: true, buildAnyway: true, explicitDistDir: null })).toBe('.next-build')
  })
  it('stays default when building normally', () => {
    expect(isolatedDistDir({ devListening: false, buildAnyway: false, explicitDistDir: null })).toBeNull()
    expect(isolatedDistDir({ devListening: false, buildAnyway: true, explicitDistDir: null })).toBeNull()
  })
  it('honors an explicit distDir regardless', () => {
    expect(isolatedDistDir({ devListening: false, buildAnyway: false, explicitDistDir: '.next-ci' })).toBe('.next-ci')
  })
})

describe('refusalMessage', () => {
  it('mentions pid, port, and both remediations', () => {
    const msg = refusalMessage({ pid: 1234, port: 3000, devScript: 'next dev' })
    expect(msg).toContain('1234')
    expect(msg).toContain('BUILD_ANYWAY=1')
    expect(msg).toContain('Stop the dev server')
  })
})

describe('exports', () => {
  it('keeps the default port in sync', () => {
    expect(DEV_PORT_DEFAULT).toBe(3000)
  })
})
