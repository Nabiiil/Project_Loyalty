'use client'

import Image from 'next/image'
import { useActionState } from 'react'
import { createTransaction } from '../actions'

export function NewTransactionForm() {
  const [state, formAction, pending] = useActionState(createTransaction, null)

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Amount (optional)
          <input
            type="number"
            name="amount"
            inputMode="decimal"
            step="0.01"
            min="0"
            placeholder="e.g. 4.50"
            className="h-14 rounded-lg border border-zinc-300 bg-white px-4 text-lg text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="h-16 w-full rounded-lg bg-black text-lg font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-black"
        >
          {pending ? 'Generating…' : 'Generate QR code'}
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
        <div className="flex flex-col items-center gap-3 rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
          <Image
            src={state.qrDataUrl}
            alt="Transaction QR code for the customer to scan"
            width={320}
            height={320}
            unoptimized
            priority
          />
          <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
            Ask the customer to scan this code.
            {state.amount != null && (
              <>
                {' '}
                Amount: <strong>{state.amount.toFixed(2)}</strong>.
              </>
            )}
          </p>
          <p className="text-center text-xs text-zinc-500">
            Expires {new Date(state.expiresAt).toLocaleTimeString()}
          </p>
        </div>
      )}
    </div>
  )
}
