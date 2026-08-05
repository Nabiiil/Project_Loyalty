'use client'

import { RewardProgress } from '@/components/RewardProgress'
import { useTranslations } from '@/lib/i18n/I18nProvider'

/**
 * The screen for a QR code that was real but is no longer usable — expired, or
 * already scanned. Deliberately NOT styled as an error: nothing has gone wrong
 * for the customer, they just need a fresh code from the counter.
 *
 * It branches on whether we recognize the visitor, because the two people who
 * land here need opposite things:
 *
 * - A returning customer knows what the app is; what they lost is their way
 *   back to their balance. They get a route to the dashboard, and — when we
 *   know it — their standing at this very business, which turns a dead end into
 *   a glance at how close their next reward is.
 * - A first-time scanner who found a stale code on a counter has no idea what
 *   they just scanned. Telling them "ask for a new one" means nothing yet, so
 *   they get a one-line pitch and a way in.
 *
 * Layout is centered and single-column, so it mirrors under RTL with no
 * directional overrides; `dir` is already set on <html> from the locale.
 */

export type StaleScanContext = {
  recognized: boolean
  businessName: string | null
  progress: {
    currentStamps: number
    rewardThreshold: number
    rewardDescription: string | null
  } | null
}

const ACTION_CLASS =
  'w-full rounded-xl bg-gray-900 px-5 py-3.5 text-center text-base font-semibold text-white'

export function StaleScan({
  code,
  context,
}: {
  code: 'token_expired' | 'already_scanned'
  context: StaleScanContext | null
}) {
  const t = useTranslations('scan')

  // No context (an older response, or a lookup that came back empty) reads as
  // "not recognized" — the newcomer copy is the safe default, since it explains
  // itself to someone who already knows the app but says nothing wrong to them.
  const recognized = context?.recognized ?? false
  const businessName = context?.businessName ?? null
  const progress = context?.progress ?? null

  return (
    <main className="min-h-dvh flex flex-col bg-white">
      <div className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-xs flex flex-col items-center gap-7 text-center">

          {businessName && (
            <p className="text-xs font-semibold tracking-widest uppercase text-gray-400">
              {businessName}
            </p>
          )}

          {/* A "get another one" glyph rather than a warning sign — the fix is a
              fresh code, not a problem to report. */}
          <span
            className="flex items-center justify-center w-20 h-20 rounded-full bg-gray-100 text-4xl text-gray-400"
            aria-hidden
          >
            ↻
          </span>

          <div className="space-y-1.5">
            <h1 className="text-2xl font-bold text-gray-900">
              {code === 'already_scanned' ? t('stale.usedTitle') : t('stale.expiredTitle')}
            </h1>
            <p className="text-gray-500">
              {recognized ? t('stale.askStaff') : t('stale.newAskStaff')}
            </p>
          </div>

          {recognized ? (
            <>
              {progress && <ProgressAtBusiness businessName={businessName} progress={progress} />}
              <a href="/dashboard" className={ACTION_CLASS}>
                {t('stale.viewMyPoints')}
              </a>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <p className="font-semibold text-gray-900">{t('stale.newHeading')}</p>
                <p className="text-sm text-gray-500">{t('stale.newBody')}</p>
              </div>
              <a href="/signup" className={ACTION_CLASS}>
                {t('stale.newCta')}
              </a>
            </>
          )}
        </div>
      </div>
    </main>
  )
}

/**
 * Where the customer already stands at the business whose code just failed.
 * Reuses the scan page's own progress vocabulary, so this reads as the same
 * card they would have seen had the code worked.
 */
function ProgressAtBusiness({
  businessName,
  progress,
}: {
  businessName: string | null
  progress: NonNullable<StaleScanContext['progress']>
}) {
  const t = useTranslations('scan')
  const { currentStamps, rewardThreshold, rewardDescription } = progress
  const stampsLeft = rewardThreshold - currentStamps

  return (
    <div className="w-full flex flex-col items-center gap-3 rounded-2xl bg-gray-50 px-5 py-5">
      {businessName && (
        <p className="text-sm font-medium text-gray-900">
          {t('stale.yourCardAt', { business: businessName })}
        </p>
      )}

      <RewardProgress
        current={currentStamps}
        total={rewardThreshold}
        ariaLabel={t('stampsAria', { current: currentStamps, total: rewardThreshold })}
        size="sm"
      />

      {/* Already at the threshold: the reward is waiting, which is the more
          useful thing to say than "0 more stamps to go". */}
      {stampsLeft <= 0 ? (
        <p className="text-sm font-semibold text-gray-900">{t('freeReward')}</p>
      ) : (
        <p className="text-sm text-gray-500">
          {stampsLeft === 1 ? t('moreToGoOne') : t('moreToGoOther', { count: stampsLeft })}
        </p>
      )}

      {rewardDescription && (
        <p className="text-xs text-gray-500">
          {t('towardPrefix')}{' '}
          <span className="font-semibold text-gray-900">{rewardDescription}</span>
        </p>
      )}
    </div>
  )
}
