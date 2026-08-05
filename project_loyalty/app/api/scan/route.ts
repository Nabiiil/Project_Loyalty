import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 2 // 2 years

export async function POST(request: NextRequest) {
  const { qrToken } = await request.json()
  if (!qrToken || typeof qrToken !== 'string') {
    return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400 })
  }

  const cookieStore = await cookies()
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  const existingDeviceToken = cookieStore.get('device_token')?.value ?? null

  const service = createServiceClient()
  const { data, error } = await service.rpc('scan_transaction', {
    p_qr_token: qrToken,
    p_auth_user_id: user?.id ?? undefined,
    p_device_token: existingDeviceToken ?? undefined,
  })

  if (error) {
    console.error('scan_transaction error:', error)
    return NextResponse.json({ ok: false, error: 'server_error' })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = data as any

  if (!raw?.ok) {
    const code = raw?.error ?? 'server_error'
    return NextResponse.json({
      ok: false,
      error: code,
      // Everything the stale-QR screen needs to be useful instead of a dead end.
      // Purely descriptive — gathered AFTER scan_transaction has already made
      // its decision, so it cannot influence expiry or single-use validation.
      staleContext: await buildStaleContext(service, {
        code,
        qrToken,
        authUserId: user?.id ?? null,
        deviceToken: existingDeviceToken,
      }),
    })
  }

  // Fetch business name + the reward the customer is working toward.
  const { data: biz } = await service
    .from('businesses')
    .select('name, reward_description')
    .eq('id', raw.business_id)
    .single()

  const result = NextResponse.json({
    ok: true,
    transactionId: raw.transaction_id,
    businessId: raw.business_id,
    businessName: biz?.name ?? null,
    rewardDescription: biz?.reward_description ?? null,
    customerId: raw.customer_id,
    deviceToken: raw.device_token ?? null,
    isNewCustomer: raw.is_new_customer,
    enrollmentId: raw.enrollment_id,
    currentStamps: raw.current_stamps,
    rewardThreshold: raw.reward_threshold,
    rewardReached: raw.reward_reached,
  })

  // Write device_token as a server-set cookie — reliable even without JS hydration.
  const newDeviceToken = raw.device_token && !existingDeviceToken ? raw.device_token : null
  if (newDeviceToken) {
    result.cookies.set('device_token', newDeviceToken, {
      path: '/',
      maxAge: COOKIE_MAX_AGE,
      sameSite: 'lax',
      httpOnly: false, // must be readable client-side per CLAUDE.md
    })
  }

  return result
}

/**
 * Context for the "this code is no longer valid" screen.
 *
 * `recognized` is what the screen branches on: a returning customer gets a way
 * back to their balance, a first-time scanner gets told what the app is. Being
 * recognized means an auth session, or a device token that has actually earned
 * something — a bare token with no enrollments is someone who has never
 * successfully collected a stamp, so they read as a newcomer.
 */
type StaleScanContext = {
  recognized: boolean
  businessName: string | null
  progress: {
    currentStamps: number
    rewardThreshold: number
    rewardDescription: string | null
  } | null
}

/**
 * Only 'token_expired' and 'already_scanned' describe a REAL code that simply
 * ran out — those are the two worth softening. A malformed or forged token gets
 * nothing back, so this never becomes a way to probe which business a made-up
 * token belongs to.
 */
const STALE_CODES = new Set(['token_expired', 'already_scanned'])

async function buildStaleContext(
  service: ReturnType<typeof createServiceClient>,
  input: {
    code: string
    qrToken: string
    authUserId: string | null
    deviceToken: string | null
  },
): Promise<StaleScanContext | null> {
  if (!STALE_CODES.has(input.code)) return null

  // Who is this? Auth session first, mirroring the identity-resolution priority
  // in CLAUDE.md, then the device token.
  const { data: customer } = input.authUserId
    ? await service
        .from('customers')
        .select('id')
        .eq('auth_user_id', input.authUserId)
        .maybeSingle()
    : input.deviceToken
      ? await service
          .from('customers')
          .select('id')
          .eq('device_token', input.deviceToken)
          .maybeSingle()
      : { data: null }

  // An auth session counts on its own; a device token has to have earned
  // something for its holder to have a balance worth returning to.
  const { count: enrollmentCount } = customer
    ? await service
        .from('enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('customer_id', customer.id)
    : { count: 0 }

  const recognized = Boolean(input.authUserId) || (enrollmentCount ?? 0) > 0

  // The business behind the dead code. The transaction row survives expiry and
  // scanning, so it still names the counter the customer is standing at.
  const { data: txn } = await service
    .from('transactions')
    .select('business_id')
    .eq('qr_token', input.qrToken)
    .maybeSingle()

  if (!txn) return { recognized, businessName: null, progress: null }

  const { data: biz } = await service
    .from('businesses')
    .select('name, reward_threshold, reward_description')
    .eq('id', txn.business_id)
    .maybeSingle()

  // Their standing at THIS business — the detail that turns "come back later"
  // into something worth reading.
  const { data: enrollment } = customer
    ? await service
        .from('enrollments')
        .select('current_stamps')
        .eq('customer_id', customer.id)
        .eq('business_id', txn.business_id)
        .maybeSingle()
    : { data: null }

  return {
    recognized,
    businessName: biz?.name ?? null,
    progress:
      enrollment && biz
        ? {
            currentStamps: enrollment.current_stamps,
            rewardThreshold: biz.reward_threshold,
            rewardDescription: biz.reward_description ?? null,
          }
        : null,
  }
}
