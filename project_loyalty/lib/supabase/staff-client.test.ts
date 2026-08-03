import { describe, it, expect } from 'vitest'
import {
  parseDocumentCookies,
  toStaffScopedCookies,
  serializeStaffCookie,
} from './staff-client'
import { STAFF_COOKIE_PREFIX, STAFF_AUTH_STORAGE_KEY } from './constants'

describe('staff cookie adapter — parsing', () => {
  it('parses a document.cookie string into decoded name/value pairs', () => {
    expect(parseDocumentCookies('a=1; b=hello%20world')).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: 'hello world' },
    ])
  })

  it('returns nothing for an empty cookie string', () => {
    expect(parseDocumentCookies('')).toEqual([])
  })

  it('keeps only staff-prefixed cookies and strips the prefix', () => {
    const scoped = toStaffScopedCookies([
      { name: 'sb-access-token', value: 'customer' }, // customer namespace — ignored
      { name: `${STAFF_COOKIE_PREFIX}${STAFF_AUTH_STORAGE_KEY}`, value: 'staff-session' },
      { name: `${STAFF_COOKIE_PREFIX}${STAFF_AUTH_STORAGE_KEY}.0`, value: 'chunk0' },
    ])
    expect(scoped).toEqual([
      { name: STAFF_AUTH_STORAGE_KEY, value: 'staff-session' },
      { name: `${STAFF_AUTH_STORAGE_KEY}.0`, value: 'chunk0' },
    ])
  })
})

describe('staff cookie adapter — serializing', () => {
  it('re-adds the staff prefix and applies Path/Max-Age/SameSite/Secure', () => {
    const out = serializeStaffCookie(STAFF_AUTH_STORAGE_KEY, 'v', {
      path: '/',
      maxAge: 3600,
      sameSite: 'lax',
      secure: true,
    })
    expect(out).toBe(`${STAFF_COOKIE_PREFIX}${STAFF_AUTH_STORAGE_KEY}=v; Path=/; Max-Age=3600; SameSite=lax; Secure`)
  })

  it('defaults Path to / when no options are given', () => {
    expect(serializeStaffCookie(STAFF_AUTH_STORAGE_KEY, 'v')).toBe(
      `${STAFF_COOKIE_PREFIX}${STAFF_AUTH_STORAGE_KEY}=v; Path=/`,
    )
  })
})

describe('cookie-format compatibility with @supabase/ssr (the actual bug)', () => {
  // @supabase/ssr persists the session base64url-encoded behind a `base64-`
  // prefix (and chunked). The staff browser client MUST read/write that same
  // shape, or getSession() returns null and staff REST/realtime fall back to
  // the anon key. This is the format the old raw-JSON storage could not read.
  const ssrSessionValue = 'base64-eyJhY2Nlc3NfdG9rZW4iOiJzdGFmZi1qd3QifQ'

  it('round-trips an ssr-format session value through set → get intact', () => {
    // What the browser jar stores is the `name=value` segment of the Set-Cookie.
    const stored = serializeStaffCookie(STAFF_AUTH_STORAGE_KEY, ssrSessionValue).split('; ')[0]

    const scoped = toStaffScopedCookies(parseDocumentCookies(stored))
    expect(scoped).toEqual([{ name: STAFF_AUTH_STORAGE_KEY, value: ssrSessionValue }])
  })

  it('confirms the ssr value is NOT plain JSON — why the old raw-JSON storage broke', () => {
    expect(() => JSON.parse(ssrSessionValue)).toThrow()
  })
})
