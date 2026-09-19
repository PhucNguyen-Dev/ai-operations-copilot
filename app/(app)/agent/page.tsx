import { requireUser, canViewAutomation } from '@/lib/auth'
import NotAllowed from '@/components/not-allowed'
import AgentWorkspace from './AgentWorkspace'

/**
 * 9.9 — Employee "Ask X" interface: role-scoped conversational access
 * to the governed agent runtime. No direct database access from the
 * chat — every answer is produced by registered tools through the
 * same permission engine, guardrails and trace as any other run.
 */
export default async function AgentPage() {
  const { role } = await requireUser()
  if (role !== 'admissions' && role !== 'admin') {
    return <NotAllowed role={role} what="The Ask X agent" />
  }
  const canDecide = canViewAutomation(role)

  return <AgentWorkspace canDecide={canDecide} />
}
