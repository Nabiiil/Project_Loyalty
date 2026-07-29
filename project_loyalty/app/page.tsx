import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createStaffClient } from '@/lib/supabase/staff-server'

// ─── Contact ────────────────────────────────────────────────────────────────
// There is no self-serve signup yet — pilot cafés are onboarded personally — so
// the trial CTA opens a WhatsApp chat rather than a broken signup flow.
// TODO(launch): replace the placeholder with the real business WhatsApp number,
// in international format, digits only, no leading '+'. e.g. '212612345678'.
const WHATSAPP_NUMBER = '212639380195'
const WHATSAPP_MESSAGE =
  'Hi! I run a café / shop and I’d like to try the loyalty program for my business.'
const TRIAL_HREF = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`

// The business login is deliberately the staff route — never the customer login.
const STAFF_LOGIN_HREF = '/staff/login'

// Computed at module load (not during render) so it stays a pure component.
const FOOTER_YEAR = new Date().getFullYear()

export const metadata: Metadata = {
  title: 'Turn first-time customers into regulars — loyalty with no app, no hardware',
  description:
    'A simple stamp-card loyalty program for cafés, restaurants and shops. Customers join by scanning a code at your counter — no app, no sign-up forms, no new hardware. Start with a free trial.',
}

const STEPS = [
  {
    title: 'Show the code',
    body: 'Your staff taps once and shows a QR code at checkout — on the tablet you already have.',
  },
  {
    title: 'Customer scans',
    body: 'They scan with their phone camera. No app to install, no account to create. Their visit is counted instantly.',
  },
  {
    title: 'They come back',
    body: 'Every visit earns a stamp. When they hit the goal, they get their reward — and a reason to keep choosing you.',
  },
] as const

const BENEFITS = [
  {
    icon: '🔁',
    title: 'Built for repeat business',
    body: 'Loyalty programs turn one-time visitors into regulars. This one runs itself.',
  },
  {
    icon: '📱',
    title: 'Nothing for customers to download',
    body: 'The number one reason loyalty programs fail is friction. Scanning a code takes five seconds — no app, no forms.',
  },
  {
    icon: '🛠️',
    title: 'Works on what you already own',
    body: 'If you have a tablet or phone at the counter, you’re ready. No new hardware to buy.',
  },
  {
    icon: '⚡',
    title: 'Set up in minutes',
    body: 'We get you running quickly, and your staff needs about thirty seconds of training.',
  },
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

  return (
    <div className="flex min-h-dvh flex-col bg-white text-gray-900 dark:bg-zinc-950 dark:text-zinc-50">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-gray-100 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
          <span className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-900 text-base dark:bg-white">
              ☕
            </span>
            Loyalty
          </span>
          <a
            href={STAFF_LOGIN_HREF}
            className="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Business login
          </a>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="px-5 pt-16 pb-14 sm:pt-24 sm:pb-20">
          <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
            <span className="mb-5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              Loyalty for cafés, restaurants & shops
            </span>
            <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              Turn first-time customers into regulars.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-gray-600 dark:text-zinc-400">
              Give your customers a reason to come back — a simple stamp card they join by
              scanning a code at your counter. No app to download, no sign-up forms, no new
              hardware.
            </p>
            <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <a
                href={STAFF_LOGIN_HREF}
                className="flex h-14 items-center justify-center rounded-xl bg-gray-900 px-7 text-base font-semibold text-white transition-colors hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-zinc-200"
              >
                Business login
              </a>
              <a
                href={TRIAL_HREF}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-14 items-center justify-center rounded-xl border border-gray-300 px-7 text-base font-semibold text-gray-900 transition-colors hover:bg-gray-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900"
              >
                Start a free trial
              </a>
            </div>
            <p className="mt-4 text-sm text-gray-500 dark:text-zinc-500">
              No app · No new hardware · Set up in minutes
            </p>
          </div>
        </section>

        {/* How it works */}
        <section className="bg-amber-50/50 px-5 py-16 dark:bg-zinc-900/50">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
              How it works
            </h2>
            <ol className="mt-10 grid gap-6 sm:grid-cols-3">
              {STEPS.map((step, i) => (
                <li
                  key={step.title}
                  className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-900 text-sm font-bold text-white dark:bg-white dark:text-gray-900">
                    {i + 1}
                  </span>
                  <h3 className="text-lg font-semibold">{step.title}</h3>
                  <p className="text-sm leading-relaxed text-gray-600 dark:text-zinc-400">
                    {step.body}
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
              Why owners choose it
            </h2>
            <div className="mt-10 grid gap-5 sm:grid-cols-2">
              {BENEFITS.map((b) => (
                <div
                  key={b.title}
                  className="flex gap-4 rounded-2xl border border-gray-100 p-6 dark:border-zinc-800"
                >
                  <span className="text-2xl" aria-hidden>
                    {b.icon}
                  </span>
                  <div className="flex flex-col gap-1">
                    <h3 className="text-base font-semibold">{b.title}</h3>
                    <p className="text-sm leading-relaxed text-gray-600 dark:text-zinc-400">
                      {b.body}
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
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Start free. Pay only if it works for you.
            </h2>
            <p className="mx-auto mt-4 max-w-lg leading-relaxed text-gray-300 dark:text-zinc-400">
              Try it with your customers at no cost. Once you see regulars coming back, keep going
              with a simple monthly subscription — no long contracts, no setup fees. We’ll help you
              get started personally.
            </p>
            <a
              href={TRIAL_HREF}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-8 inline-flex h-14 items-center justify-center rounded-xl bg-white px-8 text-base font-semibold text-gray-900 transition-colors hover:bg-gray-100"
            >
              Start a free trial
            </a>
            <p className="mt-3 text-sm text-gray-400 dark:text-zinc-500">
              We’ll set you up personally — no automated signup.
            </p>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 px-5 py-8 dark:border-zinc-800">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 text-sm text-gray-500 dark:text-zinc-500 sm:flex-row">
          <span>© {FOOTER_YEAR} Digiterra</span>
          <a href={STAFF_LOGIN_HREF} className="font-medium text-gray-700 hover:underline dark:text-zinc-300">
            Business login
          </a>
        </div>
      </footer>
    </div>
  )
}
