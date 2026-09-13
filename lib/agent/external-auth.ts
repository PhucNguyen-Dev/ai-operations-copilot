import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

// =============================================================
// 9.10 — External API client credentials. Each provisioned client has
// its own secret (never shared between callers, shown ONCE at
// provisioning); only the sha256 hash is stored. Verification is
// timing-safe. Clients are individually revocable (enabled flag).
// =============================================================

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

/** Constant-time comparison of two hex digests. */
export function secretsMatch(provided: string, storedHash: string): boolean {
  const a = Buffer.from(hashSecret(provided), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

export function generateCredentials(): { clientId: string; secret: string; secretHash: string } {
  const clientId = `ac_${randomBytes(8).toString('hex')}`
  const secret = `sk_${randomBytes(32).toString('base64url')}`
  return { clientId, secret, secretHash: hashSecret(secret) }
}

export function isValidClientId(clientId: string): boolean {
  return /^ac_[0-9a-f]{16}$/.test(clientId)
}

/** Scope check: the client must hold the required scope. */
export function hasScope(scopes: string[] | null | undefined, required: string): boolean {
  return (scopes ?? []).includes(required)
}
