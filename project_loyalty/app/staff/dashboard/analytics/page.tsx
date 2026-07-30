import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createStaffClient } from '@/lib/supabase/staff-server'
import { getTranslations } from '@/lib/i18n/server'
import { NewVsReturningChart, type DayPoint } from './NewVsReturningChart'

/**
 * Owner-only analytics — answers one question: is the loyalty program bringing
 * customers back (i.e. making money)? Only retention signals, deliberately NO
 * total-scan vanity counter. Every number is aggregated in SQL by
 * get_owner_analytics(), which is itself owner-gated and scoped to the caller's
 * own business; this page adds the route-level owner gate. The 30/90-day toggle
 * is a plain link (no client JS), matching the PWA constraints.
 */

type Analytics = {
  ok: boolean
  days: number
  enrolled_customers: number
  repeat_visit_rate: number
  new_vs_returning: DayPoint[]
  redemptions_issued: number
  redemptions_verified: number
  avg_days_between_visits: number | null
}

export default async function StaffAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>
}) {
  const supabase = await createStaffClient()
  const t = await getTranslations('analytics')

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

  const days = (await searchParams).days === '90' ? 90 : 30

  const { data, error } = await supabase.rpc('get_owner_analytics', { p_days: days })
  const a = data as unknown as Analytics | null

  if (error || !a?.ok) {
    return (
      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-white">{t('title')}</h1>
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {t('loadError')}
        </p>
      </section>
    )
  }

  const verifyPct =
    a.redemptions_issued > 0
      ? Math.round((a.redemptions_verified / a.redemptions_issued) * 100)
      : null

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-white">{t('title')}</h1>
        <div className="flex overflow-hidden rounded-lg border border-zinc-300 text-sm dark:border-zinc-700">
          {[30, 90].map((d) => (
            <Link
              key={d}
              href={`/staff/dashboard/analytics?days=${d}`}
              aria-current={days === d ? 'page' : undefined}
              className={
                days === d
                  ? 'bg-zinc-900 px-3 py-1.5 font-semibold text-white dark:bg-white dark:text-black'
                  : 'px-3 py-1.5 text-zinc-600 dark:text-zinc-300'
              }
            >
              {d}
            </Link>
          ))}
        </div>
      </div>

      <p className="-mt-2 text-sm text-zinc-500">{t('subtitle', { days })}</p>

      {/* Retention stat tiles */}
      <div className="grid grid-cols-2 gap-3">
        <StatTile
          label={t('repeatRate')}
          value={a.repeat_visit_rate.toFixed(1)}
          sub={t('repeatRateSub', { count: a.enrolled_customers })}
        />
        <StatTile
          label={t('avgTime')}
          value={a.avg_days_between_visits == null ? '—' : `${a.avg_days_between_visits}`}
          sub={a.avg_days_between_visits == null ? t('avgTimeNeed') : t('avgTimeSub')}
        />
        <StatTile
          label={t('rewardsRedeemed')}
          value={`${a.redemptions_verified} / ${a.redemptions_issued}`}
          sub={verifyPct == null ? t('rewardsSubEmpty') : t('rewardsSub', { pct: verifyPct })}
        />
        <StatTile
          label={t('enrolled')}
          value={`${a.enrolled_customers}`}
          sub={t('enrolledSub')}
        />
      </div>

      {/* New vs returning over time */}
      <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t('chartTitle')}</h2>
        {a.new_vs_returning.some((p) => p.new + p.returning > 0) ? (
          <NewVsReturningChart series={a.new_vs_returning} />
        ) : (
          <p className="py-6 text-center text-sm text-zinc-400">{t('noVisits')}</p>
        )}
      </div>
    </section>
  )
}

function StatTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className="text-3xl font-semibold tracking-tight text-black tabular-nums dark:text-white">
        {value}
      </p>
      <p className="text-[11px] leading-tight text-zinc-400">{sub}</p>
    </div>
  )
}
