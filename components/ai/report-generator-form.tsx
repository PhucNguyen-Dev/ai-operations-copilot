'use client'

import { useState } from 'react'

type OpsReport = {
  executive_summary: string
  key_metrics: string[]
  problems: string[]
  trends: string[]
  recommendations: string[]
}

const INPUT =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none'

function ReportList({ title, items, numbered }: { title: string; items: string[]; numbered?: boolean }) {
  return (
    <div className="rounded-lg border bg-white p-6">
      <h3 className="mb-3 font-semibold">{title}</h3>
      <ul className={`${numbered ? 'list-decimal' : 'list-disc'} space-y-1.5 pl-5 text-sm text-gray-700`}>
        {items.map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    </div>
  )
}

export default function ReportGeneratorForm() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<OpsReport | null>(null)
  const [meta, setMeta] = useState<{ model: string; durationMs: number; rangeDays: number } | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setReport(null)

    const fd = new FormData(e.currentTarget)
    try {
      const res = await fetch('/api/ai/report-generator', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(fd.entries())),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Report generation failed — try again.')
      } else {
        setReport(json.data as OpsReport)
        const rangeDays = Number(new FormData(e.currentTarget).get('range') ?? 30)
        setMeta({ model: json.model, durationMs: json.durationMs, rangeDays })
      }
    } catch {
      setError('Could not reach the server.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={onSubmit} className="space-y-4 rounded-lg border bg-white p-6">
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="range">Reporting period</label>
          <select id="range" name="range" className={INPUT} defaultValue="30">
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="notes">Manager notes (optional)</label>
          <textarea id="notes" name="notes" rows={3} maxLength={1000} className={INPUT}
            placeholder="Context the report should consider — e.g. 'we ran a promo the last week of August'" />
        </div>
        <button type="submit" disabled={loading}
          className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
          {loading ? 'Writing… (AI call takes a few seconds)' : 'Generate report'}
        </button>
        <p className="text-xs text-gray-400">
          The report is generated from real system aggregates (leads, runs, tasks, emails) — the AI
          writes the narrative; the numbers come from Supabase.
        </p>
      </form>

      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">{error}</div>
        )}
        {report && meta && (
          <p className="text-xs text-gray-400">
            {meta.model} · {(meta.durationMs / 1000).toFixed(1)}s · period: last {meta.rangeDays} days
          </p>
        )}
        {report && (
          <>
            <div className="rounded-lg border bg-white p-6">
              <h3 className="mb-2 font-semibold">Executive summary</h3>
              <p className="text-sm text-gray-700">{report.executive_summary}</p>
            </div>
            <ReportList title="Key metrics" items={report.key_metrics} />
            <ReportList title="Problems" items={report.problems} />
            <ReportList title="Trends" items={report.trends} />
            <ReportList title="Recommendations" items={report.recommendations} numbered />
          </>
        )}
        {!report && !error && (
          <div className="rounded-lg border bg-white p-6 text-sm text-gray-500">
            Pick a period and generate — the report is written from real lead, pipeline-run,
            task, and email counts for that window.
          </div>
        )}
      </div>
    </div>
  )
}
