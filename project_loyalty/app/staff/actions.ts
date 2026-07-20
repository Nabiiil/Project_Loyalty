'use server'

import QRCode from 'qrcode'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createStaffClient } from '@/lib/supabase/staff-server'
import { createServiceClient } from '@/lib/supabase/service'
import { signQrToken } from '@/lib/qr-token'
import { requireOwner } from '@/lib/staff-owner'

export type CreateTransactionState =
  | {
      ok: true
      qrDataUrl: string
      scanUrl: string
      amount: number | null
      expiresAt: string
    }
  | { ok: false; error: string }

/** Where the customer's phone lands when they scan the QR. */
async function buildScanUrl(token: string): Promise<string> {
  let origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin) {
    const h = await headers()
    const host = h.get('x-forwarded-host') ?? h.get('host')
    const proto = h.get('x-forwarded-proto') ?? 'https'
    origin = host ? `${proto}://${host}` : ''
  }
  return `${origin.replace(/\/$/, '')}/scan/${token}`
}

function parseAmount(raw: FormDataEntryValue | null): number | null | undefined {
  // undefined signals a validation error; null means "no amount" (stamp-only).
  if (raw == null || raw === '') return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) return undefined
  // numeric(10, 2): cap precision to 2 decimals.
  return Math.round(value * 100) / 100
}

export async function createTransaction(
  _prevState: CreateTransactionState | null,
  formData: FormData,
): Promise<CreateTransactionState> {
  const supabase = await createStaffClient()

  // 1. Authenticate the staff member (validated against Supabase Auth).
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { ok: false, error: 'You must be signed in to create a transaction.' }
  }

  // 2. Resolve the staff member's business. RLS also scopes the insert below,
  //    but we need the id to put inside the signed token.
  const { data: staff, error: staffError } = await supabase
    .from('staff_users')
    .select('business_id')
    .eq('auth_user_id', user.id)
    .single()
  if (staffError || !staff) {
    return { ok: false, error: 'No business is linked to this staff account.' }
  }

  // 3. Validate the optional amount.
  const amount = parseAmount(formData.get('amount'))
  if (amount === undefined) {
    return { ok: false, error: 'Amount must be a number of 0 or more.' }
  }

  // 4. Sign a short-lived token carrying business_id + amount + expiry.
  const { token, expiresAt } = signQrToken({
    businessId: staff.business_id,
    amount,
  })

  // 5. Record a pending transaction. The signed token is the qr_token; the DB
  //    enforces single-use later by flipping status to 'scanned'.
  const { error: insertError } = await supabase.from('transactions').insert({
    business_id: staff.business_id,
    qr_token: token,
    amount,
    status: 'pending',
    expires_at: expiresAt,
  })
  if (insertError) {
    return { ok: false, error: 'Could not create the transaction. Please try again.' }
  }

  // 6. Render the QR the customer scans.
  const scanUrl = await buildScanUrl(token)
  const qrDataUrl = await QRCode.toDataURL(scanUrl, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
  })

  return { ok: true, qrDataUrl, scanUrl, amount, expiresAt }
}

export type VerifyRedemptionState =
  | { ok: true; valid: true; businessName: string }
  | { ok: true; valid: false; reason: string }
  | { ok: false; error: string }

/**
 * Staff enters a customer's redemption code. The verify_redemption() DB function
 * is the source of truth: it re-checks eligibility live and atomically consumes
 * the code + resets the stamp count in one locked transaction. We call it
 * through the staff's own authenticated session, so auth.uid() inside the
 * function resolves to this staff member and scopes the check to their business.
 */
