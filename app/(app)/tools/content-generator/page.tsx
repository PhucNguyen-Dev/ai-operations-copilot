import SiteHeader from '@/components/site-header'
import NotAllowed from '@/components/not-allowed'
import { requireUser } from '@/lib/auth'
import { canUseTool } from '@/lib/roles'
import ContentGeneratorForm from '@/components/ai/content-generator-form'
import ToolFooter from '@/components/tool-footer'

export default async function ContentGeneratorPage() {
  const { role } = await requireUser()
  if (!canUseTool(role, 'F-020')) {
    return <NotAllowed role={role} what="The AI Content Generator" />
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <SiteHeader
        title="AI Content Generator"
        subtitle="F-020 · Marketing — campaign brief → headlines, ad copy, CTA variations. Every output is a draft for your review."
      />
      <ContentGeneratorForm />
      <ToolFooter department="Marketing" />
    </main>
  )
}
