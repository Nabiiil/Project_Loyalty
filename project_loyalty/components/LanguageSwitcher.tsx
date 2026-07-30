'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { localeConfig, type Locale } from '@/lib/i18n/config'
import { useLocale } from '@/lib/i18n/I18nProvider'
import { setLocale } from '@/lib/i18n/actions'

/**
 * Dedicated, always-visible language control — a standalone element, never
 * nested in a settings/hamburger menu. Available before any login. Labels each
 * language in its own script (English / Français / العربية), no flags. Switching
 * writes the NEXT_LOCALE cookie and router.refresh()es, which re-renders with
 * the new locale/dir while preserving the current page and in-progress state.
 *
 * Layout uses logical properties (inset-inline-end, text-start…) so it sits in
 * the correct corner under both LTR and RTL automatically.
 */
export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const current = useLocale()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointer(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function choose(locale: Locale) {
    setOpen(false)
    if (locale === current) return
    await setLocale(locale)
    // Soft refresh: re-renders server components with the new locale/dir and
    // keeps client state (forms, generated QR, etc.) intact.
    router.refresh()
  }

  const currentLabel = localeConfig.find((l) => l.code === current)?.label ?? current

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Language"
        className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18"
            stroke="currentColor"
            strokeWidth="1.6"
          />
        </svg>
        <span>{currentLabel}</span>
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Language"
          className="absolute end-0 z-50 mt-1 min-w-40 overflow-hidden rounded-xl border border-gray-100 bg-white py-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
        >
          {localeConfig.map((l) => {
            const active = l.code === current
            return (
              <li key={l.code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => choose(l.code)}
                  dir={l.dir}
                  lang={l.code}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm ${
                    active
                      ? 'font-semibold text-gray-900 dark:text-white'
                      : 'text-gray-600 hover:bg-gray-50 dark:text-zinc-300 dark:hover:bg-zinc-800'
                  }`}
                >
                  <span>{l.label}</span>
                  {active && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M5 12.5l4.5 4.5L19 7"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
