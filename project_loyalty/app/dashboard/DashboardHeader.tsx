'use client'

import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { useTranslations } from '@/lib/i18n/I18nProvider'

type Props =
  | { kind: 'auth'; identity: string }
  | { kind: 'anon' }
  | { kind: 'none' }

export function DashboardHeader({ variant }: { variant: Props }) {
  const t = useTranslations('customerDashboard')
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
    <div className="flex items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{t('yourCards')}</h1>

      <div className="flex items-center gap-2">
        <LanguageSwitcher />

        {variant.kind === 'auth' && (
          <div className="flex items-center gap-3">
            <span className="max-w-[140px] truncate text-sm text-gray-500">{variant.identity}</span>
            <button
              onClick={handleSignOut}
              disabled={pending}
              className="text-sm text-gray-400 underline underline-offset-2 disabled:opacity-50"
            >
              {tc('signOut')}
            </button>
          </div>
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
  )
}
