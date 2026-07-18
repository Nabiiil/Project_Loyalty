'use client'

import { SignupInvite } from '@/components/SignupInvite'

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

const ERROR_COPY: Record<string, string> = {
  already_scanned: 'This QR code has already been scanned.',
  token_expired: 'This QR code has expired — ask for a new one.',
  invalid_token: 'This QR code is not valid.',
  invalid_signature: 'This QR code is not valid.',
  customer_not_found: 'Account not found. Please sign in again.',
  server_error: 'Something went wrong. Please try again.',
}

type Props = {
  result: ScanResult
  businessName: string | null
}

export function StampCard({ result, businessName }: Props) {
  if (!result.ok) {
    const message = ERROR_COPY[result.error] ?? ERROR_COPY.server_error
    return (
      <main className="min-h-dvh flex items-center justify-center bg-white px-6">
        <div className="w-full max-w-xs text-center space-y-4">
          <span className="text-5xl" aria-hidden>⚠️</span>
          <p className="text-lg font-medium text-gray-800">{message}</p>
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
              <h1 className="text-3xl font-bold text-gray-900">Free reward!</h1>
              <p className="text-gray-500">Show this screen to collect your reward.</p>
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
              <h1 className="text-3xl font-bold text-gray-900">Stamp added!</h1>
              <p className="text-gray-500">
                {stampsLeft === 1 ? '1 more stamp to go' : `${stampsLeft} more stamps to go`}
              </p>
            </div>
          </>
        )}

        <StampGrid current={currentStamps} total={rewardThreshold} />

        <p className="text-sm text-gray-400" aria-label="stamp count">
          {currentStamps} / {rewardThreshold}
        </p>

        <a href="/dashboard" className="text-sm text-gray-400 underline underline-offset-2">
          View all my cards
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
