'use client'

import { useTranslations } from '@/lib/i18n/I18nProvider'

/**
 * Confirmation shown once a code is on its way: the exact address or number we
 * sent it to, and a way to fix it right there.
 *
 * This exists because format validation can only catch addresses that are
 * impossible — it cannot catch `nabil@gmial.com`, which is the failure customers
 * actually hit. Showing what we sent to, at the moment they are waiting for a
 * code that will never arrive, is the only thing that surfaces that typo.
 *
 * The address renders on its own line inside `<bdi>`: emails and phone numbers
 * are LTR runs, and without isolation an Arabic layout reorders them into
 * nonsense around the `@` and `+`.
 */
export function OtpSentNotice({
  address,
  changeLabel,
  onChange,
}: {
  address: string
  /** e.g. "Use a different email" — the correction affordance. */
  changeLabel: string
  onChange: () => void
}) {
  const t = useTranslations('customerAuth')

  return (
    <div className="rounded-lg bg-gray-50 px-4 py-3">
      <p className="text-sm text-gray-500">{t('codeSentTo')}</p>
      <p className="mt-0.5 text-sm font-medium text-gray-900 break-all">
        <bdi>{address}</bdi>
      </p>
      <button
        type="button"
        onClick={onChange}
        className="mt-1.5 text-sm text-gray-500 underline underline-offset-2"
      >
        {changeLabel}
      </button>
    </div>
  )
}
