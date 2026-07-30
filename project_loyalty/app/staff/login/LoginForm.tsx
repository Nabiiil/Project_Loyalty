'use client'

import { useState } from 'react'
import { getStaffClient } from '@/lib/supabase/staff-client'
import { useTranslations } from '@/lib/i18n/I18nProvider'

export function LoginForm() {
  const t = useTranslations('staffAuth')
  const tc = useTranslations('common')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setPending(true)

    const form = new FormData(e.currentTarget)
    const email = form.get('email') as string
    const password = form.get('password') as string

    const { error: authError } = await getStaffClient().auth.signInWithPassword({ email, password })

    if (authError) {
      setError(t('invalidCredentials'))
      setPending(false)
      return
    }

    window.location.href = '/staff/dashboard'
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
        {tc('email')}
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          className="h-12 rounded-lg border border-gray-300 px-4 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
        {tc('password')}
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          className="h-12 rounded-lg border border-gray-300 px-4 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
        />
      </label>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="h-14 w-full rounded-lg bg-gray-900 text-base font-semibold text-white disabled:opacity-60"
      >
        {pending ? t('signingIn') : tc('signIn')}
      </button>
    </form>
  )
}
