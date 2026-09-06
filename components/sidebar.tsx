'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import LogoutButton from '@/components/logout-button'

export type SidebarIconName =
  | 'grid' | 'pencil' | 'chart' | 'book' | 'quiz' | 'doc' | 'layers' | 'gauge' | 'plus' | 'shield'

export type SidebarGroup = {
  label: string
  items: { href: string; label: string; icon: SidebarIconName }[]
}

/** 16×16 stroke icons (Lucide-style paths), inherit color via currentColor. */
const ICONS: Record<SidebarIconName, ReactNode> = {
  grid: (
    <>
      <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" />
      <rect x="9" y="1.5" width="5.5" height="5.5" rx="1" />
      <rect x="1.5" y="9" width="5.5" height="5.5" rx="1" />
      <rect x="9" y="9" width="5.5" height="5.5" rx="1" />
    </>
  ),
  pencil: (
    <>
      <path d="M11.5 2.2 13.8 4.5 5.3 13 2.5 13.5 3 10.7z" />
      <path d="m10 3.7 2.3 2.3" />
    </>
  ),
  chart: (
    <>
      <path d="M14 8A6 6 0 1 1 8 2" />
      <path d="M8 2v6h6" />
    </>
  ),
  book: (
    <>
      <path d="M4 2h8.5a.5.5 0 0 1 .5.5V13a1 1 0 0 1-1 1H4.5A2.5 2.5 0 0 1 2 11.5v-7A2.5 2.5 0 0 1 4 2z" />
      <path d="M2 11.5A2.5 2.5 0 0 1 4.5 9H13" />
    </>
  ),
  quiz: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M6.2 6.2a1.9 1.9 0 0 1 3.7.6c0 1.2-1.9 1.6-1.9 2.7" />
      <path d="M8 11.6h.01" />
    </>
  ),
  doc: (
    <>
      <path d="M4 1.8h5.5L13 5.3v8.2a.7.7 0 0 1-.7.7H4a.7.7 0 0 1-.7-.7V2.5a.7.7 0 0 1 .7-.7z" />
      <path d="M9.3 1.8v3.5H13" />
      <path d="M5.6 8.2h4.8M5.6 10.8h4.8" />
    </>
  ),
  layers: (
    <>
      <path d="m8 1.8 6 3-6 3-6-3z" />
      <path d="m2 8 6 3 6-3" />
      <path d="m2 11.2 6 3 6-3" />
    </>
  ),
  gauge: (
    <>
      <path d="M2.5 12.5a6.5 6.5 0 1 1 11 0" />
      <path d="m8 8.5 3-3" />
      <circle cx="8" cy="9" r="0.6" />
    </>
  ),
  plus: <path d="M8 2.5v11M2.5 8h11" />,
  shield: (
    <>
      <path d="M8 1.8 13.5 4v4.2c0 3.2-2.4 5.4-5.5 6.2-3.1-.8-5.5-3-5.5-6.2V4z" />
      <path d="m5.8 7.9 1.6 1.6 2.8-2.9" />
    </>
  ),
}

function Icon({ name }: { name: SidebarIconName }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="w-4 shrink-0"
    >
      {ICONS[name]}
    </svg>
  )
}

/**
 * Fixed left sidebar — the "work software" chrome. Sticky (its own scroll),
 * collapses to an icon rail, hidden below lg where pages rely on their own
 * top spacing. Active route is highlighted via usePathname.
 */
export default function Sidebar({
  groups,
  fullName,
  role,
}: {
  groups: SidebarGroup[]
  fullName: string
  role: string
}) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-[var(--border)] shrink-0">
        <span
          className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg bg-[var(--brand)] text-[13px] font-extrabold text-white"
          aria-hidden
        >
          AC
        </span>
        {!collapsed && (
          <span className="truncate text-[13px] font-bold text-[var(--brand-strong)]">
            AI Operations Copilot
          </span>
        )}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="ml-auto rounded p-1 text-[var(--ink-4)] hover:bg-slate-100 hover:text-[var(--ink-2)]"
          title={collapsed ? 'Expand menu' : 'Collapse menu'}
          aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
          aria-expanded={!collapsed}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      <nav className="flex-1 pb-3" aria-label="Main navigation">
        {groups.map((group) => (
          <div key={group.label}>
            <div className="sidebar-group-label">{group.label}</div>
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`sidebar-link ${isActive(item.href) ? 'active' : ''}`}
                title={item.label}
              >
                <Icon name={item.icon} />
                <span className="txt">{item.label}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-[var(--border)] px-3 py-3">
        {!collapsed && (
          <div className="mb-2 flex items-center gap-2 px-1">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-[var(--ink)]">{fullName}</p>
              <p className="text-[11px] text-[var(--ink-3)]">{role}</p>
            </div>
          </div>
        )}
        <LogoutButton />
      </div>
    </aside>
  )
}
