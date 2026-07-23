'use client'

import { useActionState, useState } from 'react'
import { addManualStamp } from '../actions'

const REASONS = [
  { value: 'qr_failed', label: 'QR wouldn’t scan' },
  { value: 'phone_dead', label: 'Phone dead / no phone' },
  { value: 'staff_error', label: 'Staff error' },
  { value: 'other', label: 'Other' },
] as const

/**
 * Secondary "Add stamp manually" action on the New transaction screen.
 * Deliberately de-emphasized: it starts collapsed behind a plain text link so
 * it never competes with the primary QR flow above it. Expanding reveals the
 * identify-the-customer + reason form. The QR scan is always the happy path;
 * this is the fallback for when it can't be used.
 */
export function ManualStampForm() {
  const [open, setOpen] = useState(false)
  const [idKind, setIdKind] = useState<'code' | 'phone'>('code')
  const [state, formAction, pending] = useActionState(addManualStamp, null)

  if (!open) {
    return (
      <div className="flex justify-center border-t border-zinc-100 pt-5 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          Add stamp manually
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Add stamp manually
        </h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-zinc-400 underline underline-offset-2"
        >
          Cancel
        </button>
      </div>

      <p className="text-xs text-zinc-500">
        Use only when the QR can’t be scanned. You must identify the customer and
        give a reason — these are visible to the owner.
      </p>

      <form action={formAction} className="flex flex-col gap-4">
        {/* Identify by: customer code or phone */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Identify the customer
          </span>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Identify by">
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
                {kind === 'code' ? 'Customer code' : 'Phone'}
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
            placeholder={idKind === 'code' ? 'e.g. A1B2C3D4' : 'e.g. 212600112233'}
            className="h-14 rounded-lg border border-zinc-300 bg-white px-4 text-lg text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          />
          <p className="text-xs text-zinc-400">
            {idKind === 'code'
              ? 'The 8-character code shown on the customer’s “Your cards” screen.'
              : 'The phone number on the customer’s account (claimed customers only).'}
          </p>
        </div>

        {/* Reason — required */}
        <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Reason
          <select
            name="reason_category"
            required
            defaultValue=""
            className="mt-1 h-14 rounded-lg border border-zinc-300 bg-white px-4 text-base text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          >
            <option value="" disabled>
              Choose a reason…
            </option>
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Note (optional)
          <input
            type="text"
            name="reason_note"
            maxLength={200}
            placeholder="Anything worth recording"
            className="mt-1 h-12 rounded-lg border border-zinc-300 bg-white px-4 text-base text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          />
        </label>

        {/* Secondary button style — outline, not the primary black QR button. */}
        <button
          type="submit"
          disabled={pending}
          className="h-14 w-full rounded-lg border-2 border-zinc-900 text-base font-semibold text-zinc-900 disabled:opacity-60 dark:border-white dark:text-white"
        >
          {pending ? 'Adding…' : 'Add stamp'}
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
            {state.rewardReached ? 'Stamp added — reward now ready!' : 'Stamp added.'}
          </span>
          <span>
            Now {state.currentStamps} / {state.rewardThreshold} stamps · manual stamps used
            today: {state.usedToday}/{state.dailyLimit}
          </span>
        </div>
      )}
    </div>
  )
}
