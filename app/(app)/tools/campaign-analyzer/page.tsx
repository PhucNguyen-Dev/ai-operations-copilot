import SiteHeader from '@/components/site-header'
import NotAllowed from '@/components/not-allowed'
import { requireUser } from '@/lib/auth'
import { canUseTool } from '@/lib/roles'
import { CampaignAnalyzerForm } from '@/components/ai/campaign-analyzer-form'
import ToolFooter from '@/components/tool-footer'

export default async function CampaignAnalyzerPage() {
  const { role } = await requireUser()
  if (!canUseTool(role, 'F-021')) {
    return <NotAllowed role={role} what="The Campaign Analyzer" />
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <SiteHeader
        title="Campaign Analyzer"
        subtitle="F-021 · Marketing — paste campaign metrics (CSV or text), get performance insights. Draft analysis for your review."
      />
      <CampaignAnalyzerForm />
      <ToolFooter department="Marketing" />
    </main>
  )
}
