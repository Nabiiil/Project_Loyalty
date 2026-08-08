import { createClient } from '@/lib/supabase/server'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { getTranslations } from '@/lib/i18n/server'
import { ProfileForm } from './ProfileForm'

/**
 * Optional customer profile.
 *
 * Two states, decided purely by whether there is a Supabase Auth session:
 *
 * - Claimed (authenticated): the form, plus the account they signed up with as
 *   read-only context so they know which account they are looking at. Changing
 *   that email/phone is an auth-level change with verification consequences and
 *   is intentionally not offered here.
 * - Anonymous (device-token only, or signed out): no form at all, just a short
 *   note and a link into the EXISTING signup flow. There is no second signup
 *   path here, and no nagging — an anonymous customer's stamps work perfectly
 *   well without ever visiting this page.
 *
 * The customer row is read through the customer's own session, so the same
 * `customer_select_own_row` policy that protects everyone else's profile is
 * what scopes this read.
 */
export default async function ProfilePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const t = await getTranslations('customerProfile')
  const tc = await getTranslations('common')

  if (!user) {
    return (
      <main className="min-h-dvh bg-white px-5 py-10">
        <div className="mx-auto flex max-w-sm flex-col gap-6">
          <Header title={t('title')} />
          <div className="flex flex-col gap-4 rounded-2xl border border-gray-100 p-8 text-center shadow-sm">
            <p className="text-lg font-semibold text-gray-900">{t('notSignedInTitle')}</p>
            <p className="text-sm text-gray-500">{t('notSignedInBody')}</p>
            <div className="mt-2 flex flex-col gap-2">
              <a
                href="/signup"
                className="flex h-12 items-center justify-center rounded-lg bg-gray-900 text-sm font-semibold text-white"
              >
                {tc('createAccount')}
              </a>
              <a
                href="/dashboard"
                className="flex h-12 items-center justify-center rounded-lg border border-gray-200 text-sm font-medium text-gray-700"
              >
                {t('backToCards')}
              </a>
            </div>
          </div>
        </div>
      </main>
    )
  }

  const { data: customer } = await supabase
    .from('customers')
    .select('display_name')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  // Whichever identity they actually signed up with — shown, never editable.
  const identity = user.email ?? user.phone ?? null

  return (
    <main className="min-h-dvh bg-white px-5 py-10">
      <div className="mx-auto flex max-w-sm flex-col gap-6">
        <Header title={t('title')} />
        <p className="text-sm text-gray-500">{t('subtitle')}</p>

        <ProfileForm initialDisplayName={customer?.display_name ?? null} />

        <section className="flex flex-col gap-1.5 border-t border-gray-100 pt-6">
          <h2 className="text-sm font-medium text-gray-700">{t('accountSection')}</h2>
          {identity && (
            <p className="text-base text-gray-900 break-all">
              {/* Emails and phone numbers are LTR runs; isolate them so an
                  Arabic layout doesn't reorder the @ or the leading +. */}
              <bdi>{identity}</bdi>
            </p>
          )}
          <p className="text-xs text-gray-500">{t('accountHint')}</p>
        </section>

        <a
          href="/dashboard"
          className="text-sm text-gray-500 underline underline-offset-2 text-start"
        >
          {t('backToCards')}
        </a>
      </div>
    </main>
  )
}

function Header({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{title}</h1>
      <LanguageSwitcher />
    </div>
  )
}
