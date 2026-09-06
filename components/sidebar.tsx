'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import LogoutButton from '@/components/logout-button'

export type SidebarGroup = {
  label: string
  items: { href: string; label: string; icon: string }[]
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
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      <nav className="flex-1 pb-3">
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
                <span aria-hidden className="w-4 text-center text-[13px]">{item.icon}</span>
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
