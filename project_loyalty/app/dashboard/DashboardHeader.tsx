'use client'

import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { useTranslations } from '@/lib/i18n/I18nProvider'

type Props =
  // `displayName` is the one reader of customers.display_name: when a customer
  // has set a name, the header greets them by it instead of by their email.
  // That is the concrete use the column was added for.
  | { kind: 'auth'; identity: string; displayName: string | null }
  | { kind: 'anon' }
  | { kind: 'none' }

export function DashboardHeader({ variant }: { variant: Props }) {
  const t = useTranslations('customerDashboard')
  const tp = useTranslations('customerProfile')
  const tc = useTranslations('common')
  const [pending, setPending] = useState(false)

  async function handleSignOut() {
    setPending(true)
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
    await supabase.auth.signOut({ scope: 'local' })
    window.location.href = '/dashboard'
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{t('yourCards')}</h1>

        <div className="flex items-center gap-2">
          <LanguageSwitcher />

          {variant.kind === 'auth' && (
            <button
              onClick={handleSignOut}
              disabled={pending}
              className="text-sm text-gray-400 underline underline-offset-2 disabled:opacity-50"
            >
              {tc('signOut')}
            </button>
          )}

          {(variant.kind === 'anon' || variant.kind === 'none') && (
            <div className="flex items-center gap-3">
              <a href="/login" className="text-sm text-gray-500 underline underline-offset-2">
                {tc('signIn')}
              </a>
              <a
                href="/signup"
                className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white"
              >
                {tc('signUp')}
              </a>
            </div>
          )}
        </div>
      </div>

      {/* The profile entry point. Previously this was the email address itself,
          which read as incidental text rather than a way in. It is now a
          labelled row that looks like navigation: an explicit "Profile" label,
          the account as secondary context, and a chevron. Still no badge or
          completeness nudge — discoverable, not insistent. */}
      {variant.kind === 'auth' && (
        <a
          href="/dashboard/profile"
          className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 px-4 py-3"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="text-base" aria-hidden>
              👤
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-medium text-gray-900">{tp('title')}</span>
              {/* The name once they have one, the account identifier until then.
                  bdi keeps an email or +212… from reordering in Arabic. */}
              <span className="truncate text-xs text-gray-500">
                <bdi>{variant.displayName ?? variant.identity}</bdi>
              </span>
            </span>
          </span>
          <span className="shrink-0 text-gray-400 rtl:rotate-180" aria-hidden>
            ›
          </span>
        </a>
      )}
    </div>
  )
}
