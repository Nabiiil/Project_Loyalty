import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  DEVICE_TOKEN_COOKIE,
  DEVICE_TOKEN_QUERY_PARAM,
  decideClaimAction,
  resolveDeviceToken,
} from '@/lib/customer-claim'

type Service = ReturnType<typeof createServiceClient>

export default async function AuthCompletePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()

  if (!user) {
    redirect('/signup?error=auth_failed')
  }

  // Resolve the anonymous identity from the cookie, falling back to the value
  // carried through the OAuth round-trip (see lib/customer-claim). The email/
  // phone flow always has the cookie; Google can arrive with only the carried
  // value when the cross-site bounce dropped the cookie.
  const cookieStore = await cookies()
  const params = await searchParams
  const carried = params[DEVICE_TOKEN_QUERY_PARAM]
  const deviceToken = resolveDeviceToken({
    cookieValue: cookieStore.get(DEVICE_TOKEN_COOKIE)?.value,
    queryValue: Array.isArray(carried) ? carried[0] : carried,
  })

  const service = createServiceClient()

  // Does this auth user already have a customer row (returning login)?
  const { data: authCustomer } = await service
    .from('customers')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  // Anonymous (device-token) customer for this browser, not yet claimed.
  const { data: anonCustomer } = deviceToken
    ? await service
        .from('customers')
        .select('id')
        .eq('device_token', deviceToken)
        .is('auth_user_id', null)
        .maybeSingle()
    : { data: null }

  // Resolve exactly one action, ordered so an anonymous identity is never
  // orphaned: link/merge onto the existing row, and only insert when there is
  // genuinely no prior identity. See lib/customer-claim.decideClaimAction.
  const action = decideClaimAction({
    authCustomerId: authCustomer?.id ?? null,
    anonCustomerId: anonCustomer?.id ?? null,
  })

  switch (action.kind) {
    case 'merge-into-existing':
      // Returning user on a device that also carries anonymous stamps: fold them
      // into the existing account, then drop the now-empty anonymous row.
      await mergeEnrollments(service, action.anonCustomerId, action.authCustomerId)
      await service.from('customers').delete().eq('id', action.anonCustomerId)
      break

    case 'link-anon-in-place':
      // First claim of an anonymous card: upgrade THIS row in place. Every stamp
      // earned anonymously stays attached to the same customer_id — no second
      // record, no merge. device_token/signup_source are left untouched so the
      // scan history carries over exactly as it was.
      await service
        .from('customers')
        .update({
          auth_user_id: user.id,
          email: user.email ?? null,
          phone_number: user.phone ?? null,
          claimed_at: new Date().toISOString(),
        })
        .eq('id', action.anonCustomerId)
      break

    case 'insert-new':
      // Direct signup with no prior anonymous activity — their first record.
      await service.from('customers').insert({
        auth_user_id: user.id,
        email: user.email ?? null,
        phone_number: user.phone ?? null,
        signup_source: 'direct_signup',
        claimed_at: new Date().toISOString(),
      })
      break

    case 'noop-existing':
      // Returning login with nothing anonymous to fold in.
      break
  }

  redirect('/dashboard')
}

/** Move every enrollment from one customer to another, summing any overlap. */
async function mergeEnrollments(
  service: Service,
  fromCustomerId: string,
  toCustomerId: string,
) {
  const { data: anonEnrollments } = await service
    .from('enrollments')
    .select('id, business_id, current_stamps')
    .eq('customer_id', fromCustomerId)

  for (const anon of anonEnrollments ?? []) {
    const { data: claimed } = await service
      .from('enrollments')
      .select('id, current_stamps')
      .eq('customer_id', toCustomerId)
      .eq('business_id', anon.business_id)
      .maybeSingle()

    if (claimed) {
      // Both customers have stamps at this business — add them together.
      await service
        .from('enrollments')
        .update({ current_stamps: claimed.current_stamps + anon.current_stamps })
        .eq('id', claimed.id)
      await service.from('enrollments').delete().eq('id', anon.id)
    } else {
      // Reassign the enrollment to the auth customer.
      await service
        .from('enrollments')
        .update({ customer_id: toCustomerId })
        .eq('id', anon.id)
    }
  }
}
