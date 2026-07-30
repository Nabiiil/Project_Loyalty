import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createStaffClient } from '@/lib/supabase/staff-server'
import { getTranslations, getLocale } from '@/lib/i18n/server'
import { formatDateTime, formatAmount } from '@/lib/i18n/format'
import type { TranslateFn } from '@/lib/i18n/translate'

/**
 * Owner-only history log — the dispute-resolution tool. A reverse-chronological
 * table of this business's scanned transactions AND redemptions, date-range
 * filterable, with manual overrides clearly badged. The union, ordering and
 * pagination all happen in SQL (get_business_history), which is itself
 * owner-gated and scoped to the caller's own business; this page adds the
 * route-level owner gate. Counter staff who reach this URL are bounced.
 */

const RANGES = [
  { key: '7', days: 7 },
  { key: '30', days: 30 },
  { key: '90', days: 90 },
  { key: 'all', days: null },
] as const

const REASON_CODES = ['qr_failed', 'phone_dead', 'staff_error', 'other']

function manualDetailText(
  detail: string | null,
  staffName: string | null,
  tm: TranslateFn,
  t: TranslateFn,
): string {
  const d = detail ?? ''
  const idx = d.indexOf(':')
  const category = (idx === -1 ? d : d.slice(0, idx)).trim()
  const note = idx === -1 ? '' : d.slice(idx + 1).trim()
  let out = REASON_CODES.includes(category) ? tm(`reasons.${category}`) : category || t('manual')
  if (note) out += ` — “${note}”`
  if (staffName) out += ` · ${t('byStaff', { name: staffName })}`
  return out
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
  const t = await getTranslations('history')
  const tm = await getTranslations('manualStamp')
  const locale = await getLocale()

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
  const total = result?.total ?? 0

  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-white">
          {t('title')}
        </h1>
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
              {r.days == null ? t('rangeAll') : r.days}
            </Link>
          ))}
        </div>
      </div>

      <p className="-mt-2 text-sm text-zinc-500">
        {range.days == null ? t('allTime') : t('lastDays', { days: range.days })} ·{' '}
        {t('eventsCount', { count: total })}
        {total > rows.length ? ` ${t('showingCount', { shown: rows.length })}` : ''}
      </p>

      {error || !result?.ok ? (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {t('loadError')}
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-zinc-200 p-6 text-center text-sm text-zinc-500 dark:border-zinc-800">
          {t('noActivity')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-start text-xs text-zinc-500 dark:border-zinc-800">
                <th className="px-3 py-2 text-start font-medium">{t('when')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('type')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('customer')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('detail')}</th>
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
                    {formatDateTime(row.event_time, locale)}
                  </td>
                  <td className="px-3 py-2">
                    <TypeBadge kind={row.kind} t={t} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300">
                    {row.customer_code ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">
                    {row.kind === 'manual' ? (
                      <span className="text-amber-800 dark:text-amber-200">
                        {manualDetailText(row.detail, row.staff_name, tm, t)}
                      </span>
                    ) : row.kind === 'redemption' ? (
                      <span>{row.detail === 'verified' ? t('rewardVerified') : t('codeIssued')}</span>
                    ) : row.amount != null ? (
                      <span>{t('amount', { amount: formatAmount(row.amount, locale) })}</span>
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

function TypeBadge({ kind, t }: { kind: Kind; t: TranslateFn }) {
  const style =
    kind === 'manual'
      ? 'bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100'
      : kind === 'redemption'
        ? 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200'
        : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${style}`}>
      {t(kind)}
    </span>
  )
}
