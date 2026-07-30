'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { getStaffClient } from '@/lib/supabase/staff-client'
import { signOutStaff } from '../actions'
import { useTranslations } from '@/lib/i18n/I18nProvider'

type StaffRole = 'owner' | 'staff'

/**
 * Secondary-navigation entries reachable from the hamburger menu. This is the
 * one place to extend as new staff sections land — add a row here and the
 * drawer renders it. ownerOnly entries are hidden from counter staff; the pages
 * behind them re-verify the role server-side regardless. `key` maps to the
 * `staff` translation namespace.
 */
const MENU_ITEMS: { href: string; key: string; ownerOnly?: boolean }[] = [
  { href: '/staff/dashboard/analytics', key: 'analytics', ownerOnly: true },
  { href: '/staff/dashboard/history', key: 'history', ownerOnly: true },
  { href: '/staff/dashboard/settings', key: 'settings', ownerOnly: true },
]

/**
 * Hamburger button + slide-in side navigation for the staff dashboard. The
 * drawer anchors to the inline-start edge and parks off-screen toward it, so it
 * mirrors correctly under RTL (transforms don't auto-flip with dir, hence the
 * rtl: variant on the parked transform).
 */
export function StaffMenu({ name, role }: { name: string | null; role: StaffRole }) {
  const t = useTranslations('staff')
  const tc = useTranslations('common')
  const [open, setOpen] = useState(false)
  const [confirmingSignOut, setConfirmingSignOut] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const pathname = usePathname()

  const items = MENU_ITEMS.filter((item) => !item.ownerOnly || role === 'owner')

  function closeMenu() {
    setOpen(false)
    setConfirmingSignOut(false)
  }

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
        aria-label={t('openMenu')}
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

        {/* Side nav — slides in from the inline-start edge. */}
        <nav
          aria-label={t('menu')}
          className={`absolute inset-y-0 start-0 flex w-72 max-w-[80%] flex-col bg-white p-4 shadow-xl transition-transform duration-300 ease-out dark:bg-zinc-900 ${
            open ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full'
          }`}
        >
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-sm font-semibold tracking-wide text-zinc-500 dark:text-zinc-400">
              {t('menu')}
            </span>
            <button
              type="button"
              onClick={closeMenu}
              aria-label={tc('close')}
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
                {t(item.key)}
              </Link>
            )
          })}

          {/* Signed-in account + sign-out, pinned to the bottom. */}
          <div className="mt-auto flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <div className="flex items-center gap-2 px-1">
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-zinc-500">{t('signedInAs')}</span>
                <span className="block truncate text-base font-medium text-black dark:text-white">
                  {name ?? t('staffMember')}
                </span>
              </span>
              <span
                className={
                  role === 'owner'
                    ? 'rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-semibold text-white dark:bg-white dark:text-black'
                    : 'rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
                }
              >
                {role === 'owner' ? t('roleOwner') : t('roleStaff')}
              </span>
            </div>

            {confirmingSignOut ? (
              <div className="flex flex-col gap-2">
                <p className="px-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  {t('signOutQuestion')}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleSignOut}
                    disabled={signingOut}
                    className="h-12 flex-1 rounded-lg bg-red-600 text-base font-semibold text-white disabled:opacity-60"
                  >
                    {signingOut ? t('signingOut') : t('yesSignOut')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingSignOut(false)}
                    disabled={signingOut}
                    className="h-12 flex-1 rounded-lg border border-zinc-300 text-base font-medium text-zinc-700 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300"
                  >
                    {tc('cancel')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingSignOut(true)}
                className="h-12 rounded-lg border border-red-200 text-base font-medium text-red-600 dark:border-red-900 dark:text-red-400"
              >
                {tc('signOut')}
              </button>
            )}
          </div>
        </nav>
      </div>
    </>
  )
}
