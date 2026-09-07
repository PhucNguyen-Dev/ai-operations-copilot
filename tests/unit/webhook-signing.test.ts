import { describe, expect, it } from 'vitest'
import { signPayload, verifyEnvelope, WEBHOOK_REPLAY_WINDOW_MS } from '@/lib/webhook-signing'

const SECRET = 'test-secret-for-vitest'
const PAYLOAD = { name: 'Test', email: 't@example.com', message: null }

describe('webhook HMAC signing (R-04)', () => {
  it('verifies a signature produced by signPayload', async () => {
    const now = Date.now()
    const { signature } = await signPayload(PAYLOAD, SECRET, now)
    const r = await verifyEnvelope({ timestamp: now, signature, payload: PAYLOAD }, SECRET, now)
    expect(r.ok).toBe(true)
  })

  it('rejects a tampered payload', async () => {
    const now = Date.now()
    const { signature } = await signPayload(PAYLOAD, SECRET, now)
    const r = await verifyEnvelope(
      { timestamp: now, signature, payload: { ...PAYLOAD, email: 'attacker@evil.com' } },
      SECRET,
      now
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('bad_signature')
  })

  it('rejects a tampered signature', async () => {
    const now = Date.now()
    const { signature } = await signPayload(PAYLOAD, SECRET, now)
    const bad = signature.slice(0, -2) + (signature.endsWith('aa') ? 'bb' : 'aa')
    const r = await verifyEnvelope({ timestamp: now, signature: bad, payload: PAYLOAD }, SECRET, now)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('bad_signature')
  })

  it('rejects signatures made with the wrong secret', async () => {
    const now = Date.now()
    const { signature } = await signPayload(PAYLOAD, 'other-secret', now)
    const r = await verifyEnvelope({ timestamp: now, signature, payload: PAYLOAD }, SECRET, now)
    expect(r.ok).toBe(false)
  })

  it('enforces the replay window', async () => {
    const fresh = Date.now() - 1000
    const { signature } = await signPayload(PAYLOAD, SECRET, fresh)
    expect((await verifyEnvelope({ timestamp: fresh, signature, payload: PAYLOAD }, SECRET, Date.now())).ok).toBe(true)
    const stale = Date.now() - WEBHOOK_REPLAY_WINDOW_MS - 1000
    const staleSig = (await signPayload(PAYLOAD, SECRET, stale)).signature
    const r = await verifyEnvelope({ timestamp: stale, signature: staleSig, payload: PAYLOAD }, SECRET, Date.now())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('stale_timestamp')
  })

  it('rejects missing/malformed envelope fields', async () => {
    for (const envelope of [{}, { timestamp: Date.now() }, { timestamp: 'not-a-number', signature: 'x', payload: PAYLOAD }]) {
      const r = await verifyEnvelope(envelope as never, SECRET, Date.now())
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toBe('missing_signature')
    }
  })

  it('is deterministic: same inputs -> same signature', async () => {
    const now = 1_700_000_000_000
    expect((await signPayload(PAYLOAD, SECRET, now)).signature).toBe(
      (await signPayload(PAYLOAD, SECRET, now)).signature
    )
  })

  it('different payloads -> different signatures', async () => {
    const now = Date.now()
    expect((await signPayload(PAYLOAD, SECRET, now)).signature).not.toBe(
      (await signPayload({ ...PAYLOAD, name: 'X' }, SECRET, now)).signature
    )
  })
})
