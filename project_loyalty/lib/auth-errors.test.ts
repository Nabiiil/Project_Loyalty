import { describe, it, expect } from 'vitest'
import {
  checkEmail,
  isSubmittableEmail,
  shouldShowEmailError,
  mapAuthError,
  offersSignup,
  signupHrefForEmail,
  type AuthContext,
} from './auth-errors'

const SIGN_IN_SEND: AuthContext = { flow: 'sign-in', channel: 'email', stage: 'send' }
const SIGN_IN_VERIFY: AuthContext = { flow: 'sign-in', channel: 'email', stage: 'verify' }
const SIGN_UP_SEND: AuthContext = { flow: 'sign-up', channel: 'email', stage: 'send' }
const PHONE_SEND: AuthContext = { flow: 'sign-up', channel: 'phone', stage: 'send' }

describe('checkEmail — rejects the obviously broken, accepts the merely unusual', () => {
  it('rejects the four shapes the field error is meant to catch', () => {
    expect(checkEmail('nabil.example.com')).toBe('malformed') // no @
    expect(checkEmail('nabil@')).toBe('malformed') // no domain
    expect(checkEmail('nabil@example')).toBe('malformed') // no TLD
    expect(checkEmail('na bil@example.com')).toBe('malformed') // whitespace
  })

  it('treats an untouched field as empty, not as an error', () => {
    // Distinct from `malformed` so the UI can stay quiet until there is
    // something to correct.
    expect(checkEmail('')).toBe('empty')
    expect(checkEmail('   ')).toBe('empty')
  })

  it('accepts legitimate addresses that a stricter regex would wrongly reject', () => {
    // The permissiveness requirement: each of these is deliverable, and each is
    // the kind of address a "clever" validator throws away.
    for (const address of [
      'nabil@example.com',
      'nabil+loyalty@example.com', // plus-addressing
      'na.bil@example.co.uk', // dotted local part, multi-label TLD
      "o'brien@example.com", // apostrophe
      'nabil_2026@sub.domain.example.museum', // long TLD, subdomain
      'nabil@café.ma', // non-ASCII domain
      'n@a.io', // minimal but valid
    ]) {
      expect(checkEmail(address), address).toBe('ok')
    }
  })

  it('tolerates surrounding whitespace from a paste or autofill', () => {
    expect(checkEmail('  nabil@example.com  ')).toBe('ok')
  })

  it('rejects the malformed shapes a naive regex lets through', () => {
    expect(checkEmail('nabil@@example.com')).toBe('malformed')
    expect(checkEmail('nabil@.com')).toBe('malformed')
    expect(checkEmail('nabil@example..com')).toBe('malformed')
    expect(checkEmail('nabil@example.c')).toBe('malformed') // 1-char TLD
    expect(checkEmail('@example.com')).toBe('malformed')
    expect(checkEmail(`${'a'.repeat(250)}@example.com`)).toBe('malformed') // over length
  })
})

describe('submit guard and field-error timing', () => {
  it('only allows submit once the address is plausible', () => {
    expect(isSubmittableEmail('nabil@example.com')).toBe(true)
    expect(isSubmittableEmail('nabil@example')).toBe(false)
    expect(isSubmittableEmail('')).toBe(false)
  })

  it('stays quiet until the field has been touched', () => {
    // Nagging someone mid-keystroke is the accusatory tone we are avoiding.
    expect(shouldShowEmailError('nab', false)).toBe(false)
    expect(shouldShowEmailError('nab', true)).toBe(true)
  })

  it('never shows the format error for an empty field', () => {
    // "Required" is the submit guard's job; a blank field is not a typo.
    expect(shouldShowEmailError('', true)).toBe(false)
  })
})

