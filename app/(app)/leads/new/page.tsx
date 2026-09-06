import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import SiteHeader from '@/components/site-header'
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
      <SiteHeader
        title="Test Lead Intake"
        subtitle="Simulates an incoming lead from an external source (F-001) — triggers the n8n pipeline."
      />

      <TestLeadForm />
    </main>
  )
}
