import SiteHeader from '@/components/site-header'

export const dynamic = 'force-dynamic'

const PROGRAMS = [
  {
    dept: 'Marketing',
    color: 'bg-pink-100 text-pink-800',
    objectives: [
      'Use the AI Content Generator to produce first-draft ad and social copy in minutes, not hours',
      'Write briefs (campaign, audience, platform, tone, objective) that produce usable first drafts',
      'Interpret Campaign Analyzer output: strong/weak segments, trends, and recommendations',
      'Verify AI copy for factual claims and brand voice before anything is published',
    ],
    agenda: [
      'Intro: where AI fits in the marketing workflow (drafting, never auto-publishing)',
      'Live demo: campaign brief → headlines, ad copy, CTA variations',
      'Exercise: each participant briefs one real campaign and rates the output',
      'Prompting basics: what to include so the first draft is usable',
      'Verification checklist: facts, prices, claims, tone',
    ],
    exercise: 'Generate copy for one real upcoming campaign; mark every claim that needs human verification; rewrite one headline in the brand voice.',
    promptTemplate: 'Campaign: [name]. Audience: [who]. Platform: [where]. Tone: [how it should sound]. Objective: [what the reader should do].',
    reviewRule: 'Every AI draft is reviewed by the marketer who owns the campaign. Nothing is published directly from AI output.',
  },
  {
    dept: 'Admissions',
    color: 'bg-blue-100 text-blue-800',
    objectives: [
      'Understand how AI lead scoring works: score 0–100, HOT/WARM/COLD thresholds, and what the model reads',
      'Work the AI-assisted queue: hottest leads first, using the recommended action',
      'Review and personalize AI-drafted first-touch emails before sending',
      'Know when to override the AI and how to escalate misclassifications',
    ],
    agenda: [
      'Intro: the automated lead pipeline, step by step (what the AI does and does not decide)',
      'Reading an AI analysis: score, category, intent, summary, recommended action',
      'Exercise: triage 5 sample leads (HOT/WARM/COLD) and compare against the AI classification calls',
      'Email review: personalize the AI draft, check course facts and prices',
      'Override & escalation: when the counselor knows better, and where to record it',
    ],
    exercise: 'For one HOT lead: send the AI-drafted email after personalizing two details, and note one thing the AI got wrong or missed.',
    promptTemplate: '(Pipeline-generated) Review focus: does the summary match the message? Is the recommended action realistic within the SLA?',
    reviewRule: 'Counselors own every lead the AI classifies. The AI prioritizes; the counselor decides. Misclassifications are reported to Operations.',
  },
  {
    dept: 'Academic',
    color: 'bg-green-100 text-green-800',
    objectives: [
      'Use the AI Lesson Planner to produce a structured first-draft lesson plan from grade, subject, topic, duration',
      'Use the AI Quiz Generator for question banks with answers and explanations',
      'Fact-check every generated question, answer, and explanation before classroom use',
      'Adapt AI drafts to the actual class level and curriculum',
    ],
    agenda: [
      'Intro: AI as a preparation assistant, not a teaching authority',
      'Live demo: topic → lesson structure, activities, materials, homework',
      'Live demo: quiz generation with distractors and explanations',
      'Exercise: generate a quiz, find and fix one factual or level issue',
      'Responsible use: what must never be delegated to AI (grading decisions, student data)',
    ],
    exercise: 'Generate a lesson plan for the hardest topic planned for next week; identify the weakest activity and replace it with your own.',
    promptTemplate: 'Grade/level: [x]. Subject: [y]. Topic: [z]. Duration: [n] minutes. Objectives: [what students should be able to do afterwards].',
    reviewRule: 'Teachers fact-check all generated content before use. Generated quizzes are drafts until the teacher approves every answer key.',
  },
  {
    dept: 'Operations',
    color: 'bg-amber-100 text-amber-800',
    objectives: [
      'Use the AI Report Generator to summarize operational data into executive summaries',
      'Select the right date range and metrics for a defensible report',
      'Interpret AI-generated trends and recommendations critically before acting on them',
      'Understand the health signals of the automation pipeline (runs, failures, retries)',
    ],
    agenda: [
      'Intro: from scattered data to an executive summary in one step',
      'Reading the output: summary, key metrics, problems, trends, recommendations',
      'Exercise: generate a monthly report and challenge one AI recommendation',
      'Automation basics: what the pipeline logs, what a failed run means',
      'Governance workflow: how new AI tools get tested, evaluated, and adopted (this hub)',
    ],
    exercise: 'Generate the monthly operations report, verify two key numbers against the source dashboard, and flag one recommendation you would not act on.',
    promptTemplate: 'Data: [selected operational data]. Date range: [from–to]. Metrics: [which]. Audience: [leadership/team].',
    reviewRule: 'Operations validates AI reports against source data before circulating. The AI summarizes; the data remains the source of truth.',
  },
]

export default function TrainingPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <SiteHeader
        title="Employee AI Training (F-028)"
        subtitle="Designed per-department training programs for responsible AI use. Design artifact — completion is not claimed."
      />
      <div className="space-y-6">
        {PROGRAMS.map((p) => (
          <section key={p.dept} className="rounded-lg border bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">{p.dept}</h2>
              <span className={`rounded px-2 py-0.5 text-xs font-semibold ${p.color}`}>training program design</span>
            </div>

            <div className="mt-4 grid gap-6 md:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Learning objectives</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-gray-700">
                  {p.objectives.map((o) => <li key={o}>{o}</li>)}
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Session agenda</p>
                <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-gray-700">
                  {p.agenda.map((a) => <li key={a}>{a}</li>)}
                </ol>
              </div>
            </div>

            <div className="mt-4 space-y-2 text-sm">
              <p><span className="font-medium">Practical exercise:</span> {p.exercise}</p>
              <p><span className="font-medium">Prompt template:</span> <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">{p.promptTemplate}</code></p>
              <p className="rounded border-l-4 border-gray-900 bg-gray-50 p-3"><span className="font-medium">Human-review requirement:</span> {p.reviewRule}</p>
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}
