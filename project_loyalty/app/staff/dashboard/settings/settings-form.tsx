'use client'

import { useActionState } from 'react'
import { updateBusinessSettings } from '../../actions'

type EarningMode = 'per_transaction' | 'per_amount'

export function SettingsForm({
  initialThreshold,
  initialDescription,
  initialEarningMode,
}: {
  initialThreshold: number
  initialDescription: string
  initialEarningMode: EarningMode
}) {
  const [state, formAction, pending] = useActionState(updateBusinessSettings, null)

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {/* Reward threshold */}
      <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Reward threshold
        <span className="text-xs font-normal text-zinc-500">
          Number of stamps a customer needs for a reward.
        </span>
        <input
          type="number"
          name="reward_threshold"
          required
          min={1}
          step={1}
          inputMode="numeric"
          defaultValue={initialThreshold}
          className="mt-1 h-14 rounded-lg border border-zinc-300 bg-white px-4 text-lg text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
        />
      </label>

      {/* Reward description */}
      <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Reward description
        <span className="text-xs font-normal text-zinc-500">
          What the customer actually gets. Shown to them on their dashboard.
        </span>
        <input
          type="text"
          name="reward_description"
          required
          maxLength={120}
          defaultValue={initialDescription}
          placeholder="Free coffee"
          className="mt-1 h-14 rounded-lg border border-zinc-300 bg-white px-4 text-lg text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
        />
      </label>

      {/* Earning mode */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Earning mode
        </legend>

        <label className="flex items-center gap-3 rounded-lg border border-zinc-300 px-4 py-3 dark:border-zinc-700">
          <input
            type="radio"
            name="earning_mode"
            value="per_transaction"
            defaultChecked={initialEarningMode === 'per_transaction'}
            className="h-5 w-5"
          />
          <span className="flex flex-col">
            <span className="text-base font-medium text-black dark:text-white">Per transaction</span>
            <span className="text-xs text-zinc-500">One stamp per purchase.</span>
          </span>
        </label>

        <label className="flex items-center gap-3 rounded-lg border border-dashed border-zinc-200 px-4 py-3 opacity-60 dark:border-zinc-800">
          <input type="radio" name="earning_mode" value="per_amount" disabled className="h-5 w-5" />
          <span className="flex flex-1 flex-col">
            <span className="text-base font-medium text-zinc-500">Per amount spent</span>
            <span className="text-xs text-zinc-400">Stamps based on spend.</span>
          </span>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-500 dark:bg-zinc-800">
            Coming soon
          </span>
        </label>
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="h-16 w-full rounded-lg bg-black text-lg font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-black"
      >
        {pending ? 'Saving…' : 'Save settings'}
      </button>

      {state && !state.ok && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {state.error}
        </p>
      )}

      {state && state.ok && (
        <p
          role="status"
          className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700 dark:bg-green-950 dark:text-green-300"
        >
          Saved — customers now need {state.rewardThreshold} stamps for “{state.rewardDescription}”.
        </p>
      )}
    </form>
  )
}
