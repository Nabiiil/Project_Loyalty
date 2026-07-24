'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { getStaffClient } from '@/lib/supabase/staff-client'
import { signOutStaff } from '../actions'

type StaffRole = 'owner' | 'staff'

/**
 * Secondary-navigation entries reachable from the hamburger menu. This is the
 * one place to extend as new staff sections land (analytics, staff management,
 * etc.) — add a row here and the drawer renders it, no other changes needed.
 * ownerOnly entries are hidden from counter staff; the pages behind them
 * re-verify the role server-side regardless.
 */
const MENU_ITEMS: { href: string; label: string; ownerOnly?: boolean }[] = [
  { href: '/staff/dashboard/analytics', label: 'Analytics', ownerOnly: true },
  { href: '/staff/dashboard/history', label: 'History', ownerOnly: true },
  { href: '/staff/dashboard/settings', label: 'Settings', ownerOnly: true },
]

/**
 * Hamburger button + slide-in side navigation for the staff dashboard. Kept
 * separate from the primary New transaction / Verify reward tabs: those are the
 * high-frequency actions, this menu holds secondary sections plus the
 * signed-in account and sign-out (available to every role).
 */
export function StaffMenu({ name, role }: { name: string | null; role: StaffRole }) {
  const [open, setOpen] = useState(false)
  const [confirmingSignOut, setConfirmingSignOut] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const pathname = usePathname()

  const items = MENU_ITEMS.filter(item => !item.ownerOnly || role === 'owner')

  // Closing the drawer also resets the sign-out confirm, so reopening always
  // starts back at the plain Sign out button.
  function closeMenu() {
    setOpen(false)
    setConfirmingSignOut(false)
  }

  // Escape closes the menu, matching the backdrop tap.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        setConfirmingSignOut(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  async function handleSignOut() {
    setSigningOut(true)
    // Two halves, deliberately in this order: first the browser client (clears
    // its in-memory session so autoRefreshToken can't re-write the cookies it
    // is about to lose), then the server action (clears the staff_ auth
    // cookies on the response via @supabase/ssr and redirects to /staff/login).
    try {
      await getStaffClient().auth.signOut({ scope: 'local' })
    } catch {
      // Session already dead — the server half still clears cookies + redirects.
    }
    await signOutStaff()
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-200 text-black dark:border-zinc-700 dark:text-white"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      <div
        className={`fixed inset-0 z-50 overflow-hidden ${open ? '' : 'pointer-events-none'}`}
        aria-hidden={!open}
      >
        {/* Backdrop */}
        <div
          onClick={closeMenu}
          className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ${
            open ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {/* Side nav — slides in from the left. */}
        <nav
          aria-label="Staff menu"
          className={`absolute inset-y-0 left-0 flex w-72 max-w-[80%] flex-col bg-white p-4 shadow-xl transition-transform duration-300 ease-out dark:bg-zinc-900 ${
            open ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-sm font-semibold tracking-wide text-zinc-500 dark:text-zinc-400">
              Menu
            </span>
            <button
              type="button"
              onClick={closeMenu}
              aria-label="Close menu"
              className="px-2 text-2xl leading-none text-zinc-400"
            >
              ×
            </button>
          </div>

          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeMenu}
                aria-current={active ? 'page' : undefined}
                className={
                  active
                    ? 'rounded-lg bg-zinc-900 px-3 py-3 text-base font-semibold text-white dark:bg-white dark:text-black'
                    : 'rounded-lg px-3 py-3 text-base font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                }
              >
                {item.label}
              </Link>
            )
          })}

          {/* Signed-in account + sign-out. Pinned to the bottom, visually
              separated — on a shared counter tablet, showing WHO is signed in
              right above the sign-out button avoids ending the wrong session. */}
          <div className="mt-auto flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <div className="flex items-center gap-2 px-1">
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-zinc-500">Signed in as</span>
                <span className="block truncate text-base font-medium text-black dark:text-white">
                  {name ?? 'Staff member'}
                </span>
              </span>
              <span
                className={
                  role === 'owner'
                    ? 'rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-semibold text-white dark:bg-white dark:text-black'
                    : 'rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
                }
              >
                {role}
              </span>
            </div>

            {confirmingSignOut ? (
              <div className="flex flex-col gap-2">
                <p className="px-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Sign out?
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleSignOut}
                    disabled={signingOut}
                    className="h-12 flex-1 rounded-lg bg-red-600 text-base font-semibold text-white disabled:opacity-60"
                  >
                    {signingOut ? 'Signing out…' : 'Yes, sign out'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingSignOut(false)}
                    disabled={signingOut}
                    className="h-12 flex-1 rounded-lg border border-zinc-300 text-base font-medium text-zinc-700 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingSignOut(true)}
                className="h-12 rounded-lg border border-red-200 text-base font-medium text-red-600 dark:border-red-900 dark:text-red-400"
              >
                Sign out
              </button>
            )}
          </div>
        </nav>
      </div>
    </>
  )
}
