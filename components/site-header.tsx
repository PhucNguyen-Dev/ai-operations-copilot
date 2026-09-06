import { requireUser } from '@/lib/auth'

/**
 * Slim page header: title + subtitle only. All navigation chrome (sidebar,
 * user chip, sign out) lives in the app shell (app/(app)/layout.tsx).
 */
export default async function SiteHeader({
  title,
  subtitle,
}: {
  title: string
  subtitle?: string
}) {
  await requireUser()

  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold text-[var(--brand-strong)]">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-[var(--ink-3)]">{subtitle}</p>}
    </div>
  )
}
