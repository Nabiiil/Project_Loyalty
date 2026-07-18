'use client'

import { useEffect } from 'react'
import { GoogleSignInButton } from './GoogleSignInButton'
import { EmailPhoneOtpForm } from './EmailPhoneOtpForm'

/**
 * Inline signup panel that slides in from the right, over the current screen —
 * no route navigation, so the customer never loses sight of the screen they were
 * on. It only opens on an explicit tap of the Sign up button (controlled by the
 * `open` prop); it is never auto-opened and never interrupts earning. Closing
 * slides it back out (left-to-right), leaving the underlying screen unchanged.
 *
 * The panel stays mounted but parked off-screen (translate-x-full) and
 * non-interactive (pointer-events-none) while closed, which is what makes the
 * open/close slide animate in both directions.
 */
export function SignupDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Escape closes the drawer, matching the backdrop tap.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <div
      className={`fixed inset-0 z-50 overflow-hidden ${open ? '' : 'pointer-events-none'}`}
      aria-hidden={!open}
    >
      {/* Backdrop — dims but keeps the underlying screen (and points) visible. */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Panel — slides in from / out to the right. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create your account"
        className={`absolute inset-y-0 right-0 flex w-[92%] max-w-sm flex-col overflow-y-auto bg-white shadow-xl transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-start justify-between px-5 pt-5">
          <h2 className="text-xl font-semibold tracking-tight text-gray-900">Save your points</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 px-2 text-2xl leading-none text-gray-400"
          >
            ×
          </button>
        </div>
        <p className="px-5 pt-1 text-sm text-gray-500">
          Keep your stamps and see every business in one place. You can keep earning without an
          account.
        </p>

        <div className="flex flex-col gap-5 p-5">
          <GoogleSignInButton />

          <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-gray-400">
            <span className="h-px flex-1 bg-gray-200" />
            or
            <span className="h-px flex-1 bg-gray-200" />
          </div>

          <EmailPhoneOtpForm />

          <p className="text-center text-sm text-gray-400">
            Already have an account?{' '}
            <a href="/login" className="text-gray-900 underline underline-offset-2">
              Sign in
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
