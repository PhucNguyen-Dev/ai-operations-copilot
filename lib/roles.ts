// Pure role predicates (R-01: testable without Next.js/Supabase imports).
// lib/auth.ts re-exports these alongside the session helper.

export type Role = 'admin' | 'admissions' | 'operations' | 'marketing' | 'teacher' | 'unknown'

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
