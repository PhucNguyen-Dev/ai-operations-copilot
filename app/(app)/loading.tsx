export default function Loading() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 animate-pulse">
        <div className="h-7 w-64 rounded bg-slate-200" />
        <div className="mt-2 h-4 w-96 rounded bg-slate-100" />
      </div>
      <div className="mb-4 grid grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="animate-pulse rounded-lg border bg-white p-4">
            <div className="h-7 w-12 rounded bg-slate-200" />
            <div className="mt-2 h-3.5 w-32 rounded bg-slate-100" />
          </div>
        ))}
      </div>
      <div className="animate-pulse rounded-lg border bg-white p-4">
        <div className="mb-3 h-4 w-48 rounded bg-slate-100" />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="mb-2 h-10 rounded bg-slate-100" />
        ))}
      </div>
    </main>
  )
}
