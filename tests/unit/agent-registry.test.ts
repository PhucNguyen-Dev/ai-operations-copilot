import { describe, expect, it } from 'vitest'
import { AGENT_TOOLS, assertRegistryIntegrity, declarationsFor } from '@/lib/agent/registry'
import { AGENTS, getAgent } from '@/lib/agent/agents'
import { validateEmailArgs } from '@/lib/agent/tools/comms'
import { validateKnowledgeArgs } from '@/lib/agent/tools/knowledge'
import { createTaskTool, getLeadTool, searchLeadsTool } from '@/lib/agent/tools/crm'

// =============================================================
// 9.1 — registry: every agent-accessible capability is registered,
// carries full metadata, and validates its boundary in both
// directions (model → args, tool → result).
// =============================================================

describe('tool registry integrity (9.1)', () => {
  it('passes the integrity check — every entry has metadata, schemas, validators', () => {
    expect(assertRegistryIntegrity()).toEqual([])
  })

  it('registers the Phase 9 example capability set', () => {
    for (const name of [
      'get_lead',
      'search_leads',
      'get_lead_history',
      'create_task',
      'notify_counselor',
      'prepare_email',
      'search_knowledge',
      'escalate_to_human',
      'finish',
    ]) {
      expect(AGENT_TOOLS[name], `missing tool ${name}`).toBeTruthy()
    }
  })

  it('high-risk tools cannot bypass the approval protocol', () => {
    for (const tool of Object.values(AGENT_TOOLS)) {
      if (tool.riskLevel === 'external_side_effect' || tool.riskLevel === 'destructive') {
        expect(tool.requiresApproval, `${tool.name} needs requiresApproval`).toBeTypeOf('function')
      }
    }
    expect(AGENT_TOOLS.prepare_email.riskLevel).toBe('external_side_effect')
  })

  it('every tool of an agent allowlist exists in the registry', () => {
    for (const agent of Object.values(AGENTS)) {
      for (const toolName of agent.allowedTools) {
        expect(AGENT_TOOLS[toolName], `${agent.id} references unknown tool ${toolName}`).toBeTruthy()
      }
    }
  })

  it('declarationsFor exposes only the agent allowlist to the model', () => {
    const agent = AGENTS['admissions-followup']
    const decls = declarationsFor(agent.allowedTools)
    expect(decls.map((d) => d.name).sort()).toEqual([...agent.allowedTools].sort())
    for (const d of decls) {
      expect(d.description.length).toBeGreaterThan(0)
      expect(d.parameters).toBeTypeOf('object')
    }
  })
})

describe('tool input validators (9.1 boundary)', () => {
  it('get_lead rejects missing lead_id', () => {
    expect(getLeadTool.validateInput({}).ok).toBe(false)
    expect(getLeadTool.validateInput({ lead_id: '' }).ok).toBe(false)
    expect(getLeadTool.validateInput({ lead_id: 'abc' }).ok).toBe(true)
  })

  it('search_leads enforces enum + limit bounds', () => {
    expect(searchLeadsTool.validateInput({ status: 'bogus' }).ok).toBe(false)
    expect(searchLeadsTool.validateInput({ limit: 99 }).ok).toBe(false)
    expect(searchLeadsTool.validateInput({ status: 'new', category: 'HOT', limit: 5 }).ok).toBe(true)
    const ok = searchLeadsTool.validateInput({})
    expect(ok.ok && ok.data.limit).toBe(10) // default applied
  })

  it('create_task enforces title presence and priority/due bounds', () => {
    expect(createTaskTool.validateInput({ lead_id: 'l1' }).ok).toBe(false) // no title
    expect(createTaskTool.validateInput({ lead_id: 'l1', title: 'x', priority: 'urgent' }).ok).toBe(false)
    expect(createTaskTool.validateInput({ lead_id: 'l1', title: 'x', due_in_hours: 0 }).ok).toBe(false)
    const ok = createTaskTool.validateInput({ lead_id: 'l1', title: 'Call the lead' })
    expect(ok.ok && ok.data.priority).toBe('medium')
    expect(ok.ok && ok.data.due_in_hours).toBe(24)
  })

  it('prepare_email requires subject and body', () => {
    expect(validateEmailArgs({ lead_id: 'l1', subject: 'Hi' }).ok).toBe(false)
    expect(validateEmailArgs({ lead_id: 'l1', subject: 'Hi', body: 'Body' }).ok).toBe(true)
  })

  it('search_knowledge requires a query', () => {
    expect(validateKnowledgeArgs({ query: '' }).ok).toBe(false)
    expect(validateKnowledgeArgs({ query: 'pricing' }).ok).toBe(true)
  })
})

describe('agent registry (9.5 agent as principal)', () => {
  it('unknown agents are not resolvable', () => {
    expect(getAgent('admissions-followup')).toBeTruthy()
    expect(getAgent('nope')).toBeNull()
  })
})
