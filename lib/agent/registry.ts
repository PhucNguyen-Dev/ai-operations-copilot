import type { FunctionDeclaration, ToolDefinition } from '@/lib/agent/types'
import { CRM_TOOLS } from '@/lib/agent/tools/crm'
import { COMMS_TOOLS } from '@/lib/agent/tools/comms'
import { KNOWLEDGE_TOOLS } from '@/lib/agent/tools/knowledge'
import { CONTROL_TOOLS } from '@/lib/agent/tools/control'
import { DELEGATION_TOOLS } from '@/lib/agent/tools/delegation'

// =============================================================
// 9.1 — THE Central Tool Registry. One authoritative map of every
// capability an agent can invoke. Nothing executes that is not defined
// here; nothing is registered without metadata, schemas, permission
// and risk information. Adding a capability = adding a ToolDefinition
// here (and its version travels on every execution trace).
// =============================================================

export const AGENT_TOOLS: Record<string, ToolDefinition<never, never>> = Object.fromEntries(
  [...CRM_TOOLS, ...COMMS_TOOLS, ...KNOWLEDGE_TOOLS, ...CONTROL_TOOLS, ...DELEGATION_TOOLS].map((t) => [t.name, t as unknown as ToolDefinition<never, never>])
)

export function getTool(
  name: string,
  registry: Record<string, ToolDefinition<never, never>> = AGENT_TOOLS
): ToolDefinition<never, never> | null {
  return registry[name] ?? null
}

/** Model-facing declarations for a tool-name subset (the agent's allowlist). */
export function declarationsFor(
  toolNames: string[],
  registry: Record<string, ToolDefinition<never, never>> = AGENT_TOOLS
): FunctionDeclaration[] {
  return toolNames
    .map((n) => registry[n])
    .filter((t): t is ToolDefinition<never, never> => Boolean(t))
    .map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }))
}

/**
 * Registry integrity check (9.1 acceptance criteria) — runs in unit
 * tests so a malformed registration fails CI, not production.
 */
export function assertRegistryIntegrity(): string[] {
  const errors: string[] = []
  const names = Object.keys(AGENT_TOOLS)
  if (names.length === 0) errors.push('registry is empty')
  const seen = new Set<string>()
  for (const name of names) {
    if (seen.has(name)) errors.push(`duplicate tool name: ${name}`)
    seen.add(name)
    const t = AGENT_TOOLS[name]
    if (!/^\d+\.\d+\.\d+$/.test(t.version)) errors.push(`${name}: version must be semver-like`)
    if (!t.description.trim()) errors.push(`${name}: description required`)
    if (!['read', 'write', 'external_side_effect', 'destructive'].includes(t.riskLevel)) {
      errors.push(`${name}: invalid riskLevel ${t.riskLevel}`)
    }
    if (t.allowedAgents.length === 0) errors.push(`${name}: allowedAgents required`)
    if (t.allowedRoles.length === 0) errors.push(`${name}: allowedRoles required`)
    if (typeof t.validateInput !== 'function' || typeof t.validateOutput !== 'function') {
      errors.push(`${name}: input and output validators required`)
    }
    if (!t.timeoutMs || t.timeoutMs < 100) errors.push(`${name}: timeoutMs must be >= 100`)
    if (t.parameters === null || typeof t.parameters !== 'object') {
      errors.push(`${name}: parameters schema required`)
    }
    // High-risk tools must carry an explicit approval policy (9.6).
    if (
      (t.riskLevel === 'external_side_effect' || t.riskLevel === 'destructive') &&
      t.requiresApproval === undefined
    ) {
      errors.push(`${name}: external_side_effect/destructive tools must define requiresApproval`)
    }
    if (t.control === undefined && typeof t.execute !== 'function') {
      errors.push(`${name}: execute required`)
    }
  }
  // The loop cannot terminate without both control tools registered.
  if (!seen.has('finish')) errors.push('finish control tool must be registered')
  if (!seen.has('escalate_to_human')) errors.push('escalate_to_human control tool must be registered')
  return errors
}
