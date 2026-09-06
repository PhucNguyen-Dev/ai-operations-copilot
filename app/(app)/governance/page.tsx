import { createClient } from '@/lib/supabase/server'
import { requireGovernanceAccess } from '@/lib/auth'
import SiteHeader from '@/components/site-header'

export const dynamic = 'force-dynamic'

const CARD = 'rounded-lg border bg-white p-6 shadow-sm hover:shadow-md transition-shadow'

export default async function GovernanceHub() {
  await requireGovernanceAccess()
  const supabase = await createClient()
  const [{ count: expCount }, { count: evalCount }] = await Promise.all([
    supabase.from('tool_experiments').select('id', { count: 'exact', head: true }),
    supabase.from('tool_evaluations').select('id', { count: 'exact', head: true }),
  ])

  const items = [
    {
      href: '/governance/tool-lab',
      title: 'AI Tool Lab (F-026)',
      desc: 'Hands-on experiments with AI tools against real department tasks: the test, the raw results, what we learned.',
      stat: `${expCount ?? 0} recorded experiment${(expCount ?? 0) === 1 ? '' : 's'}`,
    },
    {
      href: '/governance/tool-evaluation',
      title: 'AI Tool Evaluation (F-027)',
      desc: 'Structured adoption decisions: tools scored 1–5 on eight criteria, with recommendation and rationale.',
      stat: `${evalCount ?? 0} documented decision${(evalCount ?? 0) === 1 ? '' : 's'}`,
    },
    {
      href: '/governance/training',
      title: 'Employee AI Training (F-028)',
      desc: 'Designed per-department training programs: objectives, exercises, prompt templates, and human-review rules.',
      stat: '4 departments',
    },
    {
      href: '/governance/workshop',
      title: 'Internal AI Workshop (F-029)',
      desc: '“AI for Everyday Work” — a designed 90-minute workshop agenda with facilitator guide and hands-on exercise.',
      stat: '90-minute agenda',
    },
    {
      href: '/governance/sop',
      title: 'AI Documentation / SOP (F-030)',
      desc: 'Internal guidance: usage guidelines, prompt guide, lead handling, response review, automation, troubleshooting, privacy.',
      stat: '7 SOPs',
    },
  ]

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <SiteHeader
        title="AI Governance"
        subtitle="How this organization evaluates, adopts, and trains people to use AI responsibly."
      />
      <div className="grid gap-4">
        {items.map((it) => (
          <a key={it.href} href={it.href} className={CARD}>
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-semibold">{it.title}</h2>
              <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{it.stat}</span>
            </div>
            <p className="mt-1 text-sm text-gray-600">{it.desc}</p>
          </a>
        ))}
      </div>
    </main>
  )
}
