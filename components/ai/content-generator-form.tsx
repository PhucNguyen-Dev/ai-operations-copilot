'use client'

import { useState } from 'react'

type ContentDraft = {
  headlines: string[]
  ad_copy: string
  ctas: string[]
}

const INPUT =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none'

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100"
    >
      {copied ? '✓ copied' : label}
    </button>
  )
}

export default function ContentGeneratorForm() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<ContentDraft | null>(null)
  const [meta, setMeta] = useState<{ model: string; durationMs: number; cached?: boolean } | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setDraft(null)

    const fd = new FormData(e.currentTarget)
    try {
      const res = await fetch('/api/ai/content-generator', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(fd.entries())),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Generation failed — try again.')
      } else {
        setDraft(json.data as ContentDraft)
        setMeta({ model: json.model, durationMs: json.durationMs, cached: json.cached })
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
          <label className="mb-1 block text-sm font-medium" htmlFor="campaign">Campaign *</label>
          <input id="campaign" name="campaign" required maxLength={300} className={INPUT}
            placeholder="IELTS intensive course — September enrollment push" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="audience">Target audience</label>
          <input id="audience" name="audience" maxLength={200} className={INPUT}
            placeholder="University students needing IELTS 6.5+ within 2 months" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="platform">Platform</label>
            <select id="platform" name="platform" className={INPUT} defaultValue="facebook">
              <option value="facebook">Facebook</option>
              <option value="instagram">Instagram</option>
              <option value="tiktok">TikTok</option>
              <option value="google">Google Ads</option>
              <option value="website">Website</option>
              <option value="print">Print</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="tone">Tone</label>
            <select id="tone" name="tone" className={INPUT} defaultValue="friendly">
              <option value="professional">Professional</option>
              <option value="friendly">Friendly</option>
              <option value="urgent">Urgent</option>
              <option value="playful">Playful</option>
              <option value="inspirational">Inspirational</option>
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="objective">Objective</label>
          <input id="objective" name="objective" maxLength={300} className={INPUT}
            placeholder="Drive sign-ups for a free placement test" />
        </div>
        <button type="submit" disabled={loading}
          className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
          {loading ? 'Generating… (AI call takes a few seconds)' : 'Generate draft copy'}
        </button>
        <p className="text-xs text-gray-400">
          Output is AI-assisted draft material — review before using anywhere.
        </p>
      </form>

      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
            {error}
          </div>
        )}

        {draft && (
          <>
            {meta && (
              <p className="text-xs text-gray-400">
                {meta.model} · {(meta.durationMs / 1000).toFixed(1)}s{meta.cached && ' · cached'}
              </p>
            )}
            <div className="rounded-lg border bg-white p-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold">Headlines</h2>
                <CopyButton text={draft.headlines.join('\n')} label="copy all" />
              </div>
              <ul className="space-y-2">
                {draft.headlines.map((h, i) => (
                  <li key={i} className="flex items-start justify-between gap-2 rounded border p-2 text-sm">
                    <span>{h}</span>
                    <CopyButton text={h} label="copy" />
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-lg border bg-white p-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold">Ad copy</h2>
                <CopyButton text={draft.ad_copy} label="copy" />
              </div>
              <p className="whitespace-pre-wrap text-sm text-gray-700">{draft.ad_copy}</p>
            </div>

            <div className="rounded-lg border bg-white p-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold">CTAs</h2>
                <CopyButton text={draft.ctas.join('\n')} label="copy all" />
              </div>
              <ul className="space-y-2">
                {draft.ctas.map((c, i) => (
                  <li key={i} className="flex items-start justify-between gap-2 rounded border p-2 text-sm">
                    <span>{c}</span>
                    <CopyButton text={c} label="copy" />
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}

        {!draft && !error && (
          <div className="rounded-lg border bg-white p-6 text-sm text-gray-500">
            Fill the brief and generate — you&apos;ll get 3-5 headlines, ready ad copy, and
            CTA variations. Nothing is published automatically; copy what you like.
          </div>
        )}
      </div>
    </div>
  )
}
