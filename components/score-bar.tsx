const CATEGORY_COLOR: Record<string, string> = {
  HOT: 'bg-red-500',
  WARM: 'bg-amber-400',
  COLD: 'bg-sky-500',
}

/**
 * 0-100 score as a colored progress bar (pure CSS). Color follows the
 * lead category; falls back to gray for unknown categories.
 */
export default function ScoreBar({
  score,
  category,
}: {
  score: number
  category: string
}) {
  const clamped = Math.max(0, Math.min(100, score))
  const color = CATEGORY_COLOR[category] ?? 'bg-gray-400'

  return (
    <div className="flex items-center gap-3">
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100" role="img" aria-label={`Score ${score} out of 100`}>
        <div className={`h-full ${color}`} style={{ width: `${clamped}%` }} />
      </div>
      <span className="text-2xl font-semibold tabular-nums">{score}</span>
    </div>
  )
}