export async function verifyRedemption(
  _prevState: VerifyRedemptionState | null,
  formData: FormData,
): Promise<VerifyRedemptionState> {
  const supabase = await createStaffClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { ok: false, error: 'You must be signed in to verify a reward.' }
  }

  const code = ((formData.get('code') as string | null) ?? '').trim().toUpperCase()
  if (!code) {
    return { ok: false, error: 'Enter a redemption code.' }
  }

  const { data, error } = await supabase.rpc('verify_redemption', { p_code: code })
  if (error) {
    console.error('verify_redemption error:', error)
    return { ok: false, error: 'Something went wrong. Please try again.' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = data as any
  if (!raw?.ok) {
    return { ok: false, error: 'Something went wrong. Please try again.' }
  }

  if (raw.valid) {
    return { ok: true, valid: true, businessName: raw.business_name }
  }
  return { ok: true, valid: false, reason: raw.reason ?? 'invalid_code' }
}

export type UpdateSettingsState =
  | { ok: true; rewardThreshold: number; rewardDescription: string }
  | { ok: false; error: string }

const SETTINGS_ERROR_COPY: Record<string, string> = {
  not_authenticated: 'You must be signed in to change settings.',
  not_staff: 'No business is linked to this staff account.',
  not_owner: 'Only the business owner can change settings.',
  invalid_threshold: 'Reward threshold must be a whole number of 1 or more.',
  invalid_description: 'Enter a short description of the reward.',
  description_too_long: 'Reward description is too long (max 120 characters).',
  invalid_earning_mode: 'That earning mode is not available yet.',
}

/**
 * Staff updates their business's loyalty settings. All validation and the
 * eligibility-preserving threshold change happen inside update_business_settings(),
 * called through the staff's own authenticated session so auth.uid() scopes the
 * write to their business only. Inputs are still parsed defensively here; the DB
 * function is the authoritative validator.
 */
export async function updateBusinessSettings(
  _prevState: UpdateSettingsState | null,
  formData: FormData,
): Promise<UpdateSettingsState> {
  const supabase = await createStaffClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { ok: false, error: 'You must be signed in to change settings.' }
  }

  const rawThreshold = (formData.get('reward_threshold') as string | null) ?? ''
  const threshold = Number(rawThreshold)
  if (!Number.isInteger(threshold) || threshold < 1) {
    return { ok: false, error: SETTINGS_ERROR_COPY.invalid_threshold }
  }

  const description = ((formData.get('reward_description') as string | null) ?? '').trim()
  if (!description) {
    return { ok: false, error: SETTINGS_ERROR_COPY.invalid_description }
  }

  // MVP: per_transaction is the only supported mode; the DB rejects anything else.
  const earningMode = ((formData.get('earning_mode') as string | null) ?? 'per_transaction').trim()

  const { data, error } = await supabase.rpc('update_business_settings', {
    p_reward_threshold: threshold,
    p_reward_description: description,
    p_earning_mode: earningMode,
  })
  if (error) {
    console.error('update_business_settings error:', error)
    return { ok: false, error: 'Something went wrong. Please try again.' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = data as any
  if (!raw?.ok) {
    return { ok: false, error: SETTINGS_ERROR_COPY[raw?.error] ?? 'Could not save settings.' }
  }

  // Customers see reward_description on their dashboard — make sure a change shows.
  revalidatePath('/dashboard')

  return {
    ok: true,
    rewardThreshold: raw.reward_threshold,
    rewardDescription: raw.reward_description,
  }
}

export type UpdateIdentityState =
  | { ok: true; name: string; brandColor: string | null }
  | { ok: false; error: string }
  | null

/**
 * Owner updates the business's public identity: display name and the optional
 * accent color customers see on their enrollment card. (The logo goes through
 * /api/business-logo — file uploads stay out of the action layer.) The write
 * runs through the owner's own session, so the owner_update_own_business RLS
 * policy re-checks the role at the DB and the brand-color format constraint is
 * the final validator.
 */
export async function updateBusinessIdentity(
  _prevState: UpdateIdentityState,
  formData: FormData,
): Promise<UpdateIdentityState> {
  const owner = await requireOwner()
  if (!owner.ok) {
    return { ok: false, error: owner.error }
  }

  const name = ((formData.get('name') as string | null) ?? '').trim()
  if (!name || name.length > 80) {
    return { ok: false, error: 'Enter the business name (max 80 characters).' }
  }

  const rawColor = ((formData.get('brand_color') as string | null) ?? '').trim().toLowerCase()
  const brandColor = rawColor === '' ? null : rawColor
  if (brandColor !== null && !/^#[0-9a-f]{6}$/.test(brandColor)) {
    return { ok: false, error: 'Pick a valid accent color.' }
  }

  const supabase = await createStaffClient()
  const { error } = await supabase
    .from('businesses')
    .update({ name, brand_color: brandColor })
    .eq('id', owner.businessId)
    .select('id')
    .single()
  if (error) {
    console.error('updateBusinessIdentity error:', error)
    return { ok: false, error: 'Could not save. Please try again.' }
  }

  // Customers see the name and accent on their dashboard cards.
  revalidatePath('/dashboard')
  revalidatePath('/staff/dashboard/settings')

  return { ok: true, name, brandColor }
}

/**
 * Server half of staff sign-out (the StaffMenu signs the browser client out
 * first, then calls this). supabase.auth.signOut() on the ssr server client
 * emits the cookie removals through createStaffClient's setAll handler, so the
 * staff_-prefixed auth cookies are cleared on the response — not just client
 * state. Scope 'local' ends this device's session only: the same account may
 * be signed in on the owner's phone, and an end-of-shift sign-out on the
 * counter tablet must not kill it.
 */
export async function signOutStaff(): Promise<void> {
  const supabase = await createStaffClient()
  try {
    await supabase.auth.signOut({ scope: 'local' })
  } catch {
    // Already-dead session (expired, revoked) — nothing to revoke; the local
    // cookie removal still ran, so proceed to the login screen regardless.
  }
  redirect('/staff/login')
}

export type AddStaffState =
  | { ok: true; name: string; email: string }
  | { ok: false; error: string }
  | null

/**
 * Owner creates a staff login: a real Supabase Auth user (email + password)
 * plus the linked staff_users row, always with role 'staff' — owners cannot
 * mint other owners in the MVP. Both writes use the service role key and only
 * happen server-side, after requireOwner() has verified the caller against
 * their own staff_users row; the client has no write path to staff_users.
 */
export async function addStaffLogin(
  _prevState: AddStaffState,
  formData: FormData,
): Promise<AddStaffState> {
  const owner = await requireOwner()
  if (!owner.ok) {
    return { ok: false, error: owner.error }
  }

  const name = ((formData.get('name') as string | null) ?? '').trim()
  if (!name || name.length > 80) {
    return { ok: false, error: 'Enter the staff member’s name (max 80 characters).' }
  }

  const email = ((formData.get('email') as string | null) ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Enter a valid email address.' }
  }

  const password = (formData.get('password') as string | null) ?? ''
  if (password.length < 8) {
    return { ok: false, error: 'Initial password must be at least 8 characters.' }
  }

  const service = createServiceClient()

  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createError || !created?.user) {
    const duplicate = createError?.code === 'email_exists'
    return {
      ok: false,
      error: duplicate
        ? 'A login with that email already exists.'
        : 'Could not create the login. Please try again.',
    }
  }

  const { error: insertError } = await service.from('staff_users').insert({
    business_id: owner.businessId,
    auth_user_id: created.user.id,
    name,
    role: 'staff',
  })
  if (insertError) {
    // Don't leave an orphaned auth user that belongs to no business.
    await service.auth.admin.deleteUser(created.user.id)
    return { ok: false, error: 'Could not create the login. Please try again.' }
  }

  revalidatePath('/staff/dashboard/settings')
  return { ok: true, name, email }
}

export type RemoveStaffState =
  | { ok: true; name: string }
  | { ok: false; error: string }
  | null

/**
 * Owner removes a staff login. Deleting the Supabase Auth user revokes the
 * account's sessions and cascades away the staff_users row, so a departed
 * employee loses access immediately. The target is re-fetched server-side and
 * must belong to the owner's own business; owners (including the caller)
 * can never be removed this way.
 */
export async function removeStaffLogin(
  _prevState: RemoveStaffState,
  formData: FormData,
): Promise<RemoveStaffState> {
  const owner = await requireOwner()
  if (!owner.ok) {
    return { ok: false, error: owner.error }
  }

  const staffId = ((formData.get('staff_id') as string | null) ?? '').trim()
  if (!staffId) {
    return { ok: false, error: 'No staff member selected.' }
  }

  const service = createServiceClient()

  const { data: target } = await service
    .from('staff_users')
    .select('id, business_id, auth_user_id, name, role')
    .eq('id', staffId)
    .single()

  // Fail closed on anything that isn't a plain staff login of this business.
  if (!target || target.business_id !== owner.businessId) {
    return { ok: false, error: 'That staff member was not found.' }
  }
  if (target.role === 'owner') {
    return { ok: false, error: 'The owner login cannot be removed.' }
  }

  const { error: deleteError } = await service.auth.admin.deleteUser(target.auth_user_id)
  if (deleteError) {
    return { ok: false, error: 'Could not remove the login. Please try again.' }
  }

  revalidatePath('/staff/dashboard/settings')
  return { ok: true, name: target.name ?? 'Staff member' }
}
