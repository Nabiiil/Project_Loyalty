import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createStaffClient } from '@/lib/supabase/staff-server'
import { getTranslations } from '@/lib/i18n/server'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

// ─── Contact ────────────────────────────────────────────────────────────────
// There is no self-serve signup yet — pilot cafés are onboarded personally — so
// the trial CTA opens a WhatsApp chat rather than a broken signup flow.
// TODO(launch): replace the placeholder with the real business WhatsApp number,
// in international format, digits only, no leading '+'. e.g. '212612345678'.
const WHATSAPP_NUMBER = '212639380195'

// The business login is deliberately the staff route — never the customer login.
const STAFF_LOGIN_HREF = '/staff/login'

// Computed at module load (not during render) so it stays a pure component.
const FOOTER_YEAR = new Date().getFullYear()

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('landing')
  return { title: t('metaTitle'), description: t('metaDescription') }
}

const STEP_KEYS = [1, 2, 3] as const

const BENEFIT_KEYS = [
  { icon: '🔁', title: 'whyRepeatTitle', body: 'whyRepeatBody' },
  { icon: '📱', title: 'whyDownloadTitle', body: 'whyDownloadBody' },
  { icon: '🛠️', title: 'whyHardwareTitle', body: 'whyHardwareBody' },
  { icon: '⚡', title: 'whySetupTitle', body: 'whySetupBody' },
] as const

export default async function LandingPage() {
  // Public marketing page. The only auth touch is a lightweight staff-session
  // check so a signed-in owner skips the pitch and lands on their dashboard.
  // No business or customer data is queried here (guardrail). If auth is
  // unreachable, fail open to the public page rather than 500 the site root —
  // and keep redirect() OUTSIDE the try so its control-flow throw isn't caught.
  let hasStaffSession = false
  try {
    const supabase = await createStaffClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    hasStaffSession = !!user
  } catch {
    hasStaffSession = false
  }
  if (hasStaffSession) {
    redirect('/staff/dashboard')
  }

  const t = await getTranslations('landing')
  const tc = await getTranslations('common')
  const trialHref = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(t('whatsappMessage'))}`

  return (
    <div className="flex min-h-dvh flex-col bg-white text-gray-900 dark:bg-zinc-950 dark:text-zinc-50">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-gray-100 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
          <span className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-900 text-base dark:bg-white">
              ☕
            </span>
            {tc('brand')}
          </span>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <a
              href={STAFF_LOGIN_HREF}
              className="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              {tc('businessLogin')}
            </a>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="px-5 pt-16 pb-14 sm:pt-24 sm:pb-20">
          <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
            <span className="mb-5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              {t('badge')}
            </span>
            <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              {t('heroTitle')}
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-gray-600 dark:text-zinc-400">
              {t('heroSubtitle')}
            </p>
            <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <a
                href={STAFF_LOGIN_HREF}
                className="flex h-14 items-center justify-center rounded-xl bg-gray-900 px-7 text-base font-semibold text-white transition-colors hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-zinc-200"
              >
                {tc('businessLogin')}
              </a>
              <a
                href={trialHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-14 items-center justify-center rounded-xl border border-gray-300 px-7 text-base font-semibold text-gray-900 transition-colors hover:bg-gray-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900"
              >
                {t('startTrial')}
              </a>
            </div>
            <p className="mt-4 text-sm text-gray-500 dark:text-zinc-500">{t('heroReassure')}</p>
          </div>
        </section>

        {/* How it works */}
        <section className="bg-amber-50/50 px-5 py-16 dark:bg-zinc-900/50">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
              {t('howTitle')}
            </h2>
            <ol className="mt-10 grid gap-6 sm:grid-cols-3">
              {STEP_KEYS.map((n) => (
                <li
                  key={n}
                  className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-900 text-sm font-bold text-white dark:bg-white dark:text-gray-900">
                    {n}
                  </span>
                  <h3 className="text-lg font-semibold">{t(`step${n}Title`)}</h3>
                  <p className="text-sm leading-relaxed text-gray-600 dark:text-zinc-400">
                    {t(`step${n}Body`)}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Why it helps */}
        <section className="px-5 py-16">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
              {t('whyTitle')}
            </h2>
            <div className="mt-10 grid gap-5 sm:grid-cols-2">
              {BENEFIT_KEYS.map((b) => (
                <div
                  key={b.title}
                  className="flex gap-4 rounded-2xl border border-gray-100 p-6 dark:border-zinc-800"
                >
                  <span className="text-2xl" aria-hidden>
                    {b.icon}
                  </span>
                  <div className="flex flex-col gap-1">
                    <h3 className="text-base font-semibold">{t(b.title)}</h3>
                    <p className="text-sm leading-relaxed text-gray-600 dark:text-zinc-400">
                      {t(b.body)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing / trial */}
        <section className="px-5 pb-20">
          <div className="mx-auto max-w-2xl rounded-3xl border border-gray-100 bg-gray-900 px-6 py-12 text-center text-white dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('pricingTitle')}</h2>
            <p className="mx-auto mt-4 max-w-lg leading-relaxed text-gray-300 dark:text-zinc-400">
              {t('pricingBody')}
            </p>
            <a
              href={trialHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-8 inline-flex h-14 items-center justify-center rounded-xl bg-white px-8 text-base font-semibold text-gray-900 transition-colors hover:bg-gray-100"
            >
              {t('startTrial')}
            </a>
            <p className="mt-3 text-sm text-gray-400 dark:text-zinc-500">{t('pricingNote')}</p>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 px-5 py-8 dark:border-zinc-800">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 text-sm text-gray-500 dark:text-zinc-500 sm:flex-row">
          <span>{t('footerRights', { year: FOOTER_YEAR })}</span>
          <a
            href={STAFF_LOGIN_HREF}
            className="font-medium text-gray-700 hover:underline dark:text-zinc-300"
          >
            {tc('businessLogin')}
          </a>
        </div>
      </footer>
    </div>
  )
}
