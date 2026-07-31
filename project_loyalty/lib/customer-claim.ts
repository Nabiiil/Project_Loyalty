/**
 * Customer "claim" rules — shared, pure, and unit-tested.
 *
 * The claim rule (CLAUDE.md): when a browser that already carries an anonymous
 * `device_token` identity authenticates (Google OR email/phone), the auth
 * identity must be attached to that EXISTING customer row so all enrollments and
 * stamps carry over — never split into a second record.
 *
 * The email/phone flow always satisfies this because it stays on our own origin
 * the whole time, so the `device_token` cookie is present at /auth/complete.
 * Google OAuth bounces cross-site (app → Supabase → Google → Supabase → app),
 * and a `SameSite=Lax` cookie can be dropped on that round-trip by Safari ITP,
 * in-app webviews, or cookie partitioning — exactly the environments a QR-scan
 * loyalty app runs in. When the cookie is missing, /auth/complete can't find the
 * anonymous row and would orphan its stamps by inserting a fresh customer.
 *
 * Fix: carry the device token through the OAuth flow so the callback can resolve
 * it deterministically instead of relying on the cookie surviving. The device
 * token is an unverified anonymous identity pointer, not a secret (CLAUDE.md),
 * so passing it through the redirect URL is within the existing threat model.
 */

/** Cookie name for the anonymous device-token identity. */
export const DEVICE_TOKEN_COOKIE = 'device_token'

/** Query-param name used to carry the device token across the OAuth round-trip. */
export const DEVICE_TOKEN_QUERY_PARAM = 'device_token'

/** Matches the scan route's cookie lifetime (2 years). */
export const DEVICE_TOKEN_MAX_AGE = 60 * 60 * 24 * 365 * 2

/**
 * Build the OAuth `redirectTo` target, carrying the anonymous device token as a
 * query param so /auth/callback can restore it even if the cookie is dropped by
 * the browser during the cross-site round-trip. Omitted when there is no token
 * (a first-time visitor with nothing to preserve).
 */
export function buildOAuthRedirectTo(
  origin: string,
  deviceToken: string | null | undefined,
): string {
  const url = new URL('/auth/callback', origin)
  if (deviceToken) url.searchParams.set(DEVICE_TOKEN_QUERY_PARAM, deviceToken)
  return url.toString()
}

/**
 * Resolve the effective device token at the callback/completion step. The
 * browser's own cookie wins when present (authoritative); the value carried
 * through OAuth is only a fallback for when the cookie didn't survive.
 */
export function resolveDeviceToken(input: {
  cookieValue?: string | null
  queryValue?: string | null
}): string | null {
  return input.cookieValue || input.queryValue || null
}

/**
 * What to do once the authenticated user's existing rows have been looked up.
 *
 * - `merge-into-existing`: a claimed account already exists for this identity AND
 *   this device carries a separate anonymous row (returning customer on a
 *   new-to-them device) — fold the anonymous enrollments into the claimed
 *   account, then drop the empty anonymous row. Chosen deliberately over
 *   silently discarding either side.
 * - `link-anon-in-place`: first claim of an anonymous card — upgrade THAT row so
 *   every earned stamp stays on the same `customer_id`. No second record.
 * - `noop-existing`: returning login with no anonymous stamps to fold in.
 * - `insert-new`: genuinely no prior identity (direct signup, no scans yet).
 */
export type ClaimAction =
  | { kind: 'merge-into-existing'; authCustomerId: string; anonCustomerId: string }
  | { kind: 'link-anon-in-place'; anonCustomerId: string }
  | { kind: 'noop-existing'; authCustomerId: string }
  | { kind: 'insert-new' }

/**
 * The core claim decision, ordered so an anonymous device-token identity is
 * NEVER orphaned: resolve the existing rows first, and only insert a brand-new
 * customer when there is genuinely no prior identity to attach to.
 */
export function decideClaimAction(input: {
  authCustomerId: string | null
  anonCustomerId: string | null
}): ClaimAction {
  const { authCustomerId, anonCustomerId } = input

  if (authCustomerId) {
    if (anonCustomerId && anonCustomerId !== authCustomerId) {
      return { kind: 'merge-into-existing', authCustomerId, anonCustomerId }
    }
    return { kind: 'noop-existing', authCustomerId }
  }

  if (anonCustomerId) {
    return { kind: 'link-anon-in-place', anonCustomerId }
  }

  return { kind: 'insert-new' }
}
