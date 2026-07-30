import type { Locale } from './config'

/**
 * Formatting helpers that ALWAYS render Western digits (0-9), in every locale
 * including Arabic — the Moroccan audience expects Latin numerals with MAD even
 * in the Arabic UI. Forcing the `-u-nu-latn` unicode extension on the locale is
 * what pins the numbering system; month/label text still localizes normally.
 */
function latn(locale: Locale): string {
  return `${locale}-u-nu-latn`
}

/** Money — Western digits + "MAD", e.g. "12.50 MAD". */
export function formatAmount(value: number, locale: Locale): string {
  const n = new Intl.NumberFormat(latn(locale), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
  return `${n} MAD`
}

/** Plain number in Western digits (counts, stats). */
export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(latn(locale)).format(value)
}

/** Date + time, Western digits, localized month/weekday text. */
export function formatDateTime(value: string | number | Date, locale: Locale): string {
  return new Intl.DateTimeFormat(latn(locale), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

/** Date only, Western digits. */
export function formatDate(value: string | number | Date, locale: Locale): string {
  return new Intl.DateTimeFormat(latn(locale), { dateStyle: 'medium' }).format(new Date(value))
}

/** Time only (hh:mm), Western digits. */
export function formatTime(value: string | number | Date, locale: Locale): string {
  return new Intl.DateTimeFormat(latn(locale), { timeStyle: 'short' }).format(new Date(value))
}
