import SiteHeader from '@/components/site-header'
import NotAllowed from '@/components/not-allowed'
import { requireUser } from '@/lib/auth'
import { canUseTool } from '@/lib/roles'
import QuizGeneratorForm from '@/components/ai/quiz-generator-form'

export default async function QuizGeneratorPage() {
  const { role } = await requireUser()
  if (!canUseTool(role, 'F-023')) {
    return <NotAllowed role={role} what="The AI Quiz Generator" />
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <SiteHeader
        title="AI Quiz Generator"
        subtitle="F-023 · Academic — topic, difficulty, count → multiple-choice questions with answers and explanations. Draft for your review."
      />
      <QuizGeneratorForm />
    </main>
  )
}
