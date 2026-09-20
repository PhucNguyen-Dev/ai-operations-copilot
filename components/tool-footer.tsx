import Link from 'next/link'

/**
 * Footer for the single-purpose AI tool pages (F-020–F-024): every
 * output on these pages is a draft, and the department's training
 * program holds the review checklist for it. Links there so the
 * review step is one click away — honest for every role that can
 * reach these tools (Ask X is not: it is admissions/admin only).
 */
export default function ToolFooter({ department }: { department: string }) {
  return (
    <p className="mt-6 text-sm text-[var(--ink-3)]">
      Every output here is a draft. The review checklist for {department} work lives in{' '}
      <Link href="/governance/training" className="font-medium text-[var(--brand-strong)] hover:underline">
        your department&apos;s AI training program
      </Link>
      .
    </p>
  )
}
