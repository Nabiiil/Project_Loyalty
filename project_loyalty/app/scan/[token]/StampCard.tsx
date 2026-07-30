'use client'

import { SignupInvite } from '@/components/SignupInvite'
import { useTranslations } from '@/lib/i18n/I18nProvider'

export type ScanResult =
  | {
      ok: true
      transactionId: string
      businessId: string
      customerId: string
      deviceToken: string | null
      isNewCustomer: boolean
      enrollmentId: string
      currentStamps: number
      rewardThreshold: number
      rewardReached: boolean
    }
  | { ok: false; error: string }

const KNOWN_ERRORS = new Set([
  'already_scanned',
  'token_expired',
  'invalid_token',
  'invalid_signature',
  'customer_not_found',
  'server_error',
])

type Props = {
  result: ScanResult
  businessName: string | null
  rewardDescription: string | null
}

export function StampCard({ result, businessName, rewardDescription }: Props) {
  const t = useTranslations('scan')

  if (!result.ok) {
    const code = KNOWN_ERRORS.has(result.error) ? result.error : 'server_error'
    return (
      <main className="min-h-dvh flex items-center justify-center bg-white px-6">
        <div className="w-full max-w-xs text-center space-y-4">
          <span className="text-5xl" aria-hidden>⚠️</span>
          <p className="text-lg font-medium text-gray-800">{t(`errors.${code}`)}</p>
        </div>
      </main>
    )
  }

  const { currentStamps, rewardThreshold, rewardReached } = result
  const stampsLeft = rewardThreshold - currentStamps

  return (
    <main className="min-h-dvh flex flex-col bg-white">
      <SignupInvite />
      <div className="flex-1 flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-xs flex flex-col items-center gap-7 text-center">

        {businessName && (
          <p className="text-xs font-semibold tracking-widest uppercase text-gray-400">
            {businessName}
          </p>
        )}

        {rewardReached ? (
          <>
            <span className="text-6xl" aria-hidden>🎉</span>
            <div className="space-y-1">
              <h1 className="text-3xl font-bold text-gray-900">{t('freeReward')}</h1>
              {rewardDescription && (
                <p className="text-lg font-semibold text-gray-900">{rewardDescription}</p>
              )}
              <p className="text-gray-500">{t('showToCollect')}</p>
            </div>
          </>
        ) : (
          <>
            <span
              className="flex items-center justify-center w-20 h-20 rounded-full bg-gray-900 text-white text-4xl font-bold"
              aria-hidden
            >
              ✓
            </span>
            <div className="space-y-1">
              <h1 className="text-3xl font-bold text-gray-900">{t('stampAdded')}</h1>
              <p className="text-gray-500">
                {stampsLeft === 1 ? t('moreToGoOne') : t('moreToGoOther', { count: stampsLeft })}
              </p>
              {rewardDescription && (
                <p className="text-sm text-gray-500">
                  {t('towardPrefix')}{' '}
                  <span className="font-semibold text-gray-900">{rewardDescription}</span>
                </p>
              )}
            </div>
          </>
        )}

        <StampGrid current={currentStamps} total={rewardThreshold} />

        <p className="text-sm text-gray-400" aria-label={t('stampCountAria')}>
          {currentStamps} / {rewardThreshold}
        </p>

        <a href="/dashboard" className="text-sm text-gray-400 underline underline-offset-2">
          {t('viewAllCards')}
        </a>
      </div>
      </div>
    </main>
  )
}

function StampGrid({ current, total }: { current: number; total: number }) {
  const visible = Math.min(total, 12)
  const filled = Math.min(current, visible)
  const cols = visible <= 6 ? visible : 6

  return (
    <div
      className="grid gap-3 w-full"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      aria-hidden
    >
      {Array.from({ length: visible }).map((_, i) => (
        <div
          key={i}
          className={[
            'aspect-square rounded-full border-2',
            i < filled ? 'bg-gray-900 border-gray-900' : 'border-gray-200 bg-white',
          ].join(' ')}
        />
      ))}
    </div>
  )
}
