import { createClient } from '@/lib/supabase/server'
import SiteHeader from '@/components/site-header'

export const dynamic = 'force-dynamic'

// Registry-ready role → department mapping: the future access-gate (PHASE7-SUMMARY §10)
// checks exactly this key — "which department's training does this role require?"
const ROLE_TO_DEPARTMENT: Record<string, { dept: string; why: string }> = {
  marketing: { dept: 'Marketing', why: 'you use the Content Generator and Campaign Analyzer' },
  admissions: { dept: 'Admissions', why: 'you work AI-qualified leads and AI-drafted emails' },
  teacher: { dept: 'Academic', why: 'you use the Lesson Planner and Quiz Generator' },
  operations: { dept: 'Operations', why: 'you run the AI Report Generator and watch the automations' },
  admin: { dept: 'Operations', why: 'you administer the whole system' },
}

const CARD = 'rounded-lg border bg-white p-6 shadow-sm hover:shadow-md transition-shadow'

export default async function GuidelinesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  const role = ((user?.app_metadata as Record<string, string> | undefined)?.role) ?? 'unknown'
  const mine = ROLE_TO_DEPARTMENT[role] ?? { dept: 'your department', why: 'your role' }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <SiteHeader
        title="AI Guidelines"
        subtitle="How we use AI here — what you can do with it, the rules, and your training."
      />

      <div className="mb-8 rounded-lg border-l-4 border-gray-900 bg-white p-5 shadow-sm">
        <p className="text-sm text-gray-700">
          <span className="font-medium">The one rule that covers everything:</span> AI drafts — you decide.
          Anything AI produces here is a starting point for you to review, fix, and own. Nothing is sent,
          published, or taught straight from AI output.
        </p>
      </div>

      <div className="grid gap-4">
        <a href="/governance/training" className={CARD}>
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-semibold">Your department training</h2>
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{mine.dept} · your program</span>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            Learning objectives, a session agenda, a practical exercise, and a prompt template for{' '}
            {mine.dept} staff — because {mine.why}.
          </p>
        </a>

        <a href="/governance/sop" className={CARD}>
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-semibold">The rules (SOPs)</h2>
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">7 guides</span>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            Usage guidelines, prompting, how leads are handled, how AI-drafted emails are reviewed, what the
            automation does, what to do when something breaks, and data privacy.
          </p>
        </a>

        <a href="/governance/workshop" className={CARD}>
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-semibold">The AI workshop</h2>
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">90 minutes</span>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            “AI for Everyday Work” — prompting basics, your department's use cases, a live automation demo,
            and a hands-on exercise with your own review checklist.
          </p>
        </a>
      </div>

      <p className="mt-6 text-xs text-gray-400">
        Questions about AI usage → your department lead or Operations. Tool access questions → Operations
        (see the AI Automation User Guide in the SOPs).
      </p>
    </main>
  )
}
