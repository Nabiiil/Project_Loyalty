'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { normalizeDisplayName } from '@/lib/profile'
import { getTranslations } from '@/lib/i18n/server'

export type SaveProfileState = { ok: true } | { ok: false; error: string }

/**
 * Save the customer's optional display name.
 *
 * Deliberately goes through `createClient()` — the customer's OWN authenticated
 * session — and NOT the service client. The service role bypasses RLS, which
 * would make the scoping a property of this function's WHERE clause and nothing
 * more. Going through the session means `customer_update_own_row` and the
 * `display_name` column grant are the real access control, enforced by Postgres
 * for every caller. See supabase/tests/customer_profile_test.sql, which proves
 * the denial cases against the deployed policy rather than against this code.
 *
 * The `.eq()` below is therefore belt-and-braces, not the gate: it keeps the
 * statement narrow and readable, but removing it would not widen what a
 * customer can write.
 */
export async function saveProfile(
  _prev: SaveProfileState | null,
  formData: FormData,
): Promise<SaveProfileState> {
  const t = await getTranslations('customerProfile')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Anonymous visitors never reach this: the page renders the account prompt
  // instead of the form, and RLS would refuse the write regardless.
  if (!user) return { ok: false, error: t('saveFailed') }

  const raw = formData.get('display_name')
  const result = normalizeDisplayName(typeof raw === 'string' ? raw : null)
  if (!result.ok) return { ok: false, error: t('tooLong') }

  const { error, count } = await supabase
    .from('customers')
    .update({ display_name: result.value }, { count: 'exact' })
    .eq('auth_user_id', user.id)

  if (error) {
    console.error('[profile] display_name update failed:', error.message)
    return { ok: false, error: t('saveFailed') }
  }

  // Zero rows means the session is valid but has no customer row behind it —
  // a state /auth/complete is supposed to make impossible. Report it rather
  // than showing "Saved" over a write that never landed.
  if (count === 0) {
    console.error('[profile] no customer row for auth user', user.id)
    return { ok: false, error: t('saveFailed') }
  }

  revalidatePath('/dashboard/profile')
  revalidatePath('/dashboard') // the header greets by this name
  return { ok: true }
}
