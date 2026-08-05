import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { locales } from './config'

/**
 * Guards the invariant createTranslator relies on: every key exists in every
 * locale. A missing key does not crash — it renders the dotted path itself
 * ("scan.stale.newCta") straight onto the screen, which is the kind of thing
 * that ships unnoticed in a language nobody on the team reads.
 *
 * Driven by `locales` rather than a hardcoded list, so adding a language to
 * config.ts puts its file under test automatically.
 */

type Json = Record<string, unknown>

function load(locale: string): Json {
  const path = fileURLToPath(new URL(`../../messages/${locale}.json`, import.meta.url))
  return JSON.parse(readFileSync(path, 'utf8')) as Json
}

/** Every leaf key, flattened to the dotted paths the translator resolves. */
function leafKeys(obj: Json, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return value && typeof value === 'object' && !Array.isArray(value)
      ? leafKeys(value as Json, path)
      : [path]
  })
}

function leafValue(obj: Json, path: string): string | undefined {
  const found = path.split('.').reduce<unknown>(
    (acc, part) => (acc && typeof acc === 'object' ? (acc as Json)[part] : undefined),
    obj,
  )
  return typeof found === 'string' ? found : undefined
}

/** `{name}` placeholders, matching the translator's own interpolation regex. */
function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
}

const messages = Object.fromEntries(locales.map((l) => [l, load(l)]))
const referenceKeys = leafKeys(messages.en).sort()

describe('message files stay at full key parity', () => {
  it('has more than one locale to compare (guards a vacuous pass)', () => {
    expect(locales.length).toBeGreaterThan(1)
    expect(referenceKeys.length).toBeGreaterThan(0)
  })

  for (const locale of locales.filter((l) => l !== 'en')) {
    it(`${locale} defines exactly the keys en defines`, () => {
      const keys = leafKeys(messages[locale]).sort()
      // Reported as set differences so a failure names the offending keys
      // instead of dumping several hundred lines of array diff.
      expect(referenceKeys.filter((k) => !keys.includes(k))).toEqual([])
      expect(keys.filter((k) => !referenceKeys.includes(k))).toEqual([])
    })

    it(`${locale} keeps the same {placeholders} as en`, () => {
      // A translation that drops {business} or {count} renders a sentence with
      // a hole in it — worse than an untranslated string, and invisible to a
      // key-parity check on its own.
      const mismatched = referenceKeys
        .map((key) => ({
          key,
          en: placeholders(leafValue(messages.en, key) ?? ''),
          translated: placeholders(leafValue(messages[locale], key) ?? ''),
        }))
        .filter(({ en, translated }) => en.join() !== translated.join())

      expect(mismatched).toEqual([])
    })
  }
})

describe('the stale-scan screen is fully translated', () => {
  // The screen this was added for: both branches (recognized / newcomer) render
  // entirely from these keys, so a gap here is a blank or dotted-path UI.
  const staleKeys = [
    'expiredTitle',
    'usedTitle',
    'askStaff',
    'yourCardAt',
    'viewMyPoints',
    'newHeading',
    'newBody',
    'newAskStaff',
    'newCta',
  ]

  for (const locale of locales) {
    it(`${locale} has non-empty copy for every stale-scan string`, () => {
      for (const key of staleKeys) {
        const value = leafValue(messages[locale], `scan.stale.${key}`)
        expect(value, `${locale}: scan.stale.${key}`).toBeTruthy()
        expect(value!.trim().length, `${locale}: scan.stale.${key}`).toBeGreaterThan(0)
      }
    })
  }

  it('interpolates the business name into the progress heading', () => {
    for (const locale of locales) {
      expect(placeholders(leafValue(messages[locale], 'scan.stale.yourCardAt')!)).toEqual([
        'business',
      ])
    }
  })
})
