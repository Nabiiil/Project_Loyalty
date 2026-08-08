'use client'

import { useActionState, useState, useSyncExternalStore } from 'react'
import { saveProfile } from './profile/actions'
import { DISPLAY_NAME_MAX_LENGTH, NAME_PROMPT_DISMISSED_KEY } from '@/lib/profile'
import { useTranslations } from '@/lib/i18n/I18nProvider'

/**
 * localStorage is read through useSyncExternalStore rather than an effect: it
 * is an external store, and reading it this way gives a correct server snapshot
 * instead of a setState-during-mount cascade. Nothing else writes the key, so
 * the subscription is a no-op — a skip re-renders through its own state.
 */
const NEVER_CHANGES = () => () => {}

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(NAME_PROMPT_DISMISSED_KEY) === '1'
  } catch {
    // Private mode or storage disabled. Fall through and show it: the `welcome`
    // param is one-shot anyway, so the worst case is seeing this once more.
    return false
  }
}

/** On the server there is no storage; the client corrects this at hydration. */
const readDismissedOnServer = () => false

/**
 * A one-time invitation to add a name, shown on the dashboard immediately after
 * signup — never during it. By the time this renders the account exists and any
 * anonymous stamps are already merged onto it, so nothing here gates anything:
 * skipping costs the customer nothing at all.
 *
 * It is shown at most once. The server only sets the `welcome` param on the
 * single redirect out of a successful email/phone signup, and skipping records
 * a localStorage flag so a reload or a re-opened URL does not bring it back.
 * The profile page stays the way to set a name later.
 *
 * Saves through the same server action as the profile form, so the validation,
 * the null-not-empty rule and the RLS-scoped write are all identical.
 */
export function NamePrompt() {
  const t = useTranslations('customerProfile')
  const [state, formAction, pending] = useActionState(saveProfile, null)
  const alreadyDismissed = useSyncExternalStore(
    NEVER_CHANGES,
    readDismissed,
    readDismissedOnServer,
  )
  const [skipped, setSkipped] = useState(false)

  function skip() {
    try {
      window.localStorage.setItem(NAME_PROMPT_DISMISSED_KEY, '1')
    } catch {
      // Nothing to do — the one-shot param will not survive this navigation.
    }
    setSkipped(true)
  }

  // Saved successfully: the name is on the account and the header already shows
  // it, so the prompt has done its job and gets out of the way.
  if (alreadyDismissed || skipped || state?.ok) return null

  return (
    <section
      aria-labelledby="name-prompt-title"
      className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id="name-prompt-title" className="text-base font-semibold text-gray-900">
          {t('promptTitle')}
        </h2>
        <p className="text-sm text-gray-500">{t('promptBody')}</p>
      </div>

      <form action={formAction} className="flex flex-col gap-3">
        <input
          type="text"
          name="display_name"
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          autoComplete="name"
          aria-label={t('displayName')}
          placeholder={t('displayNamePlaceholder')}
          className="h-12 rounded-lg border border-gray-300 bg-white px-4 text-base text-gray-900 text-start focus:outline-none focus:ring-2 focus:ring-gray-900"
        />

        {/* The same disclosure as the profile form. A customer typing a name
            here must know businesses will see it, without having to visit the
            profile page to find that out. */}
        <p className="text-xs text-gray-600">{t('privacyNote')}</p>

        {state && !state.ok && (
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {state.error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="h-11 flex-1 rounded-lg bg-gray-900 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pending ? t('saving') : t('save')}
          </button>
          <button
            type="button"
            onClick={skip}
            className="h-11 px-4 text-sm text-gray-500 underline underline-offset-2"
          >
            {t('promptSkip')}
          </button>
        </div>
      </form>
    </section>
  )
}
