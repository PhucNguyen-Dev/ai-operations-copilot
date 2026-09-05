/**
 * Shared "you cannot see this" screen for role-gated pages. Cosmetic
 * defense-in-depth: the database (RLS) enforces the real policy.
 */
export default function NotAllowed({ role, what }: { role: string; what: string }) {
  return (
    <main className="mx-auto max-w-xl px-6 py-16 text-center">
      <h1 className="text-xl font-semibold">Not allowed</h1>
      <p className="mt-2 text-sm text-gray-500">
        {what} is restricted to Operations managers and admins (your role: {role}).
      </p>
      <a href="/" className="mt-4 inline-block rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100">
        Back to dashboard
      </a>
    </main>
  )
}
