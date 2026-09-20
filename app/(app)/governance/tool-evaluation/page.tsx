import { createClient } from '@/lib/supabase/server'
import { requireGovernanceAccess } from '@/lib/auth'
import SiteHeader from '@/components/site-header'

export const dynamic = 'force-dynamic'

type Evaluation = {
  id: string
  tool_name: string
  use_case: string
  scores: Record<string, number>
  total_score: number
  recommendation: string
  rationale: string
  strengths: string[]
  weaknesses: string[]
}

const CRITERIA: [string, string][] = [
  ['quality', 'Output Quality'],
  ['accuracy', 'Accuracy'],
  ['cost', 'Cost'],
  ['speed', 'Speed'],
  ['ease', 'Ease of Use'],
  ['integration', 'Integration'],
  ['privacy', 'Security / Privacy'],
  ['scalability', 'Scalability'],
]

const RECO_STYLES: Record<string, string> = {
  recommended: 'bg-green-100 text-green-800',
  conditional: 'bg-amber-100 text-amber-800',
  not_recommended: 'bg-red-100 text-red-800',
}

export default async function ToolEvaluationPage() {
  await requireGovernanceAccess()
  const supabase = await createClient()
  const { data } = await supabase
    .from('tool_evaluations')
    .select('*')
    .order('created_at', { ascending: false })

  const evaluations = (data ?? []) as Evaluation[]

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <SiteHeader
        title="AI Tool Evaluation (F-027)"
        subtitle="Structured adoption decisions — each tool scored 1–5 on eight criteria, with a documented recommendation."
      />

      {evaluations.length === 0 && (
        <p className="rounded-lg border bg-white p-6 text-sm text-gray-500">
          No adoption decisions recorded yet. Document one in <code className="rounded bg-gray-100 px-1">supabase/seed_governance.sql</code> after running the experiments in the <a href="/governance/tool-lab" className="font-medium text-gray-800 underline">AI Tool Lab</a> — the lab&apos;s raw evidence feeds this evaluation.
        </p>
      )}

      <div className="space-y-6">
        {evaluations.map((ev) => (
          <article key={ev.id} className="rounded-lg border bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">{ev.tool_name}</h2>
              <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${RECO_STYLES[ev.recommendation] ?? "bg-gray-100 text-gray-700"}`}>
                {ev.recommendation.replace('_', ' ')}
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-600">{ev.use_case}</p>

            <div className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2">
              {CRITERIA.map(([key, label]) => {
                const score = ev.scores?.[key] ?? 0
                return (
                  <div key={key} className="flex items-center gap-3 text-sm">
                    <span className="w-40 shrink-0 text-gray-700">{label}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded bg-gray-100">
                      <div className="h-full rounded bg-gray-900" style={{ width: `${(score / 5) * 100}%` }} />
                    </div>
                    <span className="w-8 text-right font-mono text-xs text-gray-600">{score}/5</span>
                  </div>
                )
              })}
            </div>

            <p className="mt-4 text-sm"><span className="font-medium">Total: {ev.total_score} / 40</span></p>

            <div className="mt-3 rounded bg-gray-50 p-4 text-sm text-gray-700">
              <p className="mb-1 font-medium text-gray-900">Rationale</p>
              {ev.rationale}
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-green-700">Strengths</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-600">
                  {(ev.strengths ?? []).map((s) => <li key={s}>{s}</li>)}
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Weaknesses</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-600">
                  {(ev.weaknesses ?? []).map((w) => <li key={w}>{w}</li>)}
                </ul>
              </div>
            </div>
          </article>
        ))}
      </div>
    </main>
  )
}
