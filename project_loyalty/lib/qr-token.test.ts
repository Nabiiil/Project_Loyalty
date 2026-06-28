import { describe, it, expect, beforeAll } from 'vitest'
import { signQrToken, verifyQrToken } from './qr-token'

beforeAll(() => {
  process.env.QR_TOKEN_SECRET = 'test-secret-do-not-use-in-prod'
})

const BID = '11111111-1111-1111-1111-111111111111'

describe('signQrToken', () => {
  it('embeds business id, amount, and an expiry within the TTL', () => {
    const now = 1_700_000_000_000
    const { payload, expiresAt } = signQrToken({
      businessId: BID,
      amount: 4.5,
      ttlSeconds: 900,
      now,
    })

    expect(payload.bid).toBe(BID)
    expect(payload.amt).toBe(4.5)
    expect(payload.exp - payload.iat).toBe(900)
    expect(expiresAt).toBe(new Date((payload.exp) * 1000).toISOString())
  })

  it('defaults amount to null when omitted', () => {
    const { payload } = signQrToken({ businessId: BID })
    expect(payload.amt).toBeNull()
  })

  it('produces a unique token (and thus qr_token) every call', () => {
    const a = signQrToken({ businessId: BID, now: 1_700_000_000_000 })
    const b = signQrToken({ businessId: BID, now: 1_700_000_000_000 })
    expect(a.token).not.toBe(b.token)
    expect(a.payload.jti).not.toBe(b.payload.jti)
  })
})

describe('verifyQrToken', () => {
  it('accepts a freshly signed token', () => {
    const now = 1_700_000_000_000
    const { token, payload } = signQrToken({ businessId: BID, amount: 3, now })

    const result = verifyQrToken(token, now)
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.payload.bid).toBe(BID)
      expect(result.payload.jti).toBe(payload.jti)
    }
  })

  it('rejects an expired token', () => {
    const issuedAt = 1_700_000_000_000
    const { token } = signQrToken({ businessId: BID, ttlSeconds: 900, now: issuedAt })

    const afterExpiry = issuedAt + 901_000
    const result = verifyQrToken(token, afterExpiry)
    expect(result).toEqual({ valid: false, reason: 'expired' })
  })

  it('rejects a tampered payload (signature mismatch)', () => {
    const { token } = signQrToken({ businessId: BID, now: 1_700_000_000_000 })
    const [, sig] = token.split('.')

    // Re-sign a different business id under the original signature.
    const forgedPayload = Buffer.from(
      JSON.stringify({ bid: 'attacker', amt: null, iat: 1, exp: 9_999_999_999, jti: 'x' }),
      'utf8',
    ).toString('base64url')
    const forged = `${forgedPayload}.${sig}`

    expect(verifyQrToken(forged, 1_700_000_000_000)).toEqual({
      valid: false,
      reason: 'bad_signature',
    })
  })

  it('rejects a malformed token', () => {
    expect(verifyQrToken('not-a-token', Date.now())).toEqual({
      valid: false,
      reason: 'malformed',
    })
    expect(verifyQrToken('only-one-part.', Date.now()).valid).toBe(false)
  })
})
