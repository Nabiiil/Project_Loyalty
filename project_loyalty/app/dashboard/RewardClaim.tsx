'use client'

import { useEffect, useState } from 'react'
import { revealRedemptionCode, type RevealState } from './actions'
import { useTranslations, useLocale } from '@/lib/i18n/I18nProvider'
import { formatTime } from '@/lib/i18n/format'

/**
 * Shown on a reward-ready enrollment card. Anonymous customers are pushed
 * through the account gate first; claimed customers see the redemption code
 * directly (Task 7 — earning stays anonymous, only claiming needs an account).
 */
export function RewardClaim({
  enrollmentId,
  isClaimed,
}: {
  enrollmentId: string
  isClaimed: boolean
}) {
  const t = useTranslations('reward')

  if (!isClaimed) {
    return (
      <a
        href="/signup"
        className="flex h-12 items-center justify-center gap-2 rounded-lg bg-gray-900 text-sm font-semibold text-white"
      >
        {t('claimCta')}
        <span aria-hidden className="rtl:rotate-180">→</span>
      </a>
    )
  }

  return <RedemptionCode enrollmentId={enrollmentId} />
}

function RedemptionCode({ enrollmentId }: { enrollmentId: string }) {
  const t = useTranslations('reward')
  const locale = useLocale()
  const [state, setState] = useState<RevealState | null>(null)

  useEffect(() => {
    let active = true
    revealRedemptionCode(enrollmentId).then((res) => {
      if (active) setState(res)
    })
    return () => {
      active = false
    }
  }, [enrollmentId])

  if (!state) {
    return (
      <div className="flex h-12 items-center justify-center rounded-lg bg-green-50 text-sm text-green-700">
        {t('gettingCode')}
      </div>
    )
  }

  if (!state.ok) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
        {t('codeError')}
      </p>
    )
  }

  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-4">
      <p className="text-xs font-medium uppercase tracking-widest text-green-700">
        {t('showToStaff')}
      </p>
      <p className="font-mono text-3xl font-bold tracking-[0.3em] text-green-900">{state.code}</p>
      {state.expiresAt && (
        <p className="text-xs text-green-700">
          {t('expiresAt', { time: formatTime(state.expiresAt, locale) })}
        </p>
      )}
    </div>
  )
}
