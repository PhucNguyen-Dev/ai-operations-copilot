import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import LogoutButton from '@/components/logout-button'
import TestLeadForm from '@/components/test-lead-form'

export default async function NewLeadPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const role = (user.app_metadata as Record<string, string> | undefined)?.role
  if (role !== 'admissions' && role !== 'admin') {
    return (
      <main className="mx-auto max-w-xl px-6 py-16 text-center">
        <h1 className="text-xl font-semibold">Not allowed</h1>
        <p className="mt-2 text-sm text-gray-500">
          Only Admissions counselors and admins can submit test leads (your role: {role}).
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Test Lead Intake</h1>
          <p className="mt-1 text-sm text-gray-500">
            Simulates an incoming lead from an external source (F-001) — triggers the n8n pipeline.
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/" className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100">
            Dashboard
          </a>
          <LogoutButton />
        </div>
      </div>

      <TestLeadForm />
    </main>
  )
}
