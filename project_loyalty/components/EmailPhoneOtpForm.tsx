'use client'

import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useTranslations } from '@/lib/i18n/I18nProvider'

type Tab = 'email' | 'phone'
type Step = 'input' | 'otp'

function makeClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}

/**
 * Email / phone magic-link + OTP signup, shared by the /signup page and the
 * signup drawer. On successful verification it navigates to /auth/complete,
 * which attaches the identity to the existing device-token customer row,
 * preserving all earned stamps. Offered alongside "Continue with Google", not
 * as a replacement.
 */
export function EmailPhoneOtpForm() {
  const t = useTranslations('customerAuth')
  const tc = useTranslations('common')
  const [tab, setTab] = useState<Tab>('email')
  const [step, setStep] = useState<Step>('input')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function sendEmailOtp(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    const { error } = await makeClient().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    })
    setPending(false)
    if (error) { setError(error.message); return }
    setStep('otp')
  }

  async function verifyEmailOtp(e: React.FormEvent) {
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

  async function sendPhoneOtp(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    const { error } = await makeClient().auth.signInWithOtp({ phone })
    setPending(false)
    if (error) { setError(error.message); return }
    setStep('otp')
  }

  async function verifyPhoneOtp(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    const { error } = await makeClient().auth.verifyOtp({ phone, token: otp, type: 'sms' })
    setPending(false)
    if (error) { setError(error.message); return }
    window.location.href = '/auth/complete'
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Tab toggle */}
      <div className="flex rounded-lg border border-gray-200 p-1 gap-1">
        {(['email', 'phone'] as Tab[]).map((tabKey) => (
          <button
            key={tabKey}
            type="button"
            onClick={() => { setTab(tabKey); setStep('input'); setOtp(''); setError(null) }}
            className={[
              'flex-1 rounded-md py-2 text-sm font-medium transition-colors',
              tab === tabKey ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900',
            ].join(' ')}
          >
            {tabKey === 'email' ? tc('email') : tc('phone')}
          </button>
        ))}
      </div>

      {/* Email — input */}
      {tab === 'email' && step === 'input' && (
        <form onSubmit={sendEmailOtp} className="flex flex-col gap-4">
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
          {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          <button
            type="submit"
            disabled={pending}
            className="h-14 w-full rounded-lg bg-gray-900 text-base font-semibold text-white disabled:opacity-60"
          >
            {pending ? tc('sending') : tc('sendCode')}
          </button>
        </form>
      )}

      {/* Email — OTP */}
      {tab === 'email' && step === 'otp' && (
        <form onSubmit={verifyEmailOtp} className="flex flex-col gap-4">
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
          {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
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

      {/* Phone — input */}
      {tab === 'phone' && step === 'input' && (
        <form onSubmit={sendPhoneOtp} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            {tc('phoneNumber')}
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              required
              autoComplete="tel"
              placeholder="+212612345678"
              dir="ltr"
              className="h-12 rounded-lg border border-gray-300 px-4 text-base text-gray-900 text-start focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </label>
          {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          <button
            type="submit"
            disabled={pending}
            className="h-14 w-full rounded-lg bg-gray-900 text-base font-semibold text-white disabled:opacity-60"
          >
            {pending ? tc('sending') : tc('sendCode')}
          </button>
        </form>
      )}

      {/* Phone — OTP */}
      {tab === 'phone' && step === 'otp' && (
        <form onSubmit={verifyPhoneOtp} className="flex flex-col gap-4">
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
          <p className="text-sm text-gray-500"><bdi>{t('otpSentPhone', { phone })}</bdi></p>
          {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
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
            {t('useDifferentNumber')}
          </button>
        </form>
      )}
    </div>
  )
}
