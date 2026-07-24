import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createStaffClient } from '@/lib/supabase/staff-server'

/**
 * Owner-only history log — the dispute-resolution tool. A reverse-chronological
 * table of this business's scanned transactions AND redemptions, date-range
 * filterable, with manual overrides clearly badged. The union, ordering and
 * pagination all happen in SQL (get_business_history), which is itself
 * owner-gated and scoped to the caller's own business; this page adds the
 * route-level owner gate. Counter staff who reach this URL are bounced.
 */

const RANGES = [
  { key: '7', label: '7d', days: 7 },
  { key: '30', label: '30d', days: 30 },
  { key: '90', label: '90d', days: 90 },
  { key: 'all', label: 'All', days: null },
] as const

const MANUAL_REASON_LABELS: Record<string, string> = {
  qr_failed: 'QR wouldn’t scan',
  phone_dead: 'Phone dead / no phone',
  staff_error: 'Staff error',
  other: 'Other',
}

function manualDetail(detail: string | null): string {
  if (!detail) return 'Manual stamp'
  const idx = detail.indexOf(':')
  const category = (idx === -1 ? detail : detail.slice(0, idx)).trim()
  const note = idx === -1 ? '' : detail.slice(idx + 1).trim()
  const label = MANUAL_REASON_LABELS[category] ?? category
  return note ? `${label} — “${note}”` : label
}

type Kind = 'scan' | 'manual' | 'redemption'
type HistoryRow = {
  event_id: string
  event_time: string
  kind: Kind
  customer_code: string | null
  staff_name: string | null
  detail: string | null
  amount: number | null
}
type HistoryResult = { ok: boolean; total: number; rows: HistoryRow[] }

export default async function StaffHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>
}) {
  const supabase = await createStaffClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/staff/login')
  }

  const { data: staff } = await supabase
    .from('staff_users')
    .select('role')
    .eq('auth_user_id', user.id)
    .single()
  if (!staff) {
    redirect('/staff/login')
  }
  if (staff.role !== 'owner') {
    redirect('/staff/dashboard')
  }

  const rangeKey = (await searchParams).range ?? '30'
  const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[1]
  // Request-time "now" in an async server component (this render already does
  // request-time I/O below); the window start is intentionally per-request.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now()
  const from = range.days == null ? null : new Date(nowMs - range.days * 86_400_000).toISOString()

  const { data, error } = await supabase.rpc('get_business_history', {
    p_from: from ?? undefined,
    p_limit: 200,
    p_offset: 0,
  })
  const result = data as unknown as HistoryResult | null
  const rows = result?.rows ?? []

  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-white">History</h1>
        <div className="flex overflow-hidden rounded-lg border border-zinc-300 text-sm dark:border-zinc-700">
          {RANGES.map((r) => (
            <Link
              key={r.key}
              href={`/staff/dashboard/history?range=${r.key}`}
              aria-current={r.key === range.key ? 'page' : undefined}
              className={
                r.key === range.key
                  ? 'bg-zinc-900 px-2.5 py-1.5 font-semibold text-white dark:bg-white dark:text-black'
                  : 'px-2.5 py-1.5 text-zinc-600 dark:text-zinc-300'
              }
            >
              {r.label}
            </Link>
          ))}
        </div>
      </div>

      <p className="-mt-2 text-sm text-zinc-500">
        {range.days == null ? 'All time' : `Last ${range.days} days`} ·{' '}
        {result?.total ?? 0} events
        {(result?.total ?? 0) > rows.length ? ` (showing ${rows.length})` : ''}
      </p>

      {error || !result?.ok ? (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          Could not load history. Please try again.
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-zinc-200 p-6 text-center text-sm text-zinc-500 dark:border-zinc-800">
          No activity in this range.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.event_id}
                  className={
                    row.kind === 'manual'
                      ? 'border-b border-amber-100 bg-amber-50/60 last:border-0 dark:border-amber-950 dark:bg-amber-950/30'
                      : 'border-b border-zinc-100 last:border-0 dark:border-zinc-800/60'
                  }
                >
                  <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-zinc-500">
                    {new Date(row.event_time).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <TypeBadge kind={row.kind} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300">
                    {row.customer_code ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">
                    {row.kind === 'manual' ? (
                      <span className="text-amber-800 dark:text-amber-200">
                        {manualDetail(row.detail)}
                        {row.staff_name ? ` · by ${row.staff_name}` : ''}
                      </span>
                    ) : row.kind === 'redemption' ? (
                      <span>{row.detail === 'verified' ? 'Reward verified' : 'Code issued'}</span>
                    ) : row.amount != null ? (
                      <span>Amount {row.amount.toFixed(2)}</span>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function TypeBadge({ kind }: { kind: Kind }) {
  const style =
    kind === 'manual'
      ? 'bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100'
      : kind === 'redemption'
        ? 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200'
        : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
  const label = kind === 'manual' ? 'Manual' : kind === 'redemption' ? 'Redemption' : 'Scan'
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${style}`}>
      {label}
    </span>
  )
}
