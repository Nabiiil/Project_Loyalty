'use client'

import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { AuthErrorNotice } from './AuthErrorNotice'
import { OtpSentNotice } from './OtpSentNotice'
import {
  isSubmittableEmail,
  mapAuthError,
  shouldShowEmailError,
  type AuthMessageKey,
} from '@/lib/auth-errors'
import { useTranslations } from '@/lib/i18n/I18nProvider'

type Tab = 'email' | 'phone'
type Step = 'input' | 'otp'

function makeClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}

const FIELD_CLASS =
  'h-12 rounded-lg border border-gray-300 px-4 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900'
const SUBMIT_CLASS =
  'h-14 w-full rounded-lg bg-gray-900 text-base font-semibold text-white disabled:opacity-60'

/**
 * Email / phone magic-link + OTP signup, shared by the /signup page and the
 * signup drawer. On successful verification it navigates to /auth/complete,
 * which attaches the identity to the existing device-token customer row,
 * preserving all earned stamps. Offered alongside "Continue with Google", not
 * as a replacement.
 *
 * This form creates accounts (`shouldCreateUser: true`), so it never produces
 * the "no account for that email" case — that belongs to /login. It maps its
 * errors through the same {@link mapAuthError} table anyway, so the two surfaces
 * word the shared failures (bad code, rate limit, no connection) identically.
 */
export function EmailPhoneOtpForm({ initialEmail = '' }: { initialEmail?: string }) {
  const t = useTranslations('customerAuth')
  const tc = useTranslations('common')
  const [tab, setTab] = useState<Tab>('email')
  const [step, setStep] = useState<Step>('input')
  const [email, setEmail] = useState(initialEmail)
  const [emailTouched, setEmailTouched] = useState(false)
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [errorKey, setErrorKey] = useState<AuthMessageKey | null>(null)
  const [pending, setPending] = useState(false)

  // The address actually sent to, so the confirmation cannot drift from it while
  // the customer edits the field behind it.
  const [sentTo, setSentTo] = useState('')

  const showEmailFormatError = shouldShowEmailError(email, emailTouched)
  const canSubmitEmail = isSubmittableEmail(email)

  function reset(nextTab?: Tab) {
    if (nextTab) setTab(nextTab)
    setStep('input')
    setOtp('')
    setErrorKey(null)
  }

  async function sendEmailOtp(e: React.FormEvent) {
    e.preventDefault()
    const address = email.trim()
    // Backstop for a submit that reaches here despite the disabled button
    // (an Enter press on an autofilled field, say).
    if (!isSubmittableEmail(address)) {
      setEmailTouched(true)
      return
    }
    setErrorKey(null)
    setPending(true)
    const { error } = await makeClient().auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: true },
    })
    setPending(false)
    if (error) {
      setErrorKey(mapAuthError(error, { flow: 'sign-up', channel: 'email', stage: 'send' }))
      return
    }
    setSentTo(address)
    setStep('otp')
  }

  async function verifyEmailOtp(e: React.FormEvent) {
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
      setErrorKey(mapAuthError(error, { flow: 'sign-up', channel: 'email', stage: 'verify' }))
      return
    }
    window.location.href = '/auth/complete'
  }

  async function sendPhoneOtp(e: React.FormEvent) {
    e.preventDefault()
    const number = phone.trim()
    setErrorKey(null)
    setPending(true)
    const { error } = await makeClient().auth.signInWithOtp({ phone: number })
    setPending(false)
    if (error) {
      setErrorKey(mapAuthError(error, { flow: 'sign-up', channel: 'phone', stage: 'send' }))
      return
    }
    setSentTo(number)
    setStep('otp')
  }

  async function verifyPhoneOtp(e: React.FormEvent) {
    e.preventDefault()
    setErrorKey(null)
    setPending(true)
    const { error } = await makeClient().auth.verifyOtp({
      phone: sentTo,
      token: otp,
      type: 'sms',
    })
    setPending(false)
    if (error) {
      setErrorKey(mapAuthError(error, { flow: 'sign-up', channel: 'phone', stage: 'verify' }))
      return
    }
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
            onClick={() => reset(tabKey)}
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
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setEmailTouched(true)}
              required
              autoComplete="email"
              placeholder="you@example.com"
              aria-invalid={showEmailFormatError}
              aria-describedby={showEmailFormatError ? 'signup-email-error' : undefined}
              className={FIELD_CLASS}
            />
            {showEmailFormatError && (
              <span id="signup-email-error" className="text-sm font-normal text-red-700">
                {t('emailFormat')}
              </span>
            )}
          </label>
          <AuthErrorNotice messageKey={errorKey} email={email} />
          <button type="submit" disabled={pending || !canSubmitEmail} className={SUBMIT_CLASS}>
            {pending ? tc('sending') : tc('sendCode')}
          </button>
        </form>
      )}

      {/* Email — OTP */}
      {tab === 'email' && step === 'otp' && (
        <form onSubmit={verifyEmailOtp} className="flex flex-col gap-4">
          <OtpSentNotice
            address={sentTo}
            changeLabel={t('useDifferentEmail')}
            onChange={() => reset()}
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
              onChange={(e) => setOtp(e.target.value)}
              required
              maxLength={6}
              placeholder="123456"
              className={`${FIELD_CLASS} tracking-widest`}
            />
          </label>
          <AuthErrorNotice messageKey={errorKey} email={sentTo} />
          <button type="submit" disabled={pending} className={SUBMIT_CLASS}>
            {pending ? tc('verifying') : tc('verifyCode')}
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
              onChange={(e) => setPhone(e.target.value)}
              required
              autoComplete="tel"
              placeholder="+212612345678"
              dir="ltr"
              className={`${FIELD_CLASS} text-start`}
            />
          </label>
          <AuthErrorNotice messageKey={errorKey} />
          <button type="submit" disabled={pending || !phone.trim()} className={SUBMIT_CLASS}>
            {pending ? tc('sending') : tc('sendCode')}
          </button>
        </form>
      )}

      {/* Phone — OTP */}
      {tab === 'phone' && step === 'otp' && (
        <form onSubmit={verifyPhoneOtp} className="flex flex-col gap-4">
          <OtpSentNotice
            address={sentTo}
            changeLabel={t('useDifferentNumber')}
            onChange={() => reset()}
          />
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            {tc('verificationCode')}
            <input
              type="text"
              inputMode="numeric"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              required
              maxLength={6}
              placeholder="123456"
              className={`${FIELD_CLASS} tracking-widest`}
            />
          </label>
          <AuthErrorNotice messageKey={errorKey} />
          <button type="submit" disabled={pending} className={SUBMIT_CLASS}>
            {pending ? tc('verifying') : tc('verifyCode')}
          </button>
        </form>
      )}
    </div>
  )
}