describe('mapAuthError — no provider text ever reaches the customer', () => {
  it('maps the reported bug: signing in with an unknown email', () => {
    // The exact error that used to render verbatim on the sign-in page.
    expect(
      mapAuthError(
        { code: 'otp_disabled', status: 422, message: 'Signups not allowed for otp' },
        SIGN_IN_SEND,
      ),
    ).toBe('noAccount')
  })

  it('reads the SAME code as "signups are off" when the customer is signing up', () => {
    // Same response, opposite meaning: on the signup form there is no account to
    // find, so "we couldn't find your account" would be nonsense.
    expect(
      mapAuthError(
        { code: 'otp_disabled', status: 422, message: 'Signups not allowed for otp' },
        SIGN_UP_SEND,
      ),
    ).toBe('unavailable')
  })

  it('separates a bad code from a missing account', () => {
    expect(mapAuthError({ code: 'otp_expired', status: 403 }, SIGN_IN_VERIFY)).toBe('invalidCode')
    expect(mapAuthError({ code: 'invalid_credentials', status: 400 }, SIGN_IN_VERIFY)).toBe(
      'invalidCode',
    )
  })

  it('maps every rate-limit variant, by code or by status', () => {
    expect(mapAuthError({ code: 'over_email_send_rate_limit', status: 429 }, SIGN_IN_SEND)).toBe(
      'rateLimited',
    )
    expect(mapAuthError({ code: 'over_sms_send_rate_limit', status: 429 }, PHONE_SEND)).toBe(
      'rateLimited',
    )
    expect(mapAuthError({ code: 'over_request_rate_limit', status: 429 }, SIGN_IN_SEND)).toBe(
      'rateLimited',
    )
    // Unknown code, but the status is unambiguous.
    expect(mapAuthError({ code: 'something_new', status: 429 }, SIGN_IN_SEND)).toBe('rateLimited')
  })

  it('blames the right field when the server rejects a value', () => {
    expect(mapAuthError({ code: 'validation_failed', status: 400 }, SIGN_IN_SEND)).toBe(
      'emailRejected',
    )
    expect(mapAuthError({ code: 'validation_failed', status: 400 }, PHONE_SEND)).toBe(
      'phoneRejected',
    )
    // At the verify step the only thing under validation is the typed code.
    expect(mapAuthError({ code: 'validation_failed', status: 400 }, SIGN_IN_VERIFY)).toBe(
      'invalidCode',
    )
  })

  it('treats a request that never reached the server as a network problem', () => {
    // AuthRetryableFetchError arrives with neither code nor status.
    expect(mapAuthError({ message: 'Failed to fetch' }, SIGN_IN_SEND)).toBe('network')
    expect(mapAuthError({ code: null, status: null, message: 'Failed to fetch' }, SIGN_IN_SEND)).toBe(
      'network',
    )
  })

  it('falls back to the message when the server is too old to send a code', () => {
    expect(mapAuthError({ status: 422, message: 'Signups not allowed for otp' }, SIGN_IN_SEND)).toBe(
      'noAccount',
    )
    expect(
      mapAuthError({ status: 403, message: 'Token has expired or is invalid' }, SIGN_IN_VERIFY),
    ).toBe('invalidCode')
    expect(
      mapAuthError(
        { status: 400, message: 'Unable to validate email address: invalid format' },
        SIGN_IN_SEND,
      ),
    ).toBe('emailRejected')
  })

  it('keeps the flow distinction even on the prose fallback', () => {
    expect(mapAuthError({ status: 422, message: 'Signups not allowed for otp' }, SIGN_UP_SEND)).toBe(
      'unavailable',
    )
  })

  it('falls back to generic for anything unrecognised, never to the raw text', () => {
    const key = mapAuthError(
      { code: 'brand_new_code_we_have_never_seen', status: 500, message: 'internal boom' },
      SIGN_IN_SEND,
    )
    expect(key).toBe('generic')
  })

  it('returns generic rather than throwing on a missing error object', () => {
    expect(mapAuthError(null, SIGN_IN_SEND)).toBe('generic')
    expect(mapAuthError(undefined, SIGN_IN_SEND)).toBe('generic')
    expect(mapAuthError({}, SIGN_IN_SEND)).toBe('network')
  })

  it('only ever returns keys from the known set — the invariant that matters', () => {
    const allowed = new Set([
      'noAccount',
      'invalidCode',
      'rateLimited',
      'emailRejected',
      'phoneRejected',
      'unavailable',
      'network',
      'generic',
    ])
    const samples = [
      { code: 'otp_disabled', status: 422, message: 'Signups not allowed for otp' },
      { code: 'otp_expired', status: 403, message: 'Token has expired or is invalid' },
      { code: 'user_banned', status: 403, message: 'User is banned' },
      { code: 'sms_send_failed', status: 500, message: 'Error sending sms' },
      { message: 'Failed to fetch' },
      { status: 500, message: 'Internal Server Error' },
      {},
    ]
    for (const context of [SIGN_IN_SEND, SIGN_IN_VERIFY, SIGN_UP_SEND, PHONE_SEND]) {
      for (const sample of samples) {
        expect(allowed.has(mapAuthError(sample, context)), JSON.stringify(sample)).toBe(true)
      }
    }
  })
})

describe('the path out of a missing account', () => {
  it('offers signup for exactly the missing-account case', () => {
    expect(offersSignup('noAccount')).toBe(true)
    for (const key of ['invalidCode', 'rateLimited', 'network', 'generic'] as const) {
      expect(offersSignup(key), key).toBe(false)
    }
  })

  it('carries the typed address to the signup form so it is not retyped', () => {
    expect(signupHrefForEmail('nabil@example.com')).toBe('/signup?email=nabil%40example.com')
  })

  it('encodes addresses that would otherwise break the query string', () => {
    expect(signupHrefForEmail('nabil+loyalty@example.com')).toBe(
      '/signup?email=nabil%2Bloyalty%40example.com',
    )
  })

  it('degrades to a plain signup link when there is nothing to carry', () => {
    expect(signupHrefForEmail('')).toBe('/signup')
    expect(signupHrefForEmail('   ')).toBe('/signup')
  })
})
