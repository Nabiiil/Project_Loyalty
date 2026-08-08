import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  DEVICE_TOKEN_COOKIE,
  DEVICE_TOKEN_QUERY_PARAM,
  RETIRED_DEVICE_TOKEN_COOKIE,
  decideClaimAction,
  resolveDeviceToken,
  shouldRetireDeviceToken,
} from '@/lib/customer-claim'
import { NAME_PROMPT_PARAM, displayNameFromOAuthMetadata } from '@/lib/profile'

/**
 * Completion step for both sign-in surfaces: attach the freshly authenticated
 * identity to the right customer row, then retire the anonymous device token.
 *
 * This is a Route Handler rather than a page because it has to clear a cookie,
 * and cookies cannot be modified while a Server Component renders — the server
 * can only ever send `Set-Cookie` on a response. It renders nothing either way:
 * every path here ends in a redirect.
 *
 * Reached by full-page navigation from /auth/callback (Google) and from the
 * email/phone OTP forms, so GET is the only method that matters.
 */
export async function GET(request: NextRequest) {
  const { origin, searchParams } = new URL(request.url)

  const authClient = await createClient()
  const {
    data: { user },
  } = await authClient.auth.getUser()

  if (!user) {
    return NextResponse.redirect(new URL('/signup?error=auth_failed', origin))
  }

  // Resolve the anonymous identity from the cookie, falling back to the value
  // carried through the OAuth round-trip (see lib/customer-claim). The email/
  // phone flow always has the cookie; Google can arrive with only the carried
  // value when the cross-site bounce dropped the cookie.
  const deviceToken = resolveDeviceToken({
    cookieValue: request.cookies.get(DEVICE_TOKEN_COOKIE)?.value,
    queryValue: searchParams.get(DEVICE_TOKEN_QUERY_PARAM),
  })

  const service = createServiceClient()

  // Does this auth user already have a customer row (returning login)?
  const { data: authCustomer } = await service
    .from('customers')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  // Anonymous (device-token) customer for this browser, not yet claimed. An
  // already-merged token finds nothing here: merge_anonymous_customer deletes
  // the row it transfers, so a stale cookie has nothing left to point at.
  const { data: anonCustomer } = deviceToken
    ? await service
        .from('customers')
        .select('id, display_name')
        .eq('device_token', deviceToken)
        .is('auth_user_id', null)
        .maybeSingle()
    : { data: null }

  // A name Google (or any OAuth provider) already knows. Normalised to the same
  // shape a typed name must satisfy, and null whenever it does not fit — never
  // truncated. Email/phone OTP payloads carry no name, so this is null there,
  // which is exactly what decides whether the customer is asked for one later.
  const oauthName = displayNameFromOAuthMetadata(user.user_metadata)

  // Resolve exactly one action, ordered so an anonymous identity is never
  // orphaned: link/merge onto the existing row, and only insert when there is
  // genuinely no prior identity. See lib/customer-claim.decideClaimAction.
  const action = decideClaimAction({
    authCustomerId: authCustomer?.id ?? null,
    anonCustomerId: anonCustomer?.id ?? null,
  })

  // Tracks whether this browser's identity is now safely on the account. Only a
  // true here earns the cookie clearing below — see shouldRetireDeviceToken.
  let claimSucceeded = true

  // Whether the account ends this request with a name on it. Drives the
  // post-signup prompt: only a fresh claim that produced no name gets asked.
  let nameOnAccount: string | null = null

  // Prefill applies ONLY to the two branches where an account is actually being
  // created or claimed. Deliberately not on a returning sign-in: a customer who
  // clears their name in the profile would otherwise have Google put it back on
  // their next visit, which makes clearing impossible for OAuth customers. By
  // that point the name is theirs to manage, not the provider's to restore.
  const isFirstClaim = action.kind === 'insert-new' || action.kind === 'link-anon-in-place'

  switch (action.kind) {
    case 'merge-into-existing': {
      // Returning user on a device that also carries anonymous stamps. One RPC,
      // one transaction: the stamps move and the anonymous row is retired
      // together, so there is no window where the account holds the stamps and
      // the device could still claim them. Repeat calls are no-ops.
      const { data, error } = await service.rpc('merge_anonymous_customer', {
        p_anon_customer_id: action.anonCustomerId,
        p_target_customer_id: action.authCustomerId,
      })
      const result = data as { ok?: boolean; error?: string } | null

      if (error || !result?.ok) {
        console.error(
          '[auth/complete] merge_anonymous_customer failed:',
          error?.message ?? result?.error ?? 'unknown',
        )
        claimSucceeded = false
      }
      break
    }

    case 'link-anon-in-place': {
      // First claim of an anonymous card: upgrade THIS row in place. Every stamp
      // earned anonymously stays attached to the same customer_id — no second
      // record, no merge, nothing to double-count. device_token/signup_source
      // are left untouched so the scan history carries over exactly as it was;
      // only the browser's copy of the token is retired.
      // Only fill display_name when the row does not already carry one, so a
      // provider can never overwrite a name the customer chose themselves.
      const keepExistingName = anonCustomer?.display_name ?? null
      nameOnAccount = keepExistingName ?? oauthName

      const { error } = await service
        .from('customers')
        .update({
          auth_user_id: user.id,
          email: user.email ?? null,
          phone_number: user.phone ?? null,
          claimed_at: new Date().toISOString(),
          ...(keepExistingName === null && oauthName !== null
            ? { display_name: oauthName }
            : {}),
        })
        .eq('id', action.anonCustomerId)

      if (error) {
        console.error('[auth/complete] link-anon-in-place failed:', error.message)
        claimSucceeded = false
      }
      break
    }

    case 'insert-new': {
      // Direct signup with no prior anonymous activity — their first record.
      // A brand-new row has no name to protect, so the provider's is safe to use.
      nameOnAccount = oauthName

      const { error } = await service.from('customers').insert({
        auth_user_id: user.id,
        email: user.email ?? null,
        phone_number: user.phone ?? null,
        signup_source: 'direct_signup',
        claimed_at: new Date().toISOString(),
        display_name: oauthName,
      })

      if (error) {
        console.error('[auth/complete] insert-new failed:', error.message)
        claimSucceeded = false
      }
      break
    }

    case 'noop-existing':
      // Returning login with nothing anonymous to fold in. The token this
      // browser still carries is either dead or points at an identity that is
      // already claimed — either way it is retired below.
      break
  }

  // Ask for a name only when this was a fresh claim that produced none — i.e.
  // the email/phone OTP paths, where no provider had one to give. A Google
  // signup arrives already named and is never asked. The flag rides on the
  // redirect rather than in storage so it exists for exactly one navigation:
  // the moment after signup, once the points are already safely on the account.
  const dashboardUrl = new URL('/dashboard', origin)
  if (claimSucceeded && isFirstClaim && nameOnAccount === null) {
    dashboardUrl.searchParams.set(NAME_PROMPT_PARAM, '1')
  }

  const response = NextResponse.redirect(dashboardUrl)

  // Retire the anonymous identity in the browser. Deliberately last, and
  // deliberately conditional: if the claim above failed, the cookie stays so the
  // anonymous stamps remain reachable and the next sign-in retries the claim.
  if (shouldRetireDeviceToken({ hasDeviceToken: Boolean(deviceToken), claimSucceeded })) {
    response.cookies.set(DEVICE_TOKEN_COOKIE, '', RETIRED_DEVICE_TOKEN_COOKIE)
  }

  return response
}
