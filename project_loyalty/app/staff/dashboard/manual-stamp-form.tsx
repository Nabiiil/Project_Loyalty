'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { addManualStamp } from '../actions'
import { useTranslations } from '@/lib/i18n/I18nProvider'

const REASON_VALUES = ['qr_failed', 'phone_dead', 'staff_error', 'other'] as const

/**
 * Secondary "Add stamp manually" action on the New transaction screen.
 * Deliberately de-emphasized: it starts collapsed behind a plain text link so
 * it never competes with the primary QR flow above it. Open state is controlled
 * by the parent so the scan-confirmation timeout can open it directly.
 */
export function ManualStampForm({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslations('manualStamp')
  const tc = useTranslations('common')
  const [idKind, setIdKind] = useState<'code' | 'phone'>('code')
  const [state, formAction, pending] = useActionState(addManualStamp, null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [open])

  if (!open) {
    return (
      <div className="flex justify-center border-t border-zinc-100 pt-5 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          className="text-sm font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          {t('addManually')}
        </button>
      </div>
    )
  }

  return (
    <div
      ref={panelRef}
      className="flex flex-col gap-4 rounded-xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t('addManually')}</h2>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="text-sm text-zinc-400 underline underline-offset-2"
        >
          {tc('cancel')}
        </button>
      </div>

      <p className="text-xs text-zinc-500">{t('useWhenQrFails')}</p>

      <form action={formAction} className="flex flex-col gap-4">
        {/* Identify by: customer code or phone */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('identifyCustomer')}
          </span>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label={t('identifyByAria')}>
            {(['code', 'phone'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setIdKind(kind)}
                aria-pressed={idKind === kind}
                className={
                  idKind === kind
                    ? 'h-11 rounded-lg bg-zinc-900 text-sm font-semibold text-white dark:bg-white dark:text-black'
                    : 'h-11 rounded-lg border border-zinc-300 text-sm font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300'
                }
              >
                {kind === 'code' ? t('customerCode') : tc('phone')}
              </button>
            ))}
          </div>
          <input type="hidden" name="id_kind" value={idKind} />
          <input
            type="text"
            name="identifier"
            required
            autoComplete="off"
            autoCapitalize={idKind === 'code' ? 'characters' : 'off'}
            inputMode={idKind === 'phone' ? 'tel' : 'text'}
            dir="ltr"
            placeholder={idKind === 'code' ? 'A1B2C3D4' : '212600112233'}
            className="h-14 rounded-lg border border-zinc-300 bg-white px-4 text-lg text-black text-start dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          />
          <p className="text-xs text-zinc-400">
            {idKind === 'code' ? t('codeHint') : t('phoneHint')}
          </p>
        </div>

        {/* Reason — required */}
        <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {t('reason')}
          <select
            name="reason_category"
            required
            defaultValue=""
            className="mt-1 h-14 rounded-lg border border-zinc-300 bg-white px-4 text-base text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          >
            <option value="" disabled>
              {t('chooseReason')}
            </option>
            {REASON_VALUES.map((value) => (
              <option key={value} value={value}>
                {t(`reasons.${value}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {t('noteOptional')}
          <input
            type="text"
            name="reason_note"
            maxLength={200}
            placeholder={t('notePlaceholder')}
            className="mt-1 h-12 rounded-lg border border-zinc-300 bg-white px-4 text-base text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="h-14 w-full rounded-lg border-2 border-zinc-900 text-base font-semibold text-zinc-900 disabled:opacity-60 dark:border-white dark:text-white"
        >
          {pending ? t('adding') : t('addStamp')}
        </button>
      </form>

      {state && !state.ok && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {state.error}
        </p>
      )}

      {state && state.ok && (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700 dark:bg-green-950 dark:text-green-300"
        >
          <span className="font-semibold">
            {state.rewardReached ? t('successReady') : t('success')}
          </span>
          <span>
            {t('successDetail', {
              current: state.currentStamps,
              total: state.rewardThreshold,
              used: state.usedToday,
              limit: state.dailyLimit,
            })}
          </span>
        </div>
      )}
    </div>
  )
}
