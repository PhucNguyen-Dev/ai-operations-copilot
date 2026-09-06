'use client'

import { useState } from 'react'
import type { Quiz } from '@/lib/ai/schemas'

const INPUT =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none'

function QuestionCard({ q, index }: { q: Quiz['questions'][number]; index: number }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <li className="rounded border p-3">
      <p className="text-sm font-medium">{index + 1}. {q.question}</p>
      <ol className="mt-2 space-y-1 text-sm text-gray-700">
        {q.options.map((opt, i) => (
          <li key={i} className={revealed && i === q.answer_index ? 'font-semibold text-green-700' : ''}>
            {String.fromCharCode(65 + i)}. {opt}
          </li>
        ))}
      </ol>
      <button type="button" onClick={() => setRevealed((v) => !v)}
        className="mt-2 text-xs text-gray-500 underline hover:text-gray-700">
        {revealed ? 'hide answer' : 'show answer'}
      </button>
      {revealed && (
        <p className="mt-1 rounded bg-green-50 p-2 text-xs text-green-800">
          Answer: {String.fromCharCode(65 + q.answer_index)} — {q.explanation}
        </p>
      )}
    </li>
  )
}

export default function QuizGeneratorForm() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [meta, setMeta] = useState<{ model: string; durationMs: number } | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setQuiz(null)

    const fd = new FormData(e.currentTarget)
    try {
      const res = await fetch('/api/ai/quiz-generator', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(fd.entries())),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Generation failed — try again.')
      } else {
        setQuiz(json.data as Quiz)
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
          <label className="mb-1 block text-sm font-medium" htmlFor="topic">Topic *</label>
          <input id="topic" name="topic" required maxLength={200} className={INPUT}
            placeholder="Present perfect vs past simple" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="difficulty">Difficulty</label>
            <select id="difficulty" name="difficulty" className={INPUT} defaultValue="medium">
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="count">Questions (3-15)</label>
            <input id="count" name="count" type="number" min={3} max={15} defaultValue={5} className={INPUT} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="source">Source content (optional)</label>
          <textarea id="source" name="source" rows={4} maxLength={2000} className={`${INPUT} text-sm`}
            placeholder="Paste a text the quiz should be based on…" />
        </div>
        <button type="submit" disabled={loading}
          className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
          {loading ? 'Writing… (AI call takes a few seconds)' : 'Generate quiz'}
        </button>
        <p className="text-xs text-gray-400">Review every question and answer before using with students.</p>
      </form>

      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">{error}</div>
        )}
        {quiz && meta && (
          <p className="text-xs text-gray-400">{meta.model} · {(meta.durationMs / 1000).toFixed(1)}s</p>
        )}
        {quiz && (
          <div className="rounded-lg border bg-white p-6">
            <h2 className="font-semibold">{quiz.title}</h2>
            <p className="mt-1 text-xs text-gray-400">{quiz.questions.length} questions · answers hidden until revealed</p>
            <ol className="mt-4 space-y-3">
              {quiz.questions.map((q, i) => <QuestionCard key={i} q={q} index={i} />)}
            </ol>
          </div>
        )}
        {!quiz && !error && (
          <div className="rounded-lg border bg-white p-6 text-sm text-gray-500">
            Enter a topic (and optionally source content) — you&apos;ll get multiple-choice
            questions with answers and explanations, hidden until you reveal them.
          </div>
        )}
      </div>
    </div>
  )
}
