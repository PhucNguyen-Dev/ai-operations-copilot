// R-04 — webhook request signing (HMAC-SHA256 over timestamp + payload).
//
// The static shared secret (x-webhook-secret header) stays as layer 1;
// this signature adds tamper-evidence and replay protection on top:
//   signature = HMAC_SHA256(secret, `${timestamp}.${JSON.stringify(payload)}`)
// The receiver re-computes the HMAC over the SAME payload object it parsed
// (JSON key order is preserved by JSON.parse/stringify for non-numeric
// keys) and rejects anything stale or mismatched.
//
// Web Crypto is used on both sides (Next.js server + n8n Code node) so the
// exact same algorithm runs everywhere.

export const WEBHOOK_REPLAY_WINDOW_MS = 5 * 60_000

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmacHex(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return toHex(mac)
}

/** Sign one outbound webhook payload. Returns the headers to attach. */
export async function signPayload(
  payload: unknown,
  secret: string,
  timestamp: number
): Promise<{ signature: string }> {
  return { signature: await hmacHex(`${timestamp}.${JSON.stringify(payload)}`, secret) }
}

export type VerifyReason = 'missing_signature' | 'stale_timestamp' | 'bad_signature'

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: VerifyReason }

/** Pure verification: freshness check + HMAC comparison (no I/O). */
export async function verifyEnvelope(
  envelope: { timestamp?: unknown; signature?: unknown; payload?: unknown },
  secret: string,
  now = Date.now()
): Promise<VerifyResult> {
  const timestamp = envelope.timestamp
  const signature = envelope.signature

  if (typeof timestamp !== 'number' || typeof signature !== 'string' || !signature) {
    return { ok: false, reason: 'missing_signature' }
  }
  if (Math.abs(now - timestamp) > WEBHOOK_REPLAY_WINDOW_MS) {
    return { ok: false, reason: 'stale_timestamp' }
  }
  const expected = await hmacHex(`${timestamp}.${JSON.stringify(envelope.payload)}`, secret)
  // Constant-time-ish compare (length check + XOR walk) — avoids the
  // early-exit that makes plain === a timing oracle.
  if (signature.length !== expected.length) return { ok: false, reason: 'bad_signature' }
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= signature.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0 ? { ok: true } : { ok: false, reason: 'bad_signature' }
}
