import SiteHeader from '@/components/site-header'
import NotAllowed from '@/components/not-allowed'
import { requireUser } from '@/lib/auth'
import { canUseTool } from '@/lib/roles'
import ReportGeneratorForm from '@/components/ai/report-generator-form'
import ToolFooter from '@/components/tool-footer'

export default async function ReportGeneratorPage() {
  const { role } = await requireUser()
  if (!canUseTool(role, 'F-024')) {
    return <NotAllowed role={role} what="The AI Report Generator" />
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <SiteHeader
        title="AI Report Generator"
        subtitle="F-024 · Operations — real system aggregates for the selected period → executive report. Draft for your review."
      />
      <ReportGeneratorForm />
      <ToolFooter department="Operations" />
    </main>
  )
}
