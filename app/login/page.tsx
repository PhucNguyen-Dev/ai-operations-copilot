'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const DEMO_ACCOUNTS = [
  ['admin@demo.dev', 'Admin — sees everything'],
  ['operations@demo.dev', 'Ops — leads + automation runs'],
  ['counselor@demo.dev', 'Counselor — only assigned leads'],
  ['marketing@demo.dev', 'Marketing — no leads (RLS)'],
  ['teacher@demo.dev', 'Teacher — no leads (RLS)'],
] as const

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('admin@demo.dev')
  const [password, setPassword] = useState('demo1234')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/')
      router.refresh()
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="mb-1 text-2xl font-semibold">AI Operations Copilot</h1>
      <p className="mb-6 text-sm text-gray-500">Phase 2 — database &amp; RLS verification</p>

      <form onSubmit={onSubmit} className="space-y-4 rounded-lg border bg-white p-6 shadow-sm">
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            required
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <div className="mt-6 rounded-lg border bg-white p-4 text-sm">
        <p className="mb-2 font-medium">Demo accounts (password: demo1234)</p>
        <ul className="space-y-1 text-gray-600">
          {DEMO_ACCOUNTS.map(([mail, note]) => (
            <li key={mail}>
              <button
                onClick={() => { setEmail(mail); setPassword('demo1234') }}
                className="text-left text-blue-600 hover:underline"
              >
                {mail}
              </button>{' '}
              — {note}
            </li>
          ))}
        </ul>
      </div>
    </main>
  )
}
