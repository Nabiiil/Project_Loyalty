'use client'

import { useActionState } from 'react'
import { saveProfile } from './actions'
import { DISPLAY_NAME_MAX_LENGTH } from '@/lib/profile'
import { useTranslations } from '@/lib/i18n/I18nProvider'

/**
 * The optional bit of the profile. Every field here can be left empty forever
 * with no consequence — nothing in the app reads it as a gate, and there is no
 * completeness meter, badge or reminder anywhere. It exists for customers who
 * want it.
 */
export function ProfileForm({ initialDisplayName }: { initialDisplayName: string | null }) {
  const t = useTranslations('customerProfile')
  const [state, formAction, pending] = useActionState(saveProfile, null)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
        {t('displayName')}
        <input
          type="text"
          name="display_name"
          defaultValue={initialDisplayName ?? ''}
          // Matches the server-side cap and the DB constraint. The browser stops
          // most overruns; normalizeDisplayName is what actually decides.
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          autoComplete="name"
          placeholder={t('displayNamePlaceholder')}
          className="h-12 rounded-lg border border-gray-300 px-4 text-base text-gray-900 text-start focus:outline-none focus:ring-2 focus:ring-gray-900"
        />
        <span className="text-xs font-normal text-gray-500">{t('displayNameHint')}</span>
      </label>

      {/* Disclosure, stated where the name is entered rather than buried in a
          policy page: staff at businesses they visit WILL see this name, and
          their email and phone still never cross over. Kept adjacent to the
          input so the customer knows before typing, not after. */}
      <p className="rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-600">{t('privacyNote')}</p>

      {state && !state.ok && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </p>
      )}

      {state?.ok && (
        <p role="status" className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
          {t('saved')}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="h-12 w-full rounded-lg bg-gray-900 text-base font-semibold text-white disabled:opacity-60"
      >
        {pending ? t('saving') : t('save')}
      </button>
    </form>
  )
}
