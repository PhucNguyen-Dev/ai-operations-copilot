import { afterAll, describe, expect, it, vi } from 'vitest'
import { AGENTS, resolveAgentPrompt } from '@/lib/agent/agents'
import { committedPrompt } from '@/lib/promptledger'
import committedAdmissions from '@/prompts/admissions-followup.json'

// =============================================================
// Bundle C — agent prompts are registry-owned. Pins:
//   * the committed prompts/<agent>.json files are the single source
//     (the in-code constants must mirror them exactly — a prompt edit
//     that only touches one side fails here);
//   * unconfigured Ledger → committed fallback, source 'committed';
//   * ledgerPrompt:false agents (tests/custom) → in-code prompt,
//     source 'runtime'.
// Configured-but-broken fail-closed behavior is covered by the
// existing promptledger unit tests (PL_UNREACHABLE / PL_NO_LIVE).
// =============================================================

afterAll(() => {
  vi.unstubAllEnvs()
})

describe('agent prompt ownership (C1)', () => {
  it('keeps the in-code prompt identical to the committed prompts/ source', () => {
    expect(AGENTS['admissions-followup']!.systemPrompt).toBe(committedAdmissions.system)
  })

  it('resolves governed agents to the committed fallback when the Ledger is unconfigured', async () => {
    vi.stubEnv('PROMPTLEDGER_URL', '') // explicitly unconfigured
    const resolved = await resolveAgentPrompt(AGENTS['admissions-followup']!)
    expect(resolved.source).toBe('committed')
    expect(resolved.version).toBeNull()
    expect(resolved.agent.systemPrompt).toBe(committedAdmissions.system)
  })

  it('serves the in-code prompt for ledgerPrompt:false agents (source: runtime)', async () => {
    vi.stubEnv('PROMPTLEDGER_URL', '') // irrelevant for this path
    const resolved = await resolveAgentPrompt({
      id: 'custom-agent',
      displayName: 'Custom',
      description: '',
      allowedRoles: [],
      allowedTools: [],
      systemPrompt: 'custom text',
      ledgerPrompt: false,
    })
    expect(resolved.source).toBe('runtime')
    expect(resolved.agent.systemPrompt).toBe('custom text')
  })

  it('throws the typed PL_NO_LIVE error for unknown names (registry data problem)', () => {
    expect(() => committedPrompt('not-a-real-prompt')).toThrowError(/no committed prompt/)
  })
})
