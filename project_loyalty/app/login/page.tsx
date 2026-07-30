'use client'

import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { GoogleSignInButton } from '@/components/GoogleSignInButton'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { useTranslations } from '@/lib/i18n/I18nProvider'

type Step = 'input' | 'otp'

function makeClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}

export default function LoginPage() {
  const t = useTranslations('customerAuth')
  const tc = useTranslations('common')
  const [step, setStep] = useState<Step>('input')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    const { error } = await makeClient().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    })
    setPending(false)
    if (error) { setError(error.message); return }
    setStep('otp')
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    const { error } = await makeClient().auth.verifyOtp({
      email,
      token: otp,
      type: 'email',
    })
    setPending(false)
    if (error) { setError(error.message); return }
    window.location.href = '/auth/complete'
  }

  return (
    <main className="min-h-dvh flex flex-col bg-white">
      <div className="flex justify-end p-4">
        <LanguageSwitcher />
      </div>
      <div className="flex flex-1 items-center justify-center px-6 pb-10">
        <div className="w-full max-w-sm flex flex-col gap-8">

          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{t('loginTitle')}</h1>
            <p className="text-sm text-gray-500">{t('loginSubtitle')}</p>
          </div>

          <GoogleSignInButton />

          <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-gray-400">
            <span className="h-px flex-1 bg-gray-200" />
            {tc('or')}
            <span className="h-px flex-1 bg-gray-200" />
          </div>

          {step === 'input' && (
            <form onSubmit={sendCode} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                {tc('emailAddress')}
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="h-12 rounded-lg border border-gray-300 px-4 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </label>
              {error && (
                <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
              )}
              <button
                type="submit"
                disabled={pending}
                className="h-14 w-full rounded-lg bg-gray-900 text-base font-semibold text-white disabled:opacity-60"
              >
                {pending ? tc('sending') : tc('sendCode')}
              </button>
            </form>
          )}

          {step === 'otp' && (
            <form onSubmit={verifyCode} className="flex flex-col gap-4">
              <p className="text-sm text-gray-500">{t('otpSentEmail', { email })}</p>
              <a
                href="http://localhost:54324"
                target="_blank"
                rel="noreferrer"
                className="text-sm text-gray-500 underline"
              >
                {t('otpTestingHint')}
              </a>
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                {tc('verificationCode')}
                <input
                  type="text"
                  inputMode="numeric"
                  value={otp}
                  onChange={e => setOtp(e.target.value)}
                  required
                  maxLength={6}
                  placeholder="123456"
                  className="h-12 rounded-lg border border-gray-300 px-4 text-base text-gray-900 tracking-widest focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </label>
              {error && (
                <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
              )}
              <button
                type="submit"
                disabled={pending}
                className="h-14 w-full rounded-lg bg-gray-900 text-base font-semibold text-white disabled:opacity-60"
              >
                {pending ? tc('verifying') : tc('verifyCode')}
              </button>
              <button
                type="button"
                onClick={() => { setStep('input'); setOtp(''); setError(null) }}
                className="text-sm text-gray-400 underline underline-offset-2"
              >
                {t('useDifferentEmail')}
              </button>
            </form>
          )}

          <p className="text-center text-sm text-gray-400">
            {t('noAccount')}{' '}
            <a href="/signup" className="text-gray-900 underline underline-offset-2">{t('createOne')}</a>
          </p>

        </div>
      </div>
    </main>
  )
}
