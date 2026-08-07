/**
 * Email format checking and Supabase auth error translation — pure, shared, and
 * unit-tested, so the sign-in page and the signup form cannot drift apart on
 * what they tell a customer.
 *
 * Two problems live here, and they are deliberately kept separate because they
 * are different problems with different fixes:
 *
 *   - "That isn't an email address" — caught here, before any request, and shown
 *     against the field so the customer fixes a typo without a round trip.
 *   - "There's no account for that email" — only the server knows this, and the
 *     fix is to create an account, not to retype the address.
 *
 * The hard rule for {@link mapAuthError}: it returns a message KEY, never a
 * string, and never the provider's own text. Supabase speaks in its own terms
 * ("Signups not allowed for otp") which is accurate, internal, and meaningless
 * to someone standing at a counter trying to collect a coffee stamp.
 */

/** Outcome of checking a typed address. `malformed` is the only one worth showing. */
export type EmailCheck = 'ok' | 'empty' | 'malformed'

/**
 * Permissive on purpose. Real addresses are stranger than people expect —
 * plus-addressing, dots and dashes in the local part, long or non-ASCII domains,
 * multi-label TLDs — so this only rejects input that could not be delivered
 * under any reading: no `@`, nothing either side of it, whitespace, or a domain
 * with no dotted TLD of at least two letters.
 *
 * Notably NOT enforced: quoted local parts, IP-literal domains, and the RFC's
 * full grammar. Chasing those rejects real customers to catch a typo the OTP
 * round-trip would have caught anyway.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)*\.[A-Za-z]{2,}$/

/** The RFC 5321 ceiling; anything near it is a paste accident, not an address. */
const MAX_EMAIL_LENGTH = 254

export function checkEmail(raw: string): EmailCheck {
  const value = raw.trim()
  if (!value) return 'empty'
  if (value.length > MAX_EMAIL_LENGTH) return 'malformed'
  return EMAIL_PATTERN.test(value) ? 'ok' : 'malformed'
}

/** Gate for the submit button — an empty field is not yet an error to shout about. */
export function isSubmittableEmail(raw: string): boolean {
  return checkEmail(raw) === 'ok'
}

/**
 * Whether to show the inline field error yet. An untouched or half-typed field
 * is not a mistake — nagging someone mid-keystroke ("n@" is invalid!) is the
 * accusatory tone this screen is meant to avoid.
 */
export function shouldShowEmailError(raw: string, touched: boolean): boolean {
  return touched && checkEmail(raw) === 'malformed'
}

/** Message keys under the `customerAuth.errors` namespace. */
export type AuthMessageKey =
  | 'noAccount'
  | 'invalidCode'
  | 'rateLimited'
  | 'emailRejected'
  | 'phoneRejected'
  | 'unavailable'
  | 'network'
  | 'generic'

export type AuthFlow = 'sign-in' | 'sign-up'
export type AuthChannel = 'email' | 'phone'
export type AuthStage = 'send' | 'verify'

export type AuthContext = {
  flow: AuthFlow
  channel: AuthChannel
  stage: AuthStage
}

/** The shape we care about from Supabase's AuthError; all fields optional. */
export type RawAuthError = {
  code?: string | null
  status?: number | null
  message?: string | null
}

/**
 * Codes whose meaning does not depend on which form the customer is on.
 * Names come from @supabase/auth-js `ErrorCode`.
 */
const UNAMBIGUOUS_CODES: Record<string, AuthMessageKey> = {
  otp_expired: 'invalidCode',
  invalid_credentials: 'invalidCode',
  over_request_rate_limit: 'rateLimited',
  over_email_send_rate_limit: 'rateLimited',
  over_sms_send_rate_limit: 'rateLimited',
  email_address_invalid: 'emailRejected',
  email_address_not_authorized: 'emailRejected',
  sms_send_failed: 'phoneRejected',
  request_timeout: 'network',
  // Provider turned off, hook failures, banned users: all real, none of them
  // something the customer can act on, so they get the "try later" wording
  // rather than a dead end that blames them.
  email_provider_disabled: 'unavailable',
  phone_provider_disabled: 'unavailable',
  provider_disabled: 'unavailable',
  user_banned: 'unavailable',
}

