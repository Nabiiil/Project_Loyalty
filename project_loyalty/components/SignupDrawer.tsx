'use client'

import { useEffect } from 'react'
import { GoogleSignInButton } from './GoogleSignInButton'
import { EmailPhoneOtpForm } from './EmailPhoneOtpForm'
import { useTranslations } from '@/lib/i18n/I18nProvider'

/**
 * Inline signup panel that slides in from the inline-end edge, over the current
 * screen — no route navigation, so the customer never loses sight of the screen
 * they were on. Under RTL the whole thing mirrors: it anchors to end-0 and parks
 * off-screen toward the end edge (translate-x-full in LTR, -translate-x-full in
 * RTL, since transforms don't auto-flip with dir).
 */
export function SignupDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('customerAuth')
  const tc = useTranslations('common')

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

      {/* Panel — anchored to the inline-end edge; slides in from / out to it. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('drawerAria')}
        className={`absolute inset-y-0 end-0 flex w-[92%] max-w-sm flex-col overflow-y-auto bg-white shadow-xl transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full rtl:-translate-x-full'
        }`}
      >
        <div className="flex items-start justify-between px-5 pt-5">
          <h2 className="text-xl font-semibold tracking-tight text-gray-900">{t('drawerTitle')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={tc('close')}
            className="-me-1 px-2 text-2xl leading-none text-gray-400"
          >
            ×
          </button>
        </div>
        <p className="px-5 pt-1 text-sm text-gray-500">{t('drawerSubtitle')}</p>

        <div className="flex flex-col gap-5 p-5">
          <GoogleSignInButton />

          <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-gray-400">
            <span className="h-px flex-1 bg-gray-200" />
            {tc('or')}
            <span className="h-px flex-1 bg-gray-200" />
          </div>

          <EmailPhoneOtpForm />

          <p className="text-center text-sm text-gray-400">
            {t('haveAccount')}{' '}
            <a href="/login" className="text-gray-900 underline underline-offset-2">
              {tc('signIn')}
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
