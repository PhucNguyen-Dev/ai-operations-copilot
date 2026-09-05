const SEGMENTS: { key: string; label: string; bar: string; dot: string }[] = [
  { key: 'HOT', label: 'HOT', bar: 'bg-red-500', dot: 'bg-red-500' },
  { key: 'WARM', label: 'WARM', bar: 'bg-amber-400', dot: 'bg-amber-400' },
  { key: 'COLD', label: 'COLD', bar: 'bg-sky-500', dot: 'bg-sky-500' },
]

/**
 * Horizontal stacked distribution bar for HOT/WARM/COLD counts.
 * Pure CSS — segment widths are the share of the total. Renders an empty
 * gray track when there is nothing to show.
 */
export default function CategoryBar({
  counts,
}: {
  counts: { HOT: number; WARM: number; COLD: number }
}) {
  const total = counts.HOT + counts.WARM + counts.COLD

  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100" role="img" aria-label={`Lead mix: ${counts.HOT} hot, ${counts.WARM} warm, ${counts.COLD} cold`}>
        {total > 0 &&
          SEGMENTS.map((s) =>
            counts[s.key as keyof typeof counts] > 0 ? (
              <div
                key={s.key}
                className={s.bar}
                style={{ width: `${(counts[s.key as keyof typeof counts] / total) * 100}%` }}
                title={`${s.label}: ${counts[s.key as keyof typeof counts]}`}
              />
            ) : null
          )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
        {SEGMENTS.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${s.dot}`} />
            {s.label} <span className="font-semibold text-gray-900">{counts[s.key as keyof typeof counts]}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
