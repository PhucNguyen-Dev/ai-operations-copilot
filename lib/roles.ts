// Pure role predicates (R-01: testable without Next.js/Supabase imports).
// lib/auth.ts re-exports these alongside the session helper.

export type Role = 'admin' | 'admissions' | 'operations' | 'marketing' | 'teacher' | 'external' | 'unknown'

const OPS_ADMIN: Role[] = ['operations', 'admin']
const ADMISSIONS_ADMIN: Role[] = ['admissions', 'admin']

/** Can see the Automation Logs Viewer and the Ops/Admin overview. */
export function canViewAutomation(role: Role): boolean {
  return OPS_ADMIN.includes(role)
}

/** Can submit test leads (F-001). */
export function canSubmitLeads(role: Role): boolean {
  return ADMISSIONS_ADMIN.includes(role)
}

// -------------------------------------------------------------
// Phase 6 AI tools (F-020–F-024) — role × tool access.
// -------------------------------------------------------------
export type Department = 'marketing' | 'academic' | 'operations'

export type ToolAccess = {
  toolId: string
  department: Department
  /** Roles allowed to run this tool ('admin' is always allowed). */
  roles: Role[]
}

export const AI_TOOLS: Record<string, ToolAccess> = {
  'F-020': { toolId: 'F-020', department: 'marketing', roles: ['marketing'] },
  'F-021': { toolId: 'F-021', department: 'marketing', roles: ['marketing'] },
  'F-022': { toolId: 'F-022', department: 'academic', roles: ['teacher'] },
  'F-023': { toolId: 'F-023', department: 'academic', roles: ['teacher'] },
  'F-024': { toolId: 'F-024', department: 'operations', roles: ['operations'] },
}

/** Can this role run this tool? Admin passes everything. */
export function canUseTool(role: Role, toolId: string): boolean {
  const tool = AI_TOOLS[toolId]
  if (!tool) return false
  if (role === 'admin') return true
  return tool.roles.includes(role)
}
