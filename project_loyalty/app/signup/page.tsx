'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { GoogleSignInButton } from '@/components/GoogleSignInButton'
import { EmailPhoneOtpForm } from '@/components/EmailPhoneOtpForm'

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

        <GoogleSignInButton />

        <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-gray-400">
          <span className="h-px flex-1 bg-gray-200" />
          or
          <span className="h-px flex-1 bg-gray-200" />
        </div>

        <EmailPhoneOtpForm />

        <p className="text-center text-sm text-gray-400">
          Already have an account?{' '}
          <a href="/login" className="text-gray-900 underline underline-offset-2">Sign in</a>
        </p>

      </div>
    </main>
  )
}
