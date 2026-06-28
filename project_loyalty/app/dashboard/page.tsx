import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { EnrollmentCard } from './EnrollmentCard'
import { DashboardHeader } from './DashboardHeader'

export type EnrollmentRow = {
  id: string
  current_stamps: number
  business_id: string
  businesses: { name: string; reward_threshold: number } | null
}

export default async function DashboardPage() {
  const cookieStore = await cookies()
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  const deviceToken = cookieStore.get('device_token')?.value ?? null

  const service = createServiceClient()

  // Resolve customer ID — auth session takes priority
  let customerId: string | null = null
  if (user) {
    const { data } = await service
      .from('customers')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle()
    customerId = data?.id ?? null
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
        .select('id, current_stamps, business_id, businesses(name, reward_threshold)')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
      ).data ?? []) as EnrollmentRow[]
    : []

  const userIdentity = user?.email ?? user?.phone ?? null
  const headerVariant = userIdentity
    ? ({ kind: 'auth', identity: userIdentity } as const)
    : deviceToken
      ? ({ kind: 'anon' } as const)
      : ({ kind: 'none' } as const)

  if (!user && !deviceToken) {
    return (
      <main className="min-h-dvh bg-white px-5 py-10">
        <div className="mx-auto max-w-sm flex flex-col gap-6">
          <DashboardHeader variant={headerVariant} />
          <div className="rounded-2xl border border-gray-100 p-8 text-center flex flex-col gap-4 shadow-sm">
            <p className="text-4xl">☕</p>
            <p className="text-lg font-semibold text-gray-900">No stamps yet</p>
            <p className="text-sm text-gray-500">
              Scan a QR code at a participating business to earn your first stamp — or create an account now.
            </p>
            <div className="flex flex-col gap-2 mt-2">
              <a
                href="/signup"
                className="h-12 flex items-center justify-center rounded-lg bg-gray-900 text-sm font-semibold text-white"
              >
                Create account
              </a>
              <a
                href="/login"
                className="h-12 flex items-center justify-center rounded-lg border border-gray-200 text-sm font-medium text-gray-700"
              >
                Sign in
              </a>
            </div>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-dvh bg-white px-5 py-10">
      <div className="mx-auto max-w-sm flex flex-col gap-6">
        <DashboardHeader variant={headerVariant} />

        {/* Claim banner — anonymous users who already have stamps */}
        {!user && deviceToken && enrollments.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex flex-col gap-1">
            <p className="text-sm font-semibold text-amber-900">Your stamps aren't saved yet</p>
            <p className="text-xs text-amber-700">
              Create an account so you never lose them if you clear your browser or switch devices.
            </p>
            <a
              href="/signup"
              className="mt-1 text-sm font-semibold text-amber-900 underline underline-offset-2"
            >
              Create account →
            </a>
          </div>
        )}

        {enrollments.length === 0 ? (
          <div className="rounded-2xl border border-gray-100 p-8 text-center flex flex-col gap-2 shadow-sm">
            <p className="text-lg font-semibold text-gray-900">No stamps yet</p>
            <p className="text-sm text-gray-500">
              Scan a QR code at a participating business to get started.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {enrollments.map((e) => (
              <EnrollmentCard key={e.id} enrollment={e} />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
