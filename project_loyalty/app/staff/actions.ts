'use server'

import QRCode from 'qrcode'
import { headers } from 'next/headers'
import { createStaffClient } from '@/lib/supabase/staff-server'
import { signQrToken } from '@/lib/qr-token'

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
