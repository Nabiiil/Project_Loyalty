import 'server-only'
import { cookies, headers } from 'next/headers'
import { isLocale, matchLocale, LOCALE_COOKIE, type Locale } from './config'
import { createTranslator, type Messages } from './translate'

// Dynamic import keeps locales drop-in: adding messages/<code>.json is enough,
// no loader map to update. Relative (not @/…) path, resolved server-side.
async function loadMessages(locale: Locale): Promise<Messages> {
  return (await import(`../../messages/${locale}.json`)).default as Messages
}

/**
 * Resolve the active locale for this request: an explicit saved choice
 * (NEXT_LOCALE cookie) wins; otherwise detect from Accept-Language, falling back
 * to French. Reading cookies/headers makes consuming routes dynamic — expected
 * for a fully localized app.
 */
export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies()
  const saved = cookieStore.get(LOCALE_COOKIE)?.value
  if (isLocale(saved)) return saved

  const headerList = await headers()
  return matchLocale(headerList.get('accept-language'))
}

export async function getMessages(): Promise<{ locale: Locale; messages: Messages }> {
  const locale = await getLocale()
  const messages = await loadMessages(locale)
  return { locale, messages }
}

/** Server-component translator: `const t = await getTranslations('namespace')`. */
export async function getTranslations(namespace?: string) {
  const { messages } = await getMessages()
  return createTranslator(messages, namespace)
}
