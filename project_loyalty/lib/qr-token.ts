import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

// Signed, time-limited token embedded in a transaction QR code.
//
// Format (a compact, header-less JWT-style string):
//   base64url(payloadJson) + "." + base64url(HMAC-SHA256(payloadB64, secret))
//
// The token is HMAC-signed so the server can trust its contents without a DB
// round-trip, but it is NOT a secret — it is printed on a QR at the counter.
// Single-use enforcement lives in the DB (transactions.status); this module
// only proves authenticity + freshness. See the QR token security rules in
// CLAUDE.md. Node's crypto keeps this server-only by construction.

const DEFAULT_TTL_SECONDS = 15 * 60 // 15 min, top of the suggested 10-15 range

export type QrTokenPayload = {
  /** business the QR belongs to; re-validated against the DB row on scan */
  bid: string
  /** optional purchase amount, for the future points model; null for stamp-only */
  amt: number | null
  /** issued-at, unix seconds */
  iat: number
  /** expiry, unix seconds */
  exp: number
  /** unique nonce — makes every token (and thus qr_token) distinct */
  jti: string
}

function getSecret(): string {
  const secret = process.env.QR_TOKEN_SECRET
  if (!secret) {
    throw new Error('QR_TOKEN_SECRET is not set')
  }
  return secret
}

function sign(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url')
}

function encodePayload(payload: QrTokenPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

export type SignedQrToken = {
  token: string
  payload: QrTokenPayload
  /** ISO string for the transactions.expires_at column */
  expiresAt: string
}

export function signQrToken(input: {
  businessId: string
  amount?: number | null
  ttlSeconds?: number
  /** overridable for tests; defaults to now */
  now?: number
}): SignedQrToken {
  const secret = getSecret()
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000)
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS

  const payload: QrTokenPayload = {
    bid: input.businessId,
    amt: input.amount ?? null,
    iat: nowSeconds,
    exp: nowSeconds + ttl,
    jti: randomUUID(),
  }

  const payloadB64 = encodePayload(payload)
  const token = `${payloadB64}.${sign(payloadB64, secret)}`

  return {
    token,
    payload,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  }
}

export type VerifyResult =
  | { valid: true; payload: QrTokenPayload }
  | { valid: false; reason: 'malformed' | 'bad_signature' | 'expired' }

/**
 * Verifies a QR token's signature and expiry. Does NOT check single-use or
 * that the business actually exists — those are DB concerns the scan route
 * handles after this passes.
 */
export function verifyQrToken(token: string, now: number = Date.now()): VerifyResult {
  const secret = getSecret()

  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { valid: false, reason: 'malformed' }
  }
  const [payloadB64, providedSig] = parts

  const expectedSig = sign(payloadB64, secret)
  const providedBuf = Buffer.from(providedSig)
  const expectedBuf = Buffer.from(expectedSig)
  if (
    providedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(providedBuf, expectedBuf)
  ) {
    return { valid: false, reason: 'bad_signature' }
  }

  let payload: QrTokenPayload
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
  } catch {
    return { valid: false, reason: 'malformed' }
  }

  if (
    typeof payload?.bid !== 'string' ||
    typeof payload?.exp !== 'number' ||
    typeof payload?.iat !== 'number' ||
    typeof payload?.jti !== 'string'
  ) {
    return { valid: false, reason: 'malformed' }
  }

  if (Math.floor(now / 1000) >= payload.exp) {
    return { valid: false, reason: 'expired' }
  }

  return { valid: true, payload }
}
