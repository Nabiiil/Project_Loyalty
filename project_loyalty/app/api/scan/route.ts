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
    return NextResponse.json({ ok: false, error: raw?.error ?? 'server_error' })
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
