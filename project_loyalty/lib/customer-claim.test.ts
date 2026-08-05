import { describe, it, expect } from 'vitest'
import {
  buildOAuthRedirectTo,
  resolveDeviceToken,
  decideClaimAction,
  shouldRetireDeviceToken,
  DEVICE_TOKEN_QUERY_PARAM,
  DEVICE_TOKEN_MAX_AGE,
  RETIRED_DEVICE_TOKEN_COOKIE,
} from './customer-claim'

describe('decideClaimAction — anonymous identity is never orphaned', () => {
  it('anonymous scan → Google signup: links the EXISTING anon row, never inserts', () => {
    // The reported bug: a fresh phone scanned twice (anon customer with stamps),
    // then signed up with Google. If we insert a new row here the stamps are
    // orphaned. The rule: link the auth identity onto the anonymous row in place.
    const action = decideClaimAction({ authCustomerId: null, anonCustomerId: 'anon-1' })
    expect(action).toEqual({ kind: 'link-anon-in-place', anonCustomerId: 'anon-1' })
  })

  it('no prior identity → inserts a fresh customer (direct signup, no scans)', () => {
    expect(decideClaimAction({ authCustomerId: null, anonCustomerId: null })).toEqual({
      kind: 'insert-new',
    })
  })

  it('returning login with no anonymous stamps → no-op on the existing account', () => {
    expect(decideClaimAction({ authCustomerId: 'auth-1', anonCustomerId: null })).toEqual({
      kind: 'noop-existing',
      authCustomerId: 'auth-1',
    })
  })

  it('returning customer on a new-to-them device (both rows exist) → merges anon into claimed', () => {
    expect(decideClaimAction({ authCustomerId: 'auth-1', anonCustomerId: 'anon-2' })).toEqual({
      kind: 'merge-into-existing',
      authCustomerId: 'auth-1',
      anonCustomerId: 'anon-2',
    })
  })

  it('does not merge a row into itself when the ids coincide', () => {
    expect(decideClaimAction({ authCustomerId: 'same', anonCustomerId: 'same' })).toEqual({
      kind: 'noop-existing',
      authCustomerId: 'same',
    })
  })
})

describe('device-token carry-through across the OAuth round-trip', () => {
  it('appends the device token to the OAuth redirect target when present', () => {
    const url = new URL(buildOAuthRedirectTo('https://app.example.com', 'dt-abc'))
    expect(url.origin).toBe('https://app.example.com')
    expect(url.pathname).toBe('/auth/callback')
    expect(url.searchParams.get(DEVICE_TOKEN_QUERY_PARAM)).toBe('dt-abc')
  })

  it('omits the query param when there is no anonymous token to preserve', () => {
    const url = new URL(buildOAuthRedirectTo('https://app.example.com', null))
    expect(url.pathname).toBe('/auth/callback')
    expect(url.searchParams.has(DEVICE_TOKEN_QUERY_PARAM)).toBe(false)
  })

  it('prefers the browser cookie, but falls back to the carried value when the cookie was dropped', () => {
    // Cookie survived the round-trip.
    expect(resolveDeviceToken({ cookieValue: 'dt-cookie', queryValue: 'dt-carried' })).toBe('dt-cookie')
    // Google bounce dropped the cookie — only the carried value remains. This is
    // what keeps the anon row findable so its stamps are preserved.
    expect(resolveDeviceToken({ cookieValue: null, queryValue: 'dt-carried' })).toBe('dt-carried')
    expect(resolveDeviceToken({ cookieValue: undefined, queryValue: undefined })).toBeNull()
  })
})

describe('retiring the device token after the claim', () => {
  it('retires the token once the claim has landed on the account', () => {
    // The browser is authenticated now and has no use for an anonymous
    // identity; leaving the cookie behind is what allows a later scan or reload
    // to re-read an identity whose stamps were already transferred.
    expect(shouldRetireDeviceToken({ hasDeviceToken: true, claimSucceeded: true })).toBe(true)
  })

  it('KEEPS the token when the claim failed — never clear before the stamps land', () => {
    // The invariant that makes the merge safe in both directions: stamps are
    // never removed from the device before they are safely on the account. If
    // the transfer failed, the cookie is the only pointer left to those stamps,
    // so it must survive for the next sign-in to retry.
    expect(shouldRetireDeviceToken({ hasDeviceToken: true, claimSucceeded: false })).toBe(false)
  })

  it('has nothing to retire when the browser carried no token', () => {
    expect(shouldRetireDeviceToken({ hasDeviceToken: false, claimSucceeded: true })).toBe(false)
    expect(shouldRetireDeviceToken({ hasDeviceToken: false, claimSucceeded: false })).toBe(false)
  })

  it('expires the cookie on the same path/attributes it was written with', () => {
    // A Set-Cookie whose path differs does not replace the original — it adds a
    // second, empty cookie and leaves the live one readable. Both maxAge and
    // expires are sent because old WebViews honour only one of the two.
    expect(RETIRED_DEVICE_TOKEN_COOKIE.path).toBe('/')
    expect(RETIRED_DEVICE_TOKEN_COOKIE.sameSite).toBe('lax')
    expect(RETIRED_DEVICE_TOKEN_COOKIE.httpOnly).toBe(false)
    expect(RETIRED_DEVICE_TOKEN_COOKIE.maxAge).toBe(0)
    expect(RETIRED_DEVICE_TOKEN_COOKIE.expires.getTime()).toBe(0)
    // And it must actually expire it, not renew it.
    expect(RETIRED_DEVICE_TOKEN_COOKIE.maxAge).not.toBe(DEVICE_TOKEN_MAX_AGE)
  })
})
