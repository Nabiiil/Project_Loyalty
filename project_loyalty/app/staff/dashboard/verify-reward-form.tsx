'use client'

import { useActionState } from 'react'
import { verifyRedemption } from '../actions'

const INVALID_COPY: Record<string, string> = {
  invalid_code: 'No such code. Double-check the digits.',
  wrong_business: 'This code is for a different business.',
  not_eligible: 'Not enough stamps yet — not eligible.',
  already_used: 'This code has already been used.',
  expired: 'This code has expired — ask for a fresh one.',
}

export function VerifyRewardForm() {
  const [state, formAction, pending] = useActionState(verifyRedemption, null)

  return (
    <section className="flex flex-col gap-4 border-t border-zinc-200 pt-8 dark:border-zinc-800">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight text-black dark:text-white">
          Verify a reward
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Enter the code the customer shows you.
        </p>
      </div>

      <form action={formAction} className="flex flex-col gap-4">
        <input
          type="text"
          name="code"
          required
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={6}
          placeholder="ABC123"
          className="h-14 rounded-lg border border-zinc-300 bg-white px-4 text-center text-2xl font-bold uppercase tracking-[0.4em] text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-16 w-full rounded-lg bg-black text-lg font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-black"
        >
          {pending ? 'Checking…' : 'Verify code'}
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

      {state && state.ok && state.valid && (
        <div className="flex flex-col items-center gap-1 rounded-lg border border-green-300 bg-green-50 px-4 py-6 text-center dark:border-green-800 dark:bg-green-950">
          <span className="text-4xl" aria-hidden>✅</span>
          <p className="text-lg font-bold text-green-800 dark:text-green-300">
            Valid — give the reward
          </p>
          <p className="text-sm text-green-700 dark:text-green-400">
            {state.businessName} · stamp card reset
          </p>
        </div>
      )}

      {state && state.ok && !state.valid && (
        <div className="flex flex-col items-center gap-1 rounded-lg border border-red-300 bg-red-50 px-4 py-6 text-center dark:border-red-800 dark:bg-red-950">
          <span className="text-4xl" aria-hidden>⛔</span>
          <p className="text-lg font-bold text-red-800 dark:text-red-300">Not valid</p>
          <p className="text-sm text-red-700 dark:text-red-400">
            {INVALID_COPY[state.reason] ?? 'This code cannot be redeemed.'}
          </p>
        </div>
      )}
    </section>
  )
}
