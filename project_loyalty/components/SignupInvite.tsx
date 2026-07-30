'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { SignupDrawer } from './SignupDrawer'
import { useTranslations } from '@/lib/i18n/I18nProvider'

/**
 * Persistent signup affordance shown on every customer screen for
 * un-authenticated (device-token-only) customers, and hidden entirely once a
 * Supabase Auth session exists.
 *
 * It renders as a clear, right-aligned filled button in a slim top bar — an
 * unmistakable button, not a text link. Tapping it opens the SignupDrawer inline
 * (slides in from the right); it never navigates away, so the customer keeps
 * sight of the points they just earned. Earning stamps works fully without an
 * account; this is only an optional invitation, never a gate.
 */
export function SignupInvite() {
  // undefined = still deciding (render nothing); true = show; false = hide.
  const [show, setShow] = useState<boolean | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const t = useTranslations('common')

  useEffect(() => {
    let active = true

    async function decide(): Promise<boolean> {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      )
      // Read the local session (fast, no network). No session => not yet an
      // account => show the invite. Fail open so a motivated customer can convert.
      try {
        const { data } = await supabase.auth.getSession()
        return !data.session
      } catch {
        return true
      }
    }

    decide().then((next) => {
      if (active) setShow(next)
    })

    return () => {
      active = false
    }
  }, [])

  if (!show) return null

  return (
    <>
      <div className="flex items-center justify-end border-b border-gray-100 bg-white px-4 py-2.5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white"
        >
          {t('signUp')}
        </button>
      </div>
      <SignupDrawer open={open} onClose={() => setOpen(false)} />
    </>
  )
}
