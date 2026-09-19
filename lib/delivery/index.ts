// =============================================================
// Delivery seam — the briefing is an ARTIFACT (an agent_runs session
// in Mission Control); delivery is a pluggable CHANNEL.
//
// Generation and delivery are deliberately decoupled so future
// enterprise channels (telegram / email / webhook push) are additive
// adapters here — generation, security, and the audit trail do not
// change. The artifact shape (BriefingPayload) is the stable contract.
// =============================================================

export type BriefingPayload = {
  headline: string
  counts: {
    needsAction: number
    followUpsDue: number
    atRisk: number
    total: number
    pendingApprovals: number
  }
  priorityLeads: Array<{
    id: string
    name: string
    category: string | null
    score: number | null
    recommendedAction: string | null
    overdueDueAt: string | null
  }>
  runId: string
  sessionId: string
}

export type DeliveryChannel = 'in_app'

export type DeliveryResult = {
  channel: DeliveryChannel
  delivered: boolean
  detail: string
}

export interface BriefingChannel {
  readonly name: DeliveryChannel
  deliver(payload: BriefingPayload, targetUserId: string): Promise<DeliveryResult>
}

/**
 * The in_app channel: the briefing already lives in Mission Control as
 * a pinned session — "delivery" is confirming that artifact exists.
 * Deterministic, cannot fail, and needs no credentials.
 */
export const inAppChannel: BriefingChannel = {
  name: 'in_app',
  async deliver(payload, _targetUserId) {
    return {
      channel: 'in_app',
      delivered: Boolean(payload.runId && payload.sessionId),
      detail: 'Pinned as today\'s Morning briefing session in Mission Control (/agent).',
    }
  },
}

/** Registry — new enterprise channels register here as they land. */
const channels: Record<DeliveryChannel, BriefingChannel> = {
  in_app: inAppChannel,
}

export function getChannel(name: DeliveryChannel): BriefingChannel | null {
  return channels[name] ?? null
}
