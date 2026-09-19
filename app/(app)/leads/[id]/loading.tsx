/**
 * Route-level skeleton for lead detail (App Router): renders instantly on
 * navigation while the server streams the real page — removes the "dead
 * click" feel caused by the ~700ms server render with no visual feedback.
 */
export default function LeadDetailLoading() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10" aria-busy="true" aria-label="Loading lead">
      <div className="mb-3 h-3 w-40 animate-pulse rounded bg-gray-200" />
      <div className="mb-8 h-8 w-72 animate-pulse rounded bg-gray-200" />

      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <section key={i} className="rounded-lg border bg-white p-6">
            <div className="mb-4 h-4 w-32 animate-pulse rounded bg-gray-200" />
            <div className="grid grid-cols-2 gap-4">
              {Array.from({ length: 6 }).map((_, j) => (
                <div key={j}>
                  <div className="mb-1.5 h-2.5 w-16 animate-pulse rounded bg-gray-100" />
                  <div className="h-3.5 w-28 animate-pulse rounded bg-gray-200" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}
