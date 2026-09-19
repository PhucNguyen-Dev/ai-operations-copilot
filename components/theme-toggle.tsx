'use client'
import { useEffect, useRef, useState } from 'react'

/**
 * Theme toggle for the Ask X chat surfaces ONLY.
 *
 * Dark mode is scoped: it flips the `theme-dark` class on this button's
 * nearest `.askx-surface` container (the /agent workspace) — never on
 * <html>. Product pages are built light-only and stay light regardless.
 * Preference key: `askx-theme` ('dark' | 'light'); legacy `theme` key is
 * honored once; default is dark chat.
 */
function prefIsDark(): boolean {
  const stored = localStorage.getItem('askx-theme') ?? localStorage.getItem('theme')
  return stored ? stored === 'dark' : true
}

export default function ThemeToggle() {
  const [dark, setDark] = useState(true)
  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const isDark = prefIsDark()
    ref.current?.closest<HTMLElement>('.askx-surface')?.classList.toggle('theme-dark', isDark)
    setDark(isDark)
  }, [])

  function toggle() {
    const next = !dark
    setDark(next)
    ref.current?.closest<HTMLElement>('.askx-surface')?.classList.toggle('theme-dark', next)
    localStorage.setItem('askx-theme', next ? 'dark' : 'light')
  }

  return (
    <button
      ref={ref}
      type="button"
      aria-label="Toggle Ask X dark mode"
      title="Toggle Ask X dark mode (chat surfaces only)"
      onClick={toggle}
      className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
    >
      {dark ? '☀ Light' : '◐ Dark'}
    </button>
  )
}
