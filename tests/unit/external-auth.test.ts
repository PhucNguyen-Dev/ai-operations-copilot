import { describe, expect, it } from 'vitest'
import { generateCredentials, hashSecret, hasScope, isValidClientId, secretsMatch } from '@/lib/agent/external-auth'

// 9.10 — external client credential handling. These are the exact
// properties the API surface depends on: hashed-at-rest secrets,
// timing-safe comparison, scoped capability checks.
// =============================================================

describe('external client credentials (9.10)', () => {
  it('hashes deterministically and never stores the raw secret', () => {
    const { secret, secretHash } = generateCredentials()
    expect(secretHash).toBe(hashSecret(secret))
    expect(secretHash).toMatch(/^[0-9a-f]{64}$/)
    expect(secretHash).not.toContain(secret)
  })

  it('verifies the right secret and rejects the wrong one', () => {
    const { secret, secretHash } = generateCredentials()
    expect(secretsMatch(secret, secretHash)).toBe(true)
    expect(secretsMatch(`${secret}x`, secretHash)).toBe(false)
    expect(secretsMatch('sk_wrong', secretHash)).toBe(false)
  })

  it('generates well-formed credential pairs', () => {
    const { clientId, secret } = generateCredentials()
    expect(isValidClientId(clientId)).toBe(true)
    expect(secret).toMatch(/^sk_[A-Za-z0-9_-]{43}$/)
  })

  it('rejects malformed client ids', () => {
    expect(isValidClientId('ac_xyz')).toBe(false)
    expect(isValidClientId('')).toBe(false)
    expect(isValidClientId("ac_'; drop table --")).toBe(false)
  })

  it('checks scopes for capability gating', () => {
    expect(hasScope(['agent.run'], 'agent.run')).toBe(true)
    expect(hasScope([], 'agent.run')).toBe(false)
    expect(hasScope(null, 'agent.run')).toBe(false)
    expect(hasScope(['agent.run'], 'agent.admin')).toBe(false)
  })
})
