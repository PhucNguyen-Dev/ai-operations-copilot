'use client'

import { useState } from 'react'
import type { LessonPlan } from '@/lib/ai/schemas'

const INPUT =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none'

export default function LessonPlannerForm() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [plan, setPlan] = useState<LessonPlan | null>(null)
  const [meta, setMeta] = useState<{ model: string; durationMs: number } | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setPlan(null)

    const fd = new FormData(e.currentTarget)
    try {
      const res = await fetch('/api/ai/lesson-planner', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(fd.entries())),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Generation failed — try again.')
      } else {
        setPlan(json.data as LessonPlan)
        setMeta({ model: json.model, durationMs: json.durationMs })
      }
    } catch {
      setError('Could not reach the server.')
    } finally {
      setLoading(false)
    }
  }

  const totalMinutes = plan?.sections.reduce((sum, s) => sum + s.minutes, 0) ?? 0

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={onSubmit} className="space-y-4 rounded-lg border bg-white p-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="level">Student level</label>
            <select id="level" name="level" className={INPUT} defaultValue="adult">
              <option value="kids">Kids</option>
              <option value="teen">Teen</option>
              <option value="adult">Adult</option>
              <option value="business">Business</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="duration_minutes">Duration (min)</label>
            <input id="duration_minutes" name="duration_minutes" type="number" min={20} max={180} step={5}
              defaultValue={60} className={INPUT} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="subject">Subject</label>
          <input id="subject" name="subject" maxLength={120} className={INPUT} placeholder="English" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="topic">Topic *</label>
          <input id="topic" name="topic" required maxLength={200} className={INPUT}
            placeholder="Past simple vs present perfect" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="objectives">Your objectives (optional)</label>
          <textarea id="objectives" name="objectives" rows={2} maxLength={500} className={INPUT}
            placeholder="Students should be able to choose the right tense in conversation" />
        </div>
        <button type="submit" disabled={loading}
          className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
          {loading ? 'Planning… (AI call takes a few seconds)' : 'Generate lesson plan'}
        </button>
        <p className="text-xs text-gray-400">Draft plan — adjust timings and activities to your class before teaching.</p>
      </form>

      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">{error}</div>
        )}
        {plan && meta && (
          <p className="text-xs text-gray-400">{meta.model} · {(meta.durationMs / 1000).toFixed(1)}s</p>
        )}
        {plan && (
          <>
            <div className="rounded-lg border bg-white p-6">
              <h2 className="font-semibold">{plan.title}</h2>
              <p className="mt-1 text-xs text-gray-400">
                {plan.sections.length} sections · {totalMinutes} min total
              </p>
              <h3 className="mt-4 mb-2 text-sm font-medium text-gray-700">Objectives</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
                {plan.objectives.map((o, i) => <li key={i}>{o}</li>)}
              </ul>
            </div>
            <div className="rounded-lg border bg-white p-6">
              <h3 className="mb-3 font-semibold">Sections</h3>
              <ol className="space-y-3">
                {plan.sections.map((s, i) => (
                  <li key={i} className="rounded border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{s.title}</p>
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{s.minutes} min</span>
                    </div>
                    <p className="mt-1 text-sm text-gray-600">{s.description}</p>
                  </li>
                ))}
              </ol>
            </div>
            <div className="rounded-lg border bg-white p-6">
              <h3 className="mb-2 font-semibold">Materials</h3>
              {plan.materials.length ? (
                <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
                  {plan.materials.map((m, i) => <li key={i}>{m}</li>)}
                </ul>
              ) : (
                <p className="text-sm text-gray-500">No special materials needed.</p>
              )}
              <h3 className="mt-4 mb-2 font-semibold">Homework</h3>
              <p className="text-sm text-gray-700">{plan.homework}</p>
            </div>
          </>
        )}
        {!plan && !error && (
          <div className="rounded-lg border bg-white p-6 text-sm text-gray-500">
            Enter a topic and duration — you&apos;ll get objectives, time-boxed sections,
            materials, and homework. Edit freely before class.
          </div>
        )}
      </div>
    </div>
  )
}
