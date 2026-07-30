'use client'

import { useActionState } from 'react'
import { addStaffLogin, removeStaffLogin } from '../../actions'
import { useTranslations } from '@/lib/i18n/I18nProvider'

type StaffRow = {
  id: string
  name: string | null
  role: 'owner' | 'staff'
  created_at: string
}

/**
 * Owner-only staff management: list the business's logins, create a new
 * staff login (name + email + initial password), remove a departed one.
 * The server actions re-verify the caller is the owner on every submit;
 * this component is just the form shell.
 */
export function StaffManager({ staffList }: { staffList: StaffRow[] }) {
  const t = useTranslations('staffManager')
  const ts = useTranslations('staff')
  const tc = useTranslations('common')
  const [addState, addAction, addPending] = useActionState(addStaffLogin, null)
  const [removeState, removeAction, removePending] = useActionState(removeStaffLogin, null)

  return (
    <section className="flex flex-col gap-4 border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <div>
        <h2 className="text-lg font-semibold text-black dark:text-white">{t('title')}</h2>
        <p className="text-xs text-zinc-500">{t('description')}</p>
      </div>

      <ul className="flex flex-col divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-700">
        {staffList.map((member) => (
          <li key={member.id} className="flex items-center gap-3 px-4 py-3">
            <span className="flex-1 truncate text-base text-black dark:text-white">
              {member.name ?? t('unnamed')}
            </span>
            <span
              className={
                member.role === 'owner'
                  ? 'rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-semibold text-white dark:bg-white dark:text-black'
                  : 'rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
              }
            >
              {member.role === 'owner' ? ts('roleOwner') : ts('roleStaff')}
            </span>
            {member.role === 'staff' && (
              <form
                action={removeAction}
                onSubmit={(e) => {
                  if (!confirm(t('confirmRemove', { name: member.name ?? t('thisStaffMember') }))) {
                    e.preventDefault()
                  }
                }}
              >
                <input type="hidden" name="staff_id" value={member.id} />
                <button
                  type="submit"
                  disabled={removePending}
                  className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 disabled:opacity-60 dark:border-red-900 dark:text-red-400"
                >
                  {tc('remove')}
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>

      {removeState && !removeState.ok && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {removeState.error}
        </p>
      )}
      {removeState && removeState.ok && (
        <p role="status" className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
          {t('removedSuccess', { name: removeState.name })}
        </p>
      )}

      {/* Add staff login */}
      <form action={addAction} className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t('addTitle')}</h3>

        <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {t('nameLabel')}
          <input
            type="text"
            name="name"
            required
            maxLength={80}
            placeholder="Sara"
            className="mt-1 h-12 rounded-lg border border-zinc-300 bg-white px-4 text-base text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {tc('email')}
          <input
            type="email"
            name="email"
            required
            placeholder="sara@yourcafe.com"
            dir="ltr"
            className="mt-1 h-12 rounded-lg border border-zinc-300 bg-white px-4 text-base text-black text-start dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {t('initialPassword')}
          <span className="text-xs font-normal text-zinc-500">{t('passwordHint')}</span>
          <input
            type="password"
            name="password"
            required
            minLength={8}
            className="mt-1 h-12 rounded-lg border border-zinc-300 bg-white px-4 text-base text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          />
        </label>

        <button
          type="submit"
          disabled={addPending}
          className="h-12 w-full rounded-lg bg-black text-base font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-black"
        >
          {addPending ? t('creating') : t('createButton')}
        </button>

        {addState && !addState.ok && (
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {addState.error}
          </p>
        )}
        {addState && addState.ok && (
          <p role="status" className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
            {t('addedSuccess', { name: addState.name, email: addState.email })}
          </p>
        )}
      </form>
    </section>
  )
}
