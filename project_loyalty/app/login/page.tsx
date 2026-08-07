'use client'

import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { GoogleSignInButton } from '@/components/GoogleSignInButton'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { AuthErrorNotice } from '@/components/AuthErrorNotice'
import { OtpSentNotice } from '@/components/OtpSentNotice'
import {
  isSubmittableEmail,
  mapAuthError,
  shouldShowEmailError,
  type AuthMessageKey,
} from '@/lib/auth-errors'
import { useTranslations } from '@/lib/i18n/I18nProvider'

type Step = 'input' | 'otp'

function makeClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}

/**
 * Customer sign-in. Runs with `shouldCreateUser: false`, so an address with no
 * account behind it comes back as "Signups not allowed for otp" — which used to
 * render verbatim. mapAuthError turns that into "we couldn't find an account",
 * and AuthErrorNotice offers the way onward to signup with the address carried
 * over. See lib/auth-errors.
 */
export default function LoginPage() {
  const t = useTranslations('customerAuth')
  const tc = useTranslations('common')
  const [step, setStep] = useState<Step>('input')
  const [email, setEmail] = useState('')
  const [emailTouched, setEmailTouched] = useState(false)
  const [otp, setOtp] = useState('')
  const [errorKey, setErrorKey] = useState<AuthMessageKey | null>(null)
  const [pending, setPending] = useState(false)

  // The address the code actually went to, so the confirmation stays truthful
  // even if the field behind it is edited.
  const [sentTo, setSentTo] = useState('')

  const showEmailFormatError = shouldShowEmailError(email, emailTouched)
  const canSubmitEmail = isSubmittableEmail(email)

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    const address = email.trim()
    // Backstop for a submit that gets past the disabled button.
    if (!isSubmittableEmail(address)) {
      setEmailTouched(true)
      return
    }
    setErrorKey(null)
    setPending(true)
    const { error } = await makeClient().auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: false },
    })
    setPending(false)
    if (error) {
      setErrorKey(mapAuthError(error, { flow: 'sign-in', channel: 'email', stage: 'send' }))
      return
    }
    setSentTo(address)
    setStep('otp')
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault()
    setErrorKey(null)
    setPending(true)
    const { error } = await makeClient().auth.verifyOtp({
      email: sentTo,
      token: otp,
      type: 'email',
    })
    setPending(false)
    if (error) {
      setErrorKey(mapAuthError(error, { flow: 'sign-in', channel: 'email', stage: 'verify' }))
      return
    }
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
                  onBlur={() => setEmailTouched(true)}
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  aria-invalid={showEmailFormatError}
                  aria-describedby={showEmailFormatError ? 'login-email-error' : undefined}
                  className="h-12 rounded-lg border border-gray-300 px-4 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
                {showEmailFormatError && (
                  <span id="login-email-error" className="text-sm font-normal text-red-700">
                    {t('emailFormat')}
                  </span>
                )}
              </label>
              <AuthErrorNotice messageKey={errorKey} email={email} />
              <button
                type="submit"
                disabled={pending || !canSubmitEmail}
                className="h-14 w-full rounded-lg bg-gray-900 text-base font-semibold text-white disabled:opacity-60"
              >
                {pending ? tc('sending') : tc('sendCode')}
              </button>
            </form>
          )}

          {step === 'otp' && (
            <form onSubmit={verifyCode} className="flex flex-col gap-4">
              <OtpSentNotice
                address={sentTo}
                changeLabel={t('useDifferentEmail')}
                onChange={() => { setStep('input'); setOtp(''); setErrorKey(null) }}
              />
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
              <AuthErrorNotice messageKey={errorKey} email={sentTo} />
              <button
                type="submit"
                disabled={pending}
                className="h-14 w-full rounded-lg bg-gray-900 text-base font-semibold text-white disabled:opacity-60"
              >
                {pending ? tc('verifying') : tc('verifyCode')}
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
