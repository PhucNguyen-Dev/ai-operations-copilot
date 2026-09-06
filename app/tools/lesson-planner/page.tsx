import SiteHeader from '@/components/site-header'
import NotAllowed from '@/components/not-allowed'
import { requireUser } from '@/lib/auth'
import { canUseTool } from '@/lib/roles'
import LessonPlannerForm from '@/components/ai/lesson-planner-form'

export default async function LessonPlannerPage() {
  const { role } = await requireUser()
  if (!canUseTool(role, 'F-022')) {
    return <NotAllowed role={role} what="The AI Lesson Planner" />
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <SiteHeader
        title="AI Lesson Planner"
        subtitle="F-022 · Academic — topic and duration → a structured, time-boxed lesson plan. Draft for your review."
      />
      <LessonPlannerForm />
    </main>
  )
}
