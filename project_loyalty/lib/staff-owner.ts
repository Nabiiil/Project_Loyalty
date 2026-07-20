import 'server-only'
import { createStaffClient } from '@/lib/supabase/staff-server'

export type OwnerCheck =
  | { ok: true; staffId: string; businessId: string }
  | { ok: false; error: string }

/**
 * Resolves the calling session to an OWNER staff row, or an error string.
 * Every owner-only write path starts here — the role comes from the caller's
 * own staff_users row in the DB, never from anything the client sent. Fails
 * closed: no session, no staff row, or role !== 'owner' all deny.
 *
 * Lives outside the 'use server' actions file on purpose: exporting it from
 * there would register it as a client-invocable endpoint.
 */
export async function requireOwner(): Promise<OwnerCheck> {
  const supabase = await createStaffClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { ok: false, error: 'You must be signed in as the business owner.' }
  }

  const { data: staff } = await supabase
    .from('staff_users')
    .select('id, business_id, role')
    .eq('auth_user_id', user.id)
    .single()
  if (!staff || staff.role !== 'owner') {
    return { ok: false, error: 'Only the business owner can do this.' }
  }

  return { ok: true, staffId: staff.id, businessId: staff.business_id }
}
