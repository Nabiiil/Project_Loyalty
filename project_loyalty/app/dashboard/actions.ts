'use server'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export type RevealState =
  | { ok: true; code: string; expiresAt: string | null }
  | { ok: false; error: string }

/**
 * Mint (or re-return) the single-use redemption code for one of the caller's
 * reward-ready enrollments. Account-gated: a real Supabase Auth session is
 * required, which is the whole point of Task 7 — you cannot claim a reward
 * anonymously. All eligibility + single-use logic lives in create_redemption().
 */
export async function revealRedemptionCode(
  enrollmentId: string,
): Promise<RevealState> {
  const authClient = await createClient()
  const {
    data: { user },
  } = await authClient.auth.getUser()

  if (!user) {
    return { ok: false, error: 'account_required' }
  }

  const service = createServiceClient()

  const { data: customer } = await service
    .from('customers')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (!customer) {
    return { ok: false, error: 'account_required' }
  }

  const { data, error } = await service.rpc('create_redemption', {
    p_enrollment_id: enrollmentId,
    p_customer_id: customer.id,
  })

  if (error) {
    console.error('create_redemption error:', error)
    return { ok: false, error: 'server_error' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = data as any
  if (!raw?.ok) {
    return { ok: false, error: raw?.error ?? 'server_error' }
  }

  return { ok: true, code: raw.code, expiresAt: raw.expires_at ?? null }
}
