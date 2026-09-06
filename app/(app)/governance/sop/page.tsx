import SiteHeader from '@/components/site-header'

export const dynamic = 'force-dynamic'

type Sop = { title: string; audience: string; purpose: string; steps: string[]; escalation: string }
const SOPS: Sop[] = [
  {
    title: 'AI Usage Guidelines',
    audience: 'All staff',
    purpose: 'The baseline rules for using any AI feature in this system.',
    steps: [
      'AI output is draft material. You are the reviewer and the owner of whatever you send, publish, or teach.',
      'Never paste real student personal data into prompts beyond what the tool already has access to.',
      'Use the department tools provided here before external AI websites — these tools log usage and enforce review steps.',
      'If an AI tool errors, retry once; if it fails again, report it (see Troubleshooting) instead of working around it with unapproved tools.',
      'When in doubt whether a use is appropriate, ask Operations before doing it.',
    ],
    escalation: 'Questions → Operations Manager. Suspected data exposure → immediately report to Admin.',
  },
  {
    title: 'AI Prompt Guide',
    audience: 'All staff',
    purpose: 'How to write briefs that produce usable first drafts.',
    steps: [
      'Give context: who the audience is and what the output is for.',
      'Give format: the exact structure you expect (the tools do this for you — keep the form fields meaningful).',
      'Give constraints: tone, length, level, what to avoid.',
      'Iterate: if the draft is off, fix the brief rather than accepting a weak draft.',
      'Reuse: save prompts that worked in the training page template for your department.',
    ],
    escalation: 'Prompt patterns that consistently fail → report to Operations for the prompt template of that tool update.',
  },
  {
    title: 'AI Lead Handling SOP',
    audience: 'Admissions counselors',
    purpose: 'What to do when the pipeline delivers a qualified lead.',
    steps: [
      'Check notifications (dashboard bell) — new HOT/WARM leads create a task with a due time.',
      'Read the AI analysis: score, category, intent, summary, recommended action.',
      'Work HOT leads first; the recommended action includes the contact SLA (e.g., "within 30 minutes").',
      'Before contacting, open the lead detail: verify the analysis against the actual message of the lead.',
      'If the category is clearly wrong, update the lead status and report the misclassification — the thresholds and prompts are tunable.',
    ],
    escalation: 'Pipeline down or runs failing → Operations (Automation Logs viewer). Repeated misclassification → Operations/Admin.',
  },
  {
    title: 'AI Response Review SOP',
    audience: 'Admissions counselors',
    purpose: 'Reviewing AI-drafted first-touch emails before they represent the company.',
    steps: [
      'Automated sends are logged in sent_emails (marked dry_run in local/demo mode) — read what was sent on your leads.',
      'For drafts you edit: check course names, prices, and schedule claims against the catalog — the AI can state them plausibly and wrongly.',
      'Personalize at least one detail from the message of the lead.',
      'Tone check: friendly and specific; remove any promise the school has not made.',
      'Never remove the review step "because it looked right" — looking right is what review is for.',
    ],
    escalation: 'Wrong information already sent → correct with the lead and inform Operations for the log.',
  },
  {
    title: 'AI Automation User Guide',
    audience: 'Operations, Admin',
    purpose: 'Understanding and operating the automated Admissions pipeline.',
    steps: [
      'The pipeline: webhook → validation → AI analysis → schema gate → scoring → CRM → email → task → notification → logging.',
      'Every run is recorded in Automation Logs (/runs): status, per-step timings, AI output snapshot, errors.',
      'success = all rows written; failed = a structured failure record with the failing step and reason; nothing is silently dropped.',
      'Transient errors (API timeouts) retry automatically ×3–4 with backoff; permanent errors (validation, schema, bad key) never retry.',
      'Email sending is dry-run by default (GMAIL_DRY_RUN=true); real sends require wiring Gmail credentials and flipping the flag.',
    ],
    escalation: 'Unhandled failures appear via the error-handler workflow as failed runs with "Unhandled error at" — investigate in the n8n execution view.',
  },
  {
    title: 'AI Troubleshooting Guide',
    audience: 'All staff',
    purpose: 'What to do when AI tools misbehave. Sourced from real incidents: see docs/dev-fix-log.md.',
    steps: [
      '"The AI service is unreachable or busy" → wait a minute and retry (rate limit). If it persists for an hour, report: the daily model quota may be exhausted.',
      '"The AI service is misconfigured" → do not retry; the server key or model is wrong. Admin must check the env config.',
      'Tool returned something off-format → retry once, then report with a screenshot.',
      'Lead pipeline run failed → open /runs, read the failed step and error detail; validation failures explain themselves (e.g., phone format).',
      'Everything else → screenshot + what you clicked + what you expected, to Operations.',
    ],
    escalation: 'Known incidents and root causes are documented in docs/dev-fix-log.md — check it before filing a new issue.',
  },
  {
    title: 'AI Data Privacy Guidelines',
    audience: 'All staff',
    purpose: 'Keeping personal data out of places it should not be.',
    steps: [
      'All data in this system is synthetic (demo). If this system ever holds real student data: never paste it into external AI tools.',
      'The pipeline sends lead data to the AI provider for analysis — that is the designed, logged path. Ad-hoc tools are not.',
      'Access is role-scoped (RLS): you only see data your role allows. Do not screenshot and share data pages.',
      'Email is transport-only: sent content is recorded in sent_emails; do not delete log rows to "clean up".',
      'No customer data in bug reports — describe the shape of the problem, not the person.',
    ],
    escalation: 'Suspected exposure of real personal data → Admin immediately. This prototype claims no security certification.',
  },
]

export default function SopPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <SiteHeader
        title="Internal AI Documentation / SOP (F-030)"
        subtitle="Written internal guidance for using and reviewing AI output — consistent, auditable, and sourced from real incidents."
      />
      <div className="space-y-6">
        {SOPS.map((s) => (
          <section key={s.title} className="rounded-lg border bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">{s.title}</h2>
              <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">Audience: {s.audience}</span>
            </div>
            <p className="mt-1 text-sm text-gray-600">{s.purpose}</p>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-gray-700">
              {s.steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
            <p className="mt-3 rounded border-l-4 border-gray-900 bg-gray-50 p-3 text-sm">
              <span className="font-medium">Escalation:</span> {s.escalation}
            </p>
          </section>
        ))}
      </div>
    </main>
  )
}
