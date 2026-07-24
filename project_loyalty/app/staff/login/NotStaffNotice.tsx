'use client'

import { useState } from 'react'
import { getStaffClient } from '@/lib/supabase/staff-client'

/**
 * Shown on /staff/login when the visitor IS authenticated (a staff-namespace
 * session exists) but has no staff_users row. We never redirect here — that
 * would bounce them straight back from /staff/dashboard and loop. Instead we
 * explain, point customers at their own dashboard, and offer a clean sign-out
 * that clears the staff session so the plain login form returns.
 */
export function NotStaffNotice() {
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    try {
      // Clears the staff_-prefixed cookies via the staff client's storage.
      await getStaffClient().auth.signOut({ scope: 'local' })
    } catch {
      // Session already dead — the cookie removal still ran; fall through.
    }
    window.location.href = '/staff/login'
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="alert"
        className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800"
      >
        This account is not registered as staff for any business. If you’re a
        customer, head to your dashboard. If you think this is a mistake, ask the
        business owner to add your login.
      </div>

      <a
        href="/dashboard"
        className="flex h-12 items-center justify-center rounded-lg bg-gray-900 text-sm font-semibold text-white"
      >
        Go to my customer dashboard
      </a>

      <button
        type="button"
        onClick={handleSignOut}
        disabled={signingOut}
        className="h-12 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 disabled:opacity-60"
      >
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  )
}