/**
 * `otp_disabled` and `signup_disabled` are the same server response wearing two
 * different meanings, and only the flow tells them apart:
 *
 *   - Signing IN with `shouldCreateUser: false`, an unknown address comes back
 *     as "Signups not allowed for otp". The account simply does not exist —
 *     the exact case that used to leak raw to the customer.
 *   - Signing UP, the same code means the project has signups switched off. The
 *     customer has done nothing wrong and creating an account won't help.
 */
const FLOW_DEPENDENT_CODES = new Set(['otp_disabled', 'signup_disabled', 'user_not_found'])

/**
 * Fallbacks for a gotrue old enough not to send `code`. Ordered — first match
 * wins — and matched case-insensitively against the provider's own text, which
 * is the only signal left in that case.
 */
const MESSAGE_PATTERNS: Array<[RegExp, AuthMessageKey]> = [
  [/signups?\s+not\s+allowed/i, 'noAccount'],
  [/user\s+not\s+found/i, 'noAccount'],
  [/token\s+has\s+expired|expired\s+or\s+is\s+invalid|invalid\s+token/i, 'invalidCode'],
  [/rate\s*limit|only\s+request\s+this\s+after|too\s+many/i, 'rateLimited'],
  [/unable\s+to\s+validate\s+email|invalid\s+email|email.*invalid\s+format/i, 'emailRejected'],
  [/invalid\s+phone|phone.*invalid\s+format/i, 'phoneRejected'],
  [/failed\s+to\s+fetch|network|timeout/i, 'network'],
]

/**
 * Turn a Supabase auth failure into a key for a message a customer can act on.
 *
 * Resolution order is deliberate: the machine-readable `code` first, then the
 * flow-sensitive codes, then HTTP status, then the provider's prose as a last
 * resort. Anything unrecognised lands on `generic` — the point is that no path
 * through this function can return provider text.
 */
export function mapAuthError(
  error: RawAuthError | null | undefined,
  context: AuthContext,
): AuthMessageKey {
  if (!error) return 'generic'

  const code = error.code ?? ''

  if (code && code in UNAMBIGUOUS_CODES) return UNAMBIGUOUS_CODES[code]

  if (code && FLOW_DEPENDENT_CODES.has(code)) {
    return context.flow === 'sign-in' ? 'noAccount' : 'unavailable'
  }

  // A rejected value at the send step is the address itself; at the verify step
  // the only thing being validated is the code they typed.
  if (code === 'validation_failed') {
    if (context.stage === 'verify') return 'invalidCode'
    return context.channel === 'email' ? 'emailRejected' : 'phoneRejected'
  }

  // No code AND no status means the request never reached the server — the
  // customer is on café wifi that just dropped, not holding a bad address.
  if (!code && (error.status === null || error.status === undefined)) {
    return 'network'
  }

  if (error.status === 429) return 'rateLimited'

  for (const [pattern, key] of MESSAGE_PATTERNS) {
    if (error.message && pattern.test(error.message)) {
      // The prose fallbacks can't tell "signups disabled" apart by flow either.
      if (key === 'noAccount' && context.flow !== 'sign-in') return 'unavailable'
      return key
    }
  }

  return 'generic'
}

/** Does this failure mean "go create an account" rather than "try again"? */
export function offersSignup(key: AuthMessageKey): boolean {
  return key === 'noAccount'
}

/**
 * Signup link carrying the address the customer already typed, so being sent to
 * the other form doesn't cost them the typing. Encoded as a query param, which
 * is safe here: it is the customer's own address going to our own signup page,
 * not third-party data leaving the app.
 */
export function signupHrefForEmail(email: string): string {
  const value = email.trim()
  return value ? `/signup?email=${encodeURIComponent(value)}` : '/signup'
}
