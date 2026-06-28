'use client'

import { useEffect, useState } from 'react'
import { StampCard } from './StampCard'
import type { ScanResult } from './StampCard'

export default function ScanPage({ params }: { params: Promise<{ token: string }> }) {
  const [result, setResult] = useState<ScanResult | null>(null)
  const [businessName, setBusinessName] = useState<string | null>(null)

  useEffect(() => {
    params.then(async ({ token }) => {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrToken: token }),
      })
      const data = await res.json()
      if (data.ok) {
        setBusinessName(data.businessName)
        setResult({
          ok: true,
          transactionId: data.transactionId,
          businessId: data.businessId,
          customerId: data.customerId,
          deviceToken: data.deviceToken,
          isNewCustomer: data.isNewCustomer,
          enrollmentId: data.enrollmentId,
          currentStamps: data.currentStamps,
          rewardThreshold: data.rewardThreshold,
          rewardReached: data.rewardReached,
        })
      } else {
        setResult({ ok: false, error: data.error ?? 'server_error' })
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!result) {
    return (
      <main className="min-h-dvh flex items-center justify-center bg-white px-6">
        <div className="w-full max-w-xs flex flex-col items-center gap-6 text-center">
          <div className="w-12 h-12 rounded-full border-4 border-gray-200 border-t-gray-900 animate-spin" />
          <p className="text-gray-500">Recording your stamp…</p>
        </div>
      </main>
    )
  }

  return <StampCard result={result} businessName={businessName} />
}
