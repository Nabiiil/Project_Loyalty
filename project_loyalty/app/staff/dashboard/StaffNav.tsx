'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/staff/dashboard', label: 'New transaction' },
  { href: '/staff/dashboard/verify', label: 'Verify reward' },
] as const

/**
 * Top-level switch between the two staff screens. Kept as two large, clearly
 * separated tap targets on purpose: New transaction and Verify reward are
 * deliberately distinct actions so staff don't pick the wrong one under pressure.
 */
export function StaffNav() {
  const pathname = usePathname()

  return (
    <nav aria-label="Staff actions" className="grid grid-cols-2 gap-2">
      {TABS.map((tab) => {
        const active = pathname === tab.href
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={
              active
                ? 'flex h-14 items-center justify-center rounded-lg bg-black text-base font-semibold text-white dark:bg-white dark:text-black'
                : 'flex h-14 items-center justify-center rounded-lg border border-zinc-300 text-base font-semibold text-zinc-700 dark:border-zinc-700 dark:text-zinc-300'
            }
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
