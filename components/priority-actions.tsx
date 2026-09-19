// =============================================================
// Priority Actions — the operational queue at the top of the lead
// dashboard. The server page provides the ranked items (overdue
// follow-up → unactioned HOT → score); this renders them in the
// existing card/badge visual language. The AI's recommended action
// is shown VERBATIM — this component never invents copy.
// =============================================================

export type PriorityItem = {
  leadId: string
  name: string
  category: string | null
  score: number | null
  signal: string | null
  missing: string[]
  recommendedAction: string | null
  overdueDueAt: string | null
}

function overdueLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  return days <= 0 ? 'overdue today' : `overdue ${days}d`
}

export default function PriorityActions({ items }: { items: PriorityItem[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.leadId} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 rounded-lg border border-gray-200 p-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <a href={`/leads/${item.leadId}`} className="font-medium text-[var(--brand)] hover:underline">
                {item.name}
              </a>
              {item.category ? (
                <span className={`badge badge-${item.category.toLowerCase()}`}>{item.category}</span>
              ) : (
                <span className="badge badge-neutral">not analyzed</span>
              )}
              {item.score != null && <span className="text-xs font-semibold text-gray-600">{item.score}</span>}
              {item.signal && <span className="text-xs text-gray-500">{item.signal}</span>}
              {item.overdueDueAt && (
                <span className="badge badge-hot">{overdueLabel(item.overdueDueAt)}</span>
              )}
            </div>
            <p className="mt-1 text-xs text-gray-600">
              {item.recommendedAction
                ? <>AI recommendation: <span className="font-medium text-gray-800">{item.recommendedAction}</span></>
                : item.missing.length > 0
                  ? <span className="text-amber-600">⚠ {item.missing.join(' · ')}</span>
                  : 'No AI recommendation recorded'}
            </p>
          </div>
          <a href={`/leads/${item.leadId}`} className="self-center whitespace-nowrap text-xs font-semibold text-[var(--brand)] hover:underline">
            Review lead →
          </a>
        </li>
      ))}
    </ul>
  )
}
