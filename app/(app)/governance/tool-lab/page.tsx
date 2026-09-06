import { createClient } from '@/lib/supabase/server'
import { requireGovernanceAccess } from '@/lib/auth'
import SiteHeader from '@/components/site-header'

export const dynamic = 'force-dynamic'

type Experiment = {
  id: string
  experiment_date: string
  tool_name: string
  tool_category: string
  business_task: string
  test_definition: string
  output_summary: string
  quality_notes: string | null
  speed_notes: string | null
  cost_notes: string | null
  ease_notes: string | null
  integration_notes: string | null
  limitations: string | null
}

const GRADE_STYLES: Record<string, string> = {
  positive: 'bg-green-100 text-green-800',
  negative: 'bg-red-100 text-red-800',
  neutral: 'bg-gray-100 text-gray-700',
}

export default async function ToolLabPage() {
  await requireGovernanceAccess()
  const supabase = await createClient()
  const { data } = await supabase
    .from('tool_experiments')
    .select('*')
    .order('experiment_date', { ascending: false })

  const experiments = (data ?? []) as Experiment[]
  const flash = experiments.find((e) => e.tool_name === 'gemini-3.5-flash')
  const lite = experiments.find((e) => e.tool_name === 'gemini-3.5-flash-lite')

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <SiteHeader
        title="AI Tool Lab (F-026)"
        subtitle="Real experiments against real department tasks — the raw evidence behind adoption decisions."
      />

      {experiments.length === 0 && (
        <p className="rounded-lg border bg-white p-6 text-sm text-gray-500">
          No experiments recorded yet. Run <code className="rounded bg-gray-100 px-1">node scripts/run-lab-experiments.mjs</code> and seed <code className="rounded bg-gray-100 px-1">supabase/seed_governance.sql</code>.
        </p>
      )}

      {/* Head-to-head comparison when the A/B pair exists */}
      {flash && lite && (
        <div className="mb-8 rounded-lg border bg-white p-6 shadow-sm">
          <h2 className="mb-3 font-semibold">Head-to-head: lead qualification prompt (F-004)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-4">Model</th>
                  <th className="py-2 pr-4">JSON parsed</th>
                  <th className="py-2 pr-4">Schema valid</th>
                  <th className="py-2 pr-4">Category correct</th>
                  <th className="py-2 pr-4">Avg latency</th>
                  <th className="py-2">Verdict</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs">gemini-3.5-flash</td>
                  <td className="py-2 pr-4">5/5</td>
                  <td className="py-2 pr-4">5/5</td>
                  <td className="py-2 pr-4">4/5</td>
                  <td className="py-2 pr-4">3,693 ms</td>
                  <td className="py-2"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${GRADE_STYLES.neutral}`}>strong, slower</span></td>
                </tr>
                <tr className="border-b last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs">gemini-3.5-flash-lite</td>
                  <td className="py-2 pr-4">5/5</td>
                  <td className="py-2 pr-4">5/5</td>
                  <td className="py-2 pr-4">5/5</td>
                  <td className="py-2 pr-4">1,056 ms</td>
                  <td className="py-2"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${GRADE_STYLES.positive}`}>winner — adopted</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-gray-500">
            Same prompt, same 3 rotating real leads, 5 runs each, JSON mode, temperature 0.4. Raw run data: <code className="rounded bg-gray-100 px-1">docs/governance-data/experiments.json</code>.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {experiments.map((e) => {
          const negative = e.tool_name.includes('retired')
          return (
            <article key={e.id} className="rounded-lg border bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">{e.tool_name}</h2>
                <div className="flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-semibold ${negative ? GRADE_STYLES.negative : GRADE_STYLES.positive}`}>
                    {negative ? 'negative result' : 'experiment'}
                  </span>
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs uppercase text-gray-600">{e.tool_category}</span>
                  <span className="text-xs text-gray-400">{e.experiment_date}</span>
                </div>
              </div>
              <p className="mt-2 text-sm text-gray-700"><span className="font-medium">Business task:</span> {e.business_task}</p>
              <p className="mt-1 text-sm text-gray-600">{e.test_definition}</p>
              <p className="mt-2 rounded bg-gray-50 p-3 text-sm">{e.output_summary}</p>
              <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs text-gray-600 sm:grid-cols-2">
                {e.quality_notes && <div><dt className="inline font-medium text-gray-800">Quality: </dt><dd className="inline">{e.quality_notes}</dd></div>}
                {e.speed_notes && <div><dt className="inline font-medium text-gray-800">Speed: </dt><dd className="inline">{e.speed_notes}</dd></div>}
                {e.cost_notes && <div><dt className="inline font-medium text-gray-800">Cost: </dt><dd className="inline">{e.cost_notes}</dd></div>}
                {e.ease_notes && <div><dt className="inline font-medium text-gray-800">Ease of use: </dt><dd className="inline">{e.ease_notes}</dd></div>}
                {e.integration_notes && <div><dt className="inline font-medium text-gray-800">Integration: </dt><dd className="inline">{e.integration_notes}</dd></div>}
                {e.limitations && <div><dt className="inline font-medium text-gray-800">Limitations: </dt><dd className="inline">{e.limitations}</dd></div>}
              </dl>
            </article>
          )
        })}
      </div>
    </main>
  )
}
