'use client'

import { offersSignup, signupHrefForEmail, type AuthMessageKey } from '@/lib/auth-errors'
import { useTranslations } from '@/lib/i18n/I18nProvider'

/**
 * The single place an auth failure becomes visible text. It takes a mapped KEY,
 * never a provider message, so there is no code path on either sign-in surface
 * that can print "Signups not allowed for otp" at a customer.
 *
 * Two visual treatments, because two different things happen here:
 *
 * - "No account for that email" is not a failure, it is a fork in the road. The
 *   customer typed a perfectly good address, we just have nothing under it. It
 *   gets a neutral card and a real button onward to signup, carrying the address
 *   they already typed.
 * - Everything else is a genuine problem and reads as one, without blaming the
 *   customer for it.
 */
export function AuthErrorNotice({
  messageKey,
  email,
}: {
  messageKey: AuthMessageKey | null
  /** Carried to the signup form so the address survives the trip. */
  email?: string
}) {
  const t = useTranslations('customerAuth')

  if (!messageKey) return null

  if (offersSignup(messageKey)) {
    return (
      <div
        role="alert"
        className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"
      >
        <p className="text-sm text-gray-700">{t(`errors.${messageKey}`)}</p>
        <a
          href={signupHrefForEmail(email ?? '')}
          className="rounded-lg bg-gray-900 px-4 py-2.5 text-center text-sm font-semibold text-white"
        >
          {t('errors.noAccountCta')}
        </a>
      </div>
    )
  }

  return (
    <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
      {t(`errors.${messageKey}`)}
    </p>
  )
}
