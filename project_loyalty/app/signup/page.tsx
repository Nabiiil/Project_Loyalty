'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

type Tab = 'email' | 'phone'
type Step = 'input' | 'otp'

function makeClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupContent />
    </Suspense>
  )
}

function SignupContent() {
  const searchParams = useSearchParams()
  const authError = searchParams.get('error')
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
    <main className="min-h-dvh flex items-center justify-center bg-white px-6">
      <div className="w-full max-w-sm flex flex-col gap-8">

        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Create account</h1>
          <p className="text-sm text-gray-500">Start earning stamps across every business you visit.</p>
        </div>

        {authError === 'auth_failed' && (
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            Something went wrong. Please try again.
          </p>
        )}

        {/* Tab toggle */}
        <div className="flex rounded-lg border border-gray-200 p-1 gap-1">
          {(['email', 'phone'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setTab(t); setStep('input'); setOtp(''); setError(null) }}
              className={[
                'flex-1 rounded-md py-2 text-sm font-medium transition-colors',
                tab === t ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900',
              ].join(' ')}
            >
              {t === 'email' ? 'Email' : 'Phone'}
            </button>
          ))}
        </div>

        {/* Email — input */}
        {tab === 'email' && step === 'input' && (
          <form onSubmit={sendEmailOtp} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
              Email address
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
              {pending ? 'Sending…' : 'Send code'}
            </button>
          </form>
        )}

        {/* Email — OTP */}
        {tab === 'email' && step === 'otp' && (
          <form onSubmit={verifyEmailOtp} className="flex flex-col gap-4">
            <p className="text-sm text-gray-500">
              We sent a 6-digit code to <strong>{email}</strong>. Check{' '}
              <a href="http://localhost:54324" target="_blank" rel="noreferrer" className="underline">
                Inbucket
              </a>{' '}
              if you're testing locally.
            </p>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
              Verification code
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
              {pending ? 'Verifying…' : 'Verify code'}
            </button>
            <button
              type="button"
              onClick={() => { setStep('input'); setOtp(''); setError(null) }}
              className="text-sm text-gray-400 underline underline-offset-2"
            >
              Use a different email
            </button>
          </form>
        )}

        {/* Phone — input */}
        {tab === 'phone' && step === 'input' && (
          <form onSubmit={sendPhoneOtp} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
              Phone number
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                required
                autoComplete="tel"
                placeholder="+33612345678"
                className="h-12 rounded-lg border border-gray-300 px-4 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </label>
            {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
            <button
              type="submit"
              disabled={pending}
              className="h-14 w-full rounded-lg bg-gray-900 text-base font-semibold text-white disabled:opacity-60"
            >
              {pending ? 'Sending…' : 'Send code'}
            </button>
          </form>
        )}

        {/* Phone — OTP */}
        {tab === 'phone' && step === 'otp' && (
          <form onSubmit={verifyPhoneOtp} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
              Verification code
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
            <p className="text-sm text-gray-500">Sent to {phone}</p>
            {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
            <button
              type="submit"
              disabled={pending}
              className="h-14 w-full rounded-lg bg-gray-900 text-base font-semibold text-white disabled:opacity-60"
            >
              {pending ? 'Verifying…' : 'Verify code'}
            </button>
            <button
              type="button"
              onClick={() => { setStep('input'); setOtp(''); setError(null) }}
              className="text-sm text-gray-400 underline underline-offset-2"
            >
              Use a different number
            </button>
          </form>
        )}

        <p className="text-center text-sm text-gray-400">
          Already have an account?{' '}
          <a href="/login" className="text-gray-900 underline underline-offset-2">Sign in</a>
        </p>

      </div>
    </main>
  )
}
