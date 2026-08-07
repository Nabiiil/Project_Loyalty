'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { GoogleSignInButton } from '@/components/GoogleSignInButton'
import { EmailPhoneOtpForm } from '@/components/EmailPhoneOtpForm'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { useTranslations } from '@/lib/i18n/I18nProvider'

export default function SignupPage() {
  return (
    <Suspense>
      <SignupContent />
    </Suspense>
  )
}

function SignupContent() {
  const t = useTranslations('customerAuth')
  const tc = useTranslations('common')
  const searchParams = useSearchParams()
  const authError = searchParams.get('error')
  // Carried over from a failed sign-in ("no account for that email") so the
  // customer does not retype the address they just typed. See lib/auth-errors.
  const prefilledEmail = searchParams.get('email') ?? ''

  return (
    <main className="min-h-dvh flex flex-col bg-white">
      <div className="flex justify-end p-4">
        <LanguageSwitcher />
      </div>
      <div className="flex flex-1 items-center justify-center px-6 pb-10">
        <div className="w-full max-w-sm flex flex-col gap-8">

          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{t('signupTitle')}</h1>
            <p className="text-sm text-gray-500">{t('signupSubtitle')}</p>
          </div>

          {authError === 'auth_failed' && (
            <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              {tc('somethingWrong')}
            </p>
          )}

          <GoogleSignInButton />

          <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-gray-400">
            <span className="h-px flex-1 bg-gray-200" />
            {tc('or')}
            <span className="h-px flex-1 bg-gray-200" />
          </div>

          <EmailPhoneOtpForm initialEmail={prefilledEmail} />

          <p className="text-center text-sm text-gray-400">
            {t('haveAccount')}{' '}
            <a href="/login" className="text-gray-900 underline underline-offset-2">{tc('signIn')}</a>
          </p>

        </div>
      </div>
    </main>
  )
}
