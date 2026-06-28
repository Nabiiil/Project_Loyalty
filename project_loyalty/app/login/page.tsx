'use client'

import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'

type Step = 'input' | 'otp'

function makeClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}

export default function LoginPage() {
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
    <main className="min-h-dvh flex items-center justify-center bg-white px-6">
      <div className="w-full max-w-sm flex flex-col gap-8">

        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Sign in</h1>
          <p className="text-sm text-gray-500">We'll send a 6-digit code to your inbox.</p>
        </div>

        {step === 'input' && (
          <form onSubmit={sendCode} className="flex flex-col gap-4">
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
            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
            )}
            <button
              type="submit"
              disabled={pending}
              className="h-14 w-full rounded-lg bg-gray-900 text-base font-semibold text-white disabled:opacity-60"
            >
              {pending ? 'Sending…' : 'Send code'}
            </button>
          </form>
        )}

        {step === 'otp' && (
          <form onSubmit={verifyCode} className="flex flex-col gap-4">
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
            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
            )}
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

        <p className="text-center text-sm text-gray-400">
          No account yet?{' '}
          <a href="/signup" className="text-gray-900 underline underline-offset-2">Create one</a>
        </p>

      </div>
    </main>
  )
}
