import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { EnrollmentCard } from './EnrollmentCard'
import { DashboardHeader } from './DashboardHeader'
import { NamePrompt } from './NamePrompt'
import { SignupInvite } from '@/components/SignupInvite'
import { customerDashboardOutcome } from '@/lib/auth-guards'
import { NAME_PROMPT_PARAM } from '@/lib/profile'
import { getTranslations } from '@/lib/i18n/server'

export type EnrollmentRow = {
  id: string
  current_stamps: number
  business_id: string
  businesses: {
    name: string
    reward_threshold: number
    reward_description: string
    logo_url: string | null
    brand_color: string | null
  } | null
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const cookieStore = await cookies()
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  const deviceToken = cookieStore.get('device_token')?.value ?? null
  const params = await searchParams

  const service = createServiceClient()

  // Resolve customer ID — auth session takes priority
  let customerId: string | null = null
  // Only ever set for an authenticated customer: anonymous rows have no profile
  // (the column is unwritable without a session) and no profile entry point.
  let displayName: string | null = null
  if (user) {
    const { data } = await service
      .from('customers')
      .select('id, display_name')
      .eq('auth_user_id', user.id)
      .maybeSingle()
    customerId = data?.id ?? null
    displayName = data?.display_name ?? null
  } else if (deviceToken) {
    const { data } = await service
      .from('customers')
      .select('id')
      .eq('device_token', deviceToken)
      .maybeSingle()
    customerId = data?.id ?? null
  }

  const enrollments: EnrollmentRow[] = customerId
    ? ((await service
        .from('enrollments')
        .select(
          'id, current_stamps, business_id, businesses(name, reward_threshold, reward_description, logo_url, brand_color)',
        )
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
      ).data ?? []) as EnrollmentRow[]
    : []

  // The invitation to add a name. Three conditions, all required: the server
  // flagged this navigation as coming straight out of a signup, the customer is
  // authenticated, and they genuinely have no name yet (so a Google prefill or
  // a re-shared URL never triggers it).
  const showNamePrompt =
    params[NAME_PROMPT_PARAM] === '1' && !!user && displayName === null

  const userIdentity = user?.email ?? user?.phone ?? null
  const headerVariant = userIdentity
    ? ({ kind: 'auth', identity: userIdentity, displayName } as const)
    : deviceToken
      ? ({ kind: 'anon' } as const)
      : ({ kind: 'none' } as const)

  // Reverse of the staff guard: an authenticated user who is not a customer
  // (no enrollments / no customer row) is rendered here, never redirected — so
  // this page can't mirror the staff login loop. See lib/auth-guards.
  const outcome = customerDashboardOutcome({
    hasSession: !!user,
    hasDeviceToken: !!deviceToken,
    hasEnrollments: enrollments.length > 0,
  })

  const t = await getTranslations('customerDashboard')
  const tc = await getTranslations('common')

  if (outcome === 'render-signed-out') {
    return (
      <main className="min-h-dvh bg-white px-5 py-10">
        <div className="mx-auto max-w-sm flex flex-col gap-6">
          <DashboardHeader variant={headerVariant} />
          <div className="rounded-2xl border border-gray-100 p-8 text-center flex flex-col gap-4 shadow-sm">
            <p className="text-4xl">☕</p>
            <p className="text-lg font-semibold text-gray-900">{t('emptyTitle')}</p>
            <p className="text-sm text-gray-500">{t('coldBody')}</p>
            <div className="flex flex-col gap-2 mt-2">
              <a
                href="/signup"
                className="h-12 flex items-center justify-center rounded-lg bg-gray-900 text-sm font-semibold text-white"
              >
                {tc('createAccount')}
              </a>
              <a
                href="/login"
                className="h-12 flex items-center justify-center rounded-lg border border-gray-200 text-sm font-medium text-gray-700"
              >
                {tc('signIn')}
              </a>
            </div>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-dvh bg-white">
      {/* Persistent, benefit-led signup invite. Self-hides once authenticated. */}
      <SignupInvite />
      <div className="px-5 py-10">
      <div className="mx-auto max-w-sm flex flex-col gap-6">
        <DashboardHeader variant={headerVariant} />

        {/* Shown only on the single navigation out of a signup that produced no
            name — never on a later visit, and never when Google supplied one.
            The component itself also honours a previous skip. */}
        {showNamePrompt && <NamePrompt />}

        {customerId && (
          <div className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3">
            <span className="text-xs text-gray-500">
              {t('yourCode')}
              <span className="block text-[11px] text-gray-400">{t('yourCodeHint')}</span>
            </span>
            <span className="font-mono text-base font-semibold tracking-widest text-gray-900">
              {customerId.slice(0, 8).toUpperCase()}
            </span>
          </div>
        )}

        {outcome === 'render-empty' ? (
          <div className="rounded-2xl border border-gray-100 p-8 text-center flex flex-col gap-2 shadow-sm">
            <p className="text-lg font-semibold text-gray-900">{t('emptyTitle')}</p>
            <p className="text-sm text-gray-500">{t('emptyScan')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {enrollments.map((e) => (
              <EnrollmentCard key={e.id} enrollment={e} isClaimed={!!user} />
            ))}
          </div>
        )}
      </div>
      </div>
    </main>
  )
}
