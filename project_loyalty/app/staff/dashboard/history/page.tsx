import { redirect } from 'next/navigation'
import { createStaffClient } from '@/lib/supabase/staff-server'

/**
 * Owner-only activity history. Its main job for now is to make the manual-stamp
 * abuse surface VISIBLE (not blocked): every override is flagged, with its
 * reason and the staff member who added it, plus a count of today's overrides.
 * Counter staff who reach this URL directly are bounced; the RLS policies scope
 * every read to the owner's own business regardless.
 */

const REASON_LABELS: Record<string, string> = {
  qr_failed: 'QR wouldn’t scan',
  phone_dead: 'Phone dead / no phone',
  staff_error: 'Staff error',
  other: 'Other',
}

function describeReason(manualReason: string | null): { label: string; note: string | null } {
  if (!manualReason) return { label: 'Manual', note: null }
  const idx = manualReason.indexOf(':')
  const category = (idx === -1 ? manualReason : manualReason.slice(0, idx)).trim()
  const note = idx === -1 ? null : manualReason.slice(idx + 1).trim() || null
  return { label: REASON_LABELS[category] ?? category, note }
}

function shortCode(customerId: string | null): string {
  return customerId ? customerId.slice(0, 8).toUpperCase() : '—'
}

type HistoryRow = {
  id: string
  created_at: string
  status: string
  amount: number | null
  is_manual: boolean
  manual_reason: string | null
  customer_id: string | null
  acting_staff: { name: string | null } | null
}

export default async function StaffHistoryPage() {
  const supabase = await createStaffClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/staff/login')
  }

  const { data: staff } = await supabase
    .from('staff_users')
    .select('business_id, role')
    .eq('auth_user_id', user.id)
    .single()
  if (!staff) {
    redirect('/staff/login')
  }
  if (staff.role !== 'owner') {
    redirect('/staff/dashboard')
  }

  const { data: rows } = await supabase
    .from('transactions')
    .select(
      'id, created_at, status, amount, is_manual, manual_reason, customer_id, acting_staff:staff_users!transactions_created_by_staff_id_fkey(name)',
    )
    .eq('business_id', staff.business_id)
    .order('created_at', { ascending: false })
    .limit(50)

  const history = (rows ?? []) as unknown as HistoryRow[]

  // Today's manual overrides (UTC day, matching the DB rate-limit window).
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)
  const { count: manualToday } = await supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', staff.business_id)
    .eq('is_manual', true)
    .gte('created_at', startOfDay.toISOString())

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-white">
        Activity
      </h1>

      <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <p className="text-sm text-zinc-500">Manual overrides today</p>
        <p className="text-2xl font-semibold text-black dark:text-white">{manualToday ?? 0}</p>
        <p className="mt-1 text-xs text-zinc-400">
          Manual stamps bypass the QR scan. They’re allowed but capped per staff member
          per day — keep an eye on unusual volume.
        </p>
      </div>

      {history.length === 0 ? (
        <p className="rounded-xl border border-zinc-200 p-6 text-center text-sm text-zinc-500 dark:border-zinc-800">
          No transactions yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {history.map((row) => {
            const reason = describeReason(row.manual_reason)
            return (
              <li
                key={row.id}
                className={
                  row.is_manual
                    ? 'flex flex-col gap-1 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40'
                    : 'flex flex-col gap-1 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800'
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-black dark:text-white">
                    {row.is_manual ? (
                      <span className="mr-2 rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-800 dark:text-amber-100">
                        Manual
                      </span>
                    ) : (
                      <span className="mr-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        Scan
                      </span>
                    )}
                    Customer {shortCode(row.customer_id)}
                  </span>
                  <time className="shrink-0 text-xs text-zinc-500">
                    {new Date(row.created_at).toLocaleString()}
                  </time>
                </div>

                {row.is_manual && (
                  <p className="text-xs text-amber-800 dark:text-amber-200">
                    {reason.label}
                    {reason.note ? ` — “${reason.note}”` : ''} · by{' '}
                    {row.acting_staff?.name ?? 'unknown staff'}
                  </p>
                )}

                {row.amount != null && (
                  <p className="text-xs text-zinc-500">Amount: {row.amount.toFixed(2)}</p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
