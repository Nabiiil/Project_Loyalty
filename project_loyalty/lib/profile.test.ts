import { describe, it, expect } from 'vitest'
import {
  normalizeDisplayName,
  displayNameFromOAuthMetadata,
  DISPLAY_NAME_MAX_LENGTH,
} from './profile'

describe('normalizeDisplayName — blank is null, never an empty string', () => {
  it('treats every flavour of blank as absent', () => {
    // The invariant the DB constraint also enforces: one representation of
    // "not filled in", so no reader has to check for both null and ''.
    for (const blank of ['', '   ', '\t', '\n', '  \n\t  ']) {
      expect(normalizeDisplayName(blank), JSON.stringify(blank)).toEqual({ ok: true, value: null })
    }
  })

  it('treats a missing field as absent rather than throwing', () => {
    // A form that never rendered the input sends nothing at all.
    expect(normalizeDisplayName(null)).toEqual({ ok: true, value: null })
    expect(normalizeDisplayName(undefined)).toEqual({ ok: true, value: null })
  })

  it('clearing a previously set name stores null', () => {
    expect(normalizeDisplayName('   ')).toEqual({ ok: true, value: null })
  })
})

describe('normalizeDisplayName — whitespace handling', () => {
  it('trims the padding autofill and copy-paste leave behind', () => {
    expect(normalizeDisplayName('  Nabil  ')).toEqual({ ok: true, value: 'Nabil' })
  })

  it('collapses internal runs so a pasted newline cannot break the layout', () => {
    expect(normalizeDisplayName('Nabil   Bou')).toEqual({ ok: true, value: 'Nabil Bou' })
    expect(normalizeDisplayName('Nabil\nBou')).toEqual({ ok: true, value: 'Nabil Bou' })
    expect(normalizeDisplayName('Nabil\t\tBou')).toEqual({ ok: true, value: 'Nabil Bou' })
  })

  it('leaves a single ordinary space alone', () => {
    expect(normalizeDisplayName('Nabil Bou')).toEqual({ ok: true, value: 'Nabil Bou' })
  })

  it('produces a value the DB constraint accepts (trimmed, non-empty)', () => {
    // The constraint requires display_name = btrim(display_name), so anything
    // this returns must already satisfy it.
    for (const input of ['  Nabil  ', 'Nabil\nBou', '\tAmina\t']) {
      const result = normalizeDisplayName(input)
      expect(result.ok).toBe(true)
      if (result.ok && result.value !== null) {
        expect(result.value).toBe(result.value.trim())
        expect(result.value.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('normalizeDisplayName — length cap', () => {
  it('accepts a name exactly at the cap', () => {
    const atCap = 'a'.repeat(DISPLAY_NAME_MAX_LENGTH)
    expect(normalizeDisplayName(atCap)).toEqual({ ok: true, value: atCap })
  })

  it('rejects one character over the cap', () => {
    expect(normalizeDisplayName('a'.repeat(DISPLAY_NAME_MAX_LENGTH + 1))).toEqual({
      ok: false,
      error: 'too_long',
    })
  })

  it('measures AFTER normalising, so padding alone never trips the cap', () => {
    const padded = `   ${'a'.repeat(DISPLAY_NAME_MAX_LENGTH)}   `
    expect(normalizeDisplayName(padded).ok).toBe(true)
  })

  it('counts characters the way Postgres does, not UTF-16 units', () => {
    // Each emoji is 2 units in JS but 1 char to char_length(). Counting JS
    // units here would reject a name the database would accept.
    const emojiName = '🎉'.repeat(DISPLAY_NAME_MAX_LENGTH)
    expect(emojiName.length).toBeGreaterThan(DISPLAY_NAME_MAX_LENGTH) // JS disagrees
    expect(normalizeDisplayName(emojiName)).toEqual({ ok: true, value: emojiName })
  })
})

describe('normalizeDisplayName — permissive about what a name is', () => {
  it('accepts names in every script the app supports', () => {
    for (const name of ['Nabil', 'Amina Benali', 'نبيل', 'Zoë', "O'Brien", 'Jean-Luc']) {
      expect(normalizeDisplayName(name), name).toEqual({ ok: true, value: name })
    }
  })

  it('does not try to police punctuation or casing in a self-chosen name', () => {
    expect(normalizeDisplayName('nabil ☕')).toEqual({ ok: true, value: 'nabil ☕' })
  })
})

describe('displayNameFromOAuthMetadata — Google prefill', () => {
  it('takes the full name Google supplies', () => {
    expect(displayNameFromOAuthMetadata({ full_name: 'Nabil Bouras', name: 'Nabil Bouras' })).toBe(
      'Nabil Bouras',
    )
  })

  it('falls back through the fields in order of preference', () => {
    expect(displayNameFromOAuthMetadata({ name: 'Nabil Bouras' })).toBe('Nabil Bouras')
    expect(displayNameFromOAuthMetadata({ given_name: 'Nabil' })).toBe('Nabil')
  })

  it('normalises exactly like a hand-typed name', () => {
    // Must satisfy the DB shape constraint (trimmed, collapsed, non-empty).
    expect(displayNameFromOAuthMetadata({ full_name: '  Nabil   Bouras \n' })).toBe('Nabil Bouras')
  })

  it('stores NOTHING rather than a truncated name when the value is too long', () => {
    // The requirement: never a truncated or malformed value. With no shorter
    // field to fall back to, the answer is null.
    expect(displayNameFromOAuthMetadata({ full_name: 'a'.repeat(61) })).toBeNull()
  })

  it('prefers a shorter legitimate field over discarding the name entirely', () => {
    // given_name is what Google itself calls the first name — not a truncation.
    expect(
      displayNameFromOAuthMetadata({ full_name: 'a'.repeat(61), given_name: 'Nabil' }),
    ).toBe('Nabil')
  })

  it('returns null for an identity that carries no usable name', () => {
    expect(displayNameFromOAuthMetadata(null)).toBeNull()
    expect(displayNameFromOAuthMetadata(undefined)).toBeNull()
    expect(displayNameFromOAuthMetadata({})).toBeNull()
    expect(displayNameFromOAuthMetadata({ full_name: '   ' })).toBeNull()
    // Email/phone OTP signups have no name in the payload at all — this is the
    // case that decides whether the post-signup prompt is shown.
    expect(displayNameFromOAuthMetadata({ email: 'nabil@example.com' })).toBeNull()
  })

  it('ignores non-string values instead of coercing them', () => {
    expect(displayNameFromOAuthMetadata({ full_name: 42 })).toBeNull()
    expect(displayNameFromOAuthMetadata({ full_name: { given: 'Nabil' } })).toBeNull()
    expect(displayNameFromOAuthMetadata({ full_name: null, given_name: 'Nabil' })).toBe('Nabil')
  })
})
