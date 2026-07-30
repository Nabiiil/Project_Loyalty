/**
 * Locale configuration — the single place that defines which languages exist.
 *
 * Adding a language later is a drop-in: append one entry here (code, native
 * label, direction) and add a matching `messages/<code>.json`. Nothing in the
 * app hardcodes a three-language assumption — everything derives from this list.
 */
export const localeConfig = [
  { code: 'en', label: 'English', dir: 'ltr' },
  { code: 'fr', label: 'Français', dir: 'ltr' },
  { code: 'ar', label: 'العربية', dir: 'rtl' },
] as const

export type Locale = (typeof localeConfig)[number]['code']
export type Direction = (typeof localeConfig)[number]['dir']

export const locales = localeConfig.map((l) => l.code) as Locale[]

// First-visit fallback when the browser's Accept-Language matches nothing.
export const defaultLocale: Locale = 'fr'

export const LOCALE_COOKIE = 'NEXT_LOCALE'

export function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (locales as string[]).includes(value)
}

export function getDirection(locale: Locale): Direction {
  return localeConfig.find((l) => l.code === locale)?.dir ?? 'ltr'
}

export function getLocaleLabel(locale: Locale): string {
  return localeConfig.find((l) => l.code === locale)?.label ?? locale
}

/**
 * Pick the best supported locale from an Accept-Language header, honoring the
 * quality (q) ordering. Falls back to French (defaultLocale) when nothing
 * matches. Exported for unit testing.
 */
export function matchLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return defaultLocale
  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';')
      const q = params.find((p) => p.trim().startsWith('q='))
      return {
        code: tag.trim().split('-')[0].toLowerCase(),
        q: q ? Number.parseFloat(q.split('=')[1]) || 0 : 1,
      }
    })
    .sort((a, b) => b.q - a.q)

  for (const { code } of ranked) {
    if (isLocale(code)) return code
  }
  return defaultLocale
}
