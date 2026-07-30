'use server'

import { cookies } from 'next/headers'
import { isLocale, LOCALE_COOKIE, type Locale } from './config'

/**
 * Persist the chosen language in the NEXT_LOCALE cookie (server-side, so it is
 * set reliably regardless of client cookie constraints). The switcher calls
 * this then router.refresh() to re-render with the new locale/dir while keeping
 * the current page and any in-progress client state.
 */
export async function setLocale(locale: Locale): Promise<void> {
  if (!isLocale(locale)) return
  const cookieStore = await cookies()
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  })
}
