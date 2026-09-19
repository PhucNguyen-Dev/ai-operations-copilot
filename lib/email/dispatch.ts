// =============================================================
// Email dispatch — the execution half of the human approval gate.
//
// One function, two honest outcomes:
//   * Brevo configured (BREVO_API_KEY + BREVO_FROM_EMAIL) → real send
//     via Brevo's HTTP API (fetch — no SMTP dependency, no new npm
//     packages) and the provider message id comes back for the audit.
//   * Not configured → simulated dispatch: recorded, audited, clearly
//     labeled; nothing leaves the building.
// Provider errors NEVER throw into the UI — they return a typed
// failure the caller persists as status='failed' + dispatch_error,
// making the failure visible and retryable.
// =============================================================

export type DispatchOutcome =
  | { kind: 'sent'; providerMessageId: string }
  | { kind: 'sent_simulated'; note: string }
  | { kind: 'failed'; error: string; retryable: boolean }

export type DispatchMessage = {
  to: string
  subject: string
  body: string
}

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email'
const TIMEOUT_MS = 15_000

export function isBrevoConfigured(): boolean {
  return Boolean(process.env.BREVO_API_KEY && process.env.BREVO_FROM_EMAIL)
}

function brevoConfig(): { key: string; from: string; name: string } | null {
  const key = process.env.BREVO_API_KEY
  const from = process.env.BREVO_FROM_EMAIL
  if (!key || !from) return null
  return { key, from, name: process.env.BREVO_FROM_NAME ?? 'Admissions Team' }
}

/**
 * Dispatch one email. Configured → real Brevo send; unconfigured →
 * simulated. Throws only on programmer error (invalid message shape),
 * never on provider failure.
 */
export async function dispatchEmail(msg: DispatchMessage): Promise<DispatchOutcome> {
  if (!msg.to || !msg.subject || !msg.body) {
    return { kind: 'failed', error: 'Message is missing recipient, subject or body', retryable: false }
  }

  const cfg = brevoConfig()
  if (!cfg) {
    return {
      kind: 'sent_simulated',
      note: 'Brevo not configured — dispatch simulated for the audit trail',
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': cfg.key,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        sender: { email: cfg.from, name: cfg.name },
        to: [{ email: msg.to }],
        subject: msg.subject,
        textContent: msg.body,
      }),
    })

    if (res.status === 201) {
      const data = (await res.json().catch(() => ({}))) as { messageId?: string }
      return { kind: 'sent', providerMessageId: data.messageId ?? 'brevo-accepted' }
    }

    // 401/402/429 are configuration/quota problems the operator must
    // fix (bad key, account suspended, rate) — retrying unchanged
    // won't help. 5xx/timeouts are transient → retryable.
    const detail = (await res.text().catch(() => '')).slice(0, 300)
    const retryable = res.status >= 500
    return {
      kind: 'failed',
      error: `Brevo ${res.status}: ${detail || res.statusText}`,
      retryable,
    }
  } catch (e) {
    const msgText = e instanceof Error ? e.message : String(e)
    return { kind: 'failed', error: `Brevo request failed: ${msgText}`, retryable: true }
  } finally {
    clearTimeout(timer)
  }
}
