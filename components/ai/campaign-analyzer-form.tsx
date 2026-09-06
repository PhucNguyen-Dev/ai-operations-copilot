'use client'

import { useState } from 'react'

type CampaignInsights = {
  summary: string
  strong_segments: string[]
  weak_segments: string[]
  trends: string[]
  recommendations: string[]
}

const INPUT =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none'

const SAMPLE = `date,impressions,clicks,conversions,spend
2026-08-25,12400,310,18,85
2026-08-26,13100,342,21,85
2026-08-27,9800,198,7,85
2026-08-28,15200,401,26,95
2026-08-29,14800,377,19,95`

function InsightList({ title, items, tone }: { title: string; items: string[]; tone: 'good' | 'bad' | 'neutral' }) {
  const color = tone === 'good' ? 'text-green-700' : tone === 'bad' ? 'text-red-700' : 'text-gray-900'
  return (
    <div className="rounded-lg border bg-white p-6">
      <h3 className={`mb-3 font-semibold ${color}`}>{title}</h3>
      <ul className="list-decimal space-y-1.5 pl-5 text-sm text-gray-700">
        {items.map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    </div>
  )
}

export function CampaignAnalyzerForm() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [insights, setInsights] = useState<CampaignInsights | null>(null)
  const [meta, setMeta] = useState<{ model: string; durationMs: number } | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setInsights(null)

    const fd = new FormData(e.currentTarget)
    try {
      const res = await fetch('/api/ai/campaign-analyzer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(fd.entries())),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Analysis failed — try again.')
      } else {
        setInsights(json.data as CampaignInsights)
        setMeta({ model: json.model, durationMs: json.durationMs })
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
          <label className="mb-1 block text-sm font-medium" htmlFor="campaign_name">Campaign name</label>
          <input id="campaign_name" name="campaign_name" maxLength={200} className={INPUT}
            placeholder="IELTS September push — Facebook" />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-sm font-medium" htmlFor="metrics">Metrics (CSV or text) *</label>
            <button type="button" onClick={() => {
              const el = document.getElementById('metrics') as HTMLTextAreaElement | null
              if (el) el.value = SAMPLE
            }} className="text-xs text-gray-500 underline hover:text-gray-700">
              insert sample
            </button>
          </div>
          <textarea id="metrics" name="metrics" rows={9} required maxLength={20000} className={`${INPUT} font-mono text-xs`}
            placeholder={'date,impressions,clicks,conversions,spend\n2026-08-25,12400,310,18,85\n...'} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="notes">Notes (optional)</label>
          <input id="notes" name="notes" maxLength={1000} className={INPUT}
            placeholder="Budget doubled on 08-28; creative B replaced A on 08-27" />
        </div>
        <button type="submit" disabled={loading}
          className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
          {loading ? 'Analyzing… (AI call takes a few seconds)' : 'Analyze campaign'}
        </button>
        <p className="text-xs text-gray-400">
          Metrics stay in your browser and are sent only for this analysis; analysis is a draft for your review.
        </p>
      </form>

      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
            {error}
          </div>
        )}
        {insights && meta && (
          <p className="text-xs text-gray-400">{meta.model} · {(meta.durationMs / 1000).toFixed(1)}s</p>
        )}
        {insights && (
          <>
            <div className="rounded-lg border bg-white p-6">
              <h3 className="mb-2 font-semibold">Summary</h3>
              <p className="text-sm text-gray-700">{insights.summary}</p>
            </div>
            <InsightList title="What worked" items={insights.strong_segments} tone="good" />
            <InsightList title="What underperformed" items={insights.weak_segments} tone="bad" />
            <InsightList title="Trends" items={insights.trends} tone="neutral" />
            <InsightList title="Recommended next actions" items={insights.recommendations} tone="neutral" />
          </>
        )}
        {!insights && !error && (
          <div className="rounded-lg border bg-white p-6 text-sm text-gray-500">
            Paste metrics from your ad platform (CSV export or copied rows) and analyze —
            you&apos;ll get a summary, strong/weak segments, trends, and recommended actions.
          </div>
        )}
      </div>
    </div>
  )
}
