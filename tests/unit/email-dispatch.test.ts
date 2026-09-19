import { afterEach, describe, expect, it, vi } from 'vitest'
import { dispatchEmail, isBrevoConfigured, type DispatchMessage } from '@/lib/email/dispatch'

// =============================================================
// Dispatch decision table — the execution half of the approval gate
// must be predictable: configured → real send, unconfigured → honest
// simulation, provider errors → typed failure with retryability.
// =============================================================

const msg: DispatchMessage = { to: 'parent@example.com', subject: 'IELTS follow-up', body: 'Hello!' }

describe('email dispatch decision table', () => {
  const ORIGINAL = { ...process.env }

  afterEach(() => {
    process.env = { ...ORIGINAL }
    vi.unstubAllGlobals()
  })

  it('reports unconfigured without Brevo env vars', () => {
    delete process.env.BREVO_API_KEY
    delete process.env.BREVO_FROM_EMAIL
    expect(isBrevoConfigured()).toBe(false)
  })

  it('simulates honestly when not configured — nothing leaves', async () => {
    delete process.env.BREVO_API_KEY
    delete process.env.BREVO_FROM_EMAIL
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const out = await dispatchEmail(msg)
    expect(out).toEqual({ kind: 'sent_simulated', note: expect.stringContaining('not configured') })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('sends via Brevo when configured and returns the provider message id', async () => {
    process.env.BREVO_API_KEY = 'test-key'
    process.env.BREVO_FROM_EMAIL = 'admissions@school.test'
    process.env.BREVO_FROM_NAME = 'Test Sender'
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messageId: 'msg-1' }), { status: 201 }))
    vi.stubGlobal('fetch', fetchSpy)

    const out = await dispatchEmail(msg)
    expect(out).toEqual({ kind: 'sent', providerMessageId: 'msg-1' })
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://api.brevo.com/v3/smtp/email')
    expect(init.headers['api-key']).toBe('test-key')
    const body = JSON.parse(init.body)
    expect(body.to).toEqual([{ email: 'parent@example.com' }])
    expect(body.sender).toEqual({ email: 'admissions@school.test', name: 'Test Sender' })
  })

  it.each([
    { status: 401, retryable: false },
    { status: 429, retryable: false },
    { status: 500, retryable: true },
    { status: 503, retryable: true },
  ])('maps Brevo $status to failed with retryable=$retryable', async ({ status, retryable }) => {
    process.env.BREVO_API_KEY = 'test-key'
    process.env.BREVO_FROM_EMAIL = 'admissions@school.test'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"message":"nope"}', { status })))

    const out = await dispatchEmail(msg)
    expect(out.kind).toBe('failed')
    if (out.kind === 'failed') {
      expect(out.retryable).toBe(retryable)
      expect(out.error).toContain(String(status))
    }
  })

  it('treats network failure/timeout as retryable', async () => {
    process.env.BREVO_API_KEY = 'test-key'
    process.env.BREVO_FROM_EMAIL = 'admissions@school.test'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket hang up')))

    const out = await dispatchEmail(msg)
    expect(out).toEqual({ kind: 'failed', error: expect.stringContaining('socket hang up'), retryable: true })
  })

  it('fails fast on a malformed message without calling the provider', async () => {
    process.env.BREVO_API_KEY = 'test-key'
    process.env.BREVO_FROM_EMAIL = 'admissions@school.test'
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const out = await dispatchEmail({ to: '', subject: 'x', body: 'y' })
    expect(out.kind).toBe('failed')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
