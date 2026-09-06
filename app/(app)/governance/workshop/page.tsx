import SiteHeader from '@/components/site-header'

export const dynamic = 'force-dynamic'

const SEGMENTS = [
  ['0–10 min', 'Introduction and goals', 'Why AI, why now, and the one rule: AI drafts, humans decide. Who this workshop is for.'],
  ['10–25 min', 'Prompting basics', 'What makes a usable first draft: context, format, constraints, examples. Live prompt makeovers.'],
  ['25–45 min', 'Department use cases', 'Split by department: Marketing (content generator), Academic (lesson/quiz), Operations (reports), Admissions (lead pipeline tour).'],
  ['45–65 min', 'Live automation demonstration', 'The Admissions pipeline, live: submit a test lead and watch it get validated, analyzed, scored, emailed (dry-run), tasked, and logged — end to end in under a minute.'],
  ['65–80 min', 'Hands-on exercise', 'Everyone generates one real work artifact with an AI tool (copy, quiz, or report) and applies their department review checklist to it.'],
  ['80–90 min', 'Q&A and best practices', 'Where AI helped, where it fell short, what to do about errors, and where to find the SOPs.'],
]

const FACILITATOR_NOTES = [
  'Run the live demo twice before the session — the pipeline needs n8n running and quota available.',
  'Keep the demo lead realistic and slightly messy; a perfect lead is a boring demo.',
  'If a tool call fails live, use it: show the failed automation run in the logs viewer and explain the retry/error design.',
  'Collect one "where I would use this tomorrow" commitment from each participant at the end.',
]

const HANDS_ON = {
  task: 'Produce one real work artifact with an AI tool and review it properly.',
  steps: [
    'Pick the tool for your department (Content Generator / Lesson Planner / Quiz Generator / Report Generator).',
    'Write a real brief for something you actually need this week.',
    'Generate the draft.',
    'Apply the review checklist from your training page (facts, level, tone, data).',
    'Fix one thing the AI got wrong, then share: what it saved you, and what it missed.',
  ],
}

export default function WorkshopPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <SiteHeader
        title="Internal AI Workshop (F-029)"
        subtitle="“AI for Everyday Work” — a designed 90-minute workshop. Design artifact — delivery is not claimed."
      />

      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <h2 className="mb-3 font-semibold">Agenda — 90 minutes</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="py-2 pr-4">Time</th>
                <th className="py-2 pr-4">Segment</th>
                <th className="py-2">Content</th>
              </tr>
            </thead>
            <tbody>
              {SEGMENTS.map(([time, seg, desc]) => (
                <tr key={time} className="border-b last:border-0 align-top">
                  <td className="whitespace-nowrap py-2 pr-4 font-mono text-xs text-gray-500">{time}</td>
                  <td className="py-2 pr-4 font-medium">{seg}</td>
                  <td className="py-2 text-gray-600">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <h2 className="mb-2 font-semibold">Hands-on exercise brief</h2>
          <p className="text-sm text-gray-700">{HANDS_ON.task}</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-600">
            {HANDS_ON.steps.map((s) => <li key={s}>{s}</li>)}
          </ol>
        </div>
        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <h2 className="mb-2 font-semibold">Facilitator guide</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-gray-600">
            {FACILITATOR_NOTES.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </div>
      </div>
    </main>
  )
}
