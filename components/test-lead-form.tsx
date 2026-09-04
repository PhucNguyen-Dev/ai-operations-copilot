'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Result = {
  accepted: boolean
  lead_id?: string
  run_id?: string
  score?: number
  category?: string
  intent?: string
  summary?: string
  recommended_action?: string
  error?: string
  detail?: string
}

const CATEGORY_STYLES: Record<string, string> = {
  HOT: 'bg-red-100 text-red-700',
  WARM: 'bg-amber-100 text-amber-700',
  COLD: 'bg-sky-100 text-sky-700',
}

const INPUT =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none'

export default function TestLeadForm() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setResult(null)

    const fd = new FormData(e.currentTarget)
    const payload = Object.fromEntries(fd.entries())

    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data: Result = await res.json()
      setResult(data)
      if (data.accepted) router.refresh()
    } catch {
      setResult({ accepted: false, error: 'Could not reach the server' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <form onSubmit={onSubmit} className="space-y-4 rounded-lg border bg-white p-6 shadow-sm">
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="name">Name *</label>
          <input id="name" name="name" className={INPUT} placeholder="Amira Hassan" required />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="email">Email *</label>
            <input id="email" name="email" type="email" className={INPUT} placeholder="student@example.com" required />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="phone">Phone</label>
            <input id="phone" name="phone" className={INPUT} placeholder="+201001234567" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="course_interest">Course interest</label>
            <select id="course_interest" name="course_interest" className={INPUT} defaultValue="">
              <option value="">— none —</option>
              <option value="IELTS">IELTS</option>
              <option value="TOEFL">TOEFL</option>
              <option value="Business English">Business English</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="source">Source</label>
            <select id="source" name="source" className={INPUT} defaultValue="test">
              <option value="test">test</option>
              <option value="facebook_ads">facebook_ads</option>
              <option value="google_ads">google_ads</option>
              <option value="website">website</option>
              <option value="referral">referral</option>
              <option value="partner">partner</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="budget">Budget</label>
            <input id="budget" name="budget" className={INPUT} placeholder="500-1000 USD" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="timeline">Timeline</label>
            <input id="timeline" name="timeline" className={INPUT} placeholder="1 month" />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="message">Message</label>
          <textarea id="message" name="message" rows={4} className={INPUT} placeholder="What the lead wrote..." />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {loading ? 'Pipeline running… (OpenAI call takes a few seconds)' : 'Submit Test Lead'}
        </button>
      </form>

      <div className="space-y-4">
        {result && (
          <div className={`rounded-lg border p-6 shadow-sm ${result.accepted ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
            {result.accepted ? (
              <>
                <p className="mb-3 font-medium text-green-800">✓ Lead accepted by the pipeline</p>
                <div className="mb-3 flex items-center gap-3">
                  {result.category && (
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${CATEGORY_STYLES[result.category]}`}>
                      {result.category}
                    </span>
                  )}
                  <span className="text-2xl font-semibold">{result.score}</span>
                  <span className="text-sm text-gray-500">/ 100 · intent {result.intent}</span>
                </div>
                <p className="mb-2 text-sm text-gray-700">{result.summary}</p>
                <p className="text-sm"><span className="font-medium">Next action:</span> {result.recommended_action}</p>
                <p className="mt-3 text-xs text-gray-400">
                  run {result.run_id?.slice(0, 8)} · lead {result.lead_id?.slice(0, 8)} — persisted to Supabase by n8n
                </p>
              </>
            ) : (
              <>
                <p className="mb-2 font-medium text-red-800">✗ Rejected by the pipeline</p>
                <p className="text-sm text-red-700">{result.error}</p>
                {result.detail && <p className="mt-1 text-xs text-red-500">{result.detail}</p>}
                <p className="mt-3 text-xs text-gray-500">
                  The failed run was recorded in automation_runs — check the dashboard as admin.
                </p>
              </>
            )}
          </div>
        )}

        <div className="rounded-lg border bg-white p-6 text-sm text-gray-600">
          <p className="mb-2 font-medium text-gray-900">What happens on submit</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Next.js checks your session + role, then forwards the payload to the n8n webhook with a shared-secret header</li>
            <li>n8n validates the fields (bad input → rejected + failed run logged)</li>
            <li>OpenAI analyzes the lead and returns strict JSON</li>
            <li>A schema check gate-keeps the AI output (malformed → run fails, nothing persisted)</li>
            <li>Deterministic thresholds turn the score into HOT / WARM / COLD</li>
            <li>Lead + analysis are written to Supabase; every step is logged to automation_runs</li>
          </ol>
        </div>
      </div>
    </div>
  )
}
