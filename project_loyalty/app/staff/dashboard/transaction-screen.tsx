'use client'

import { useState } from 'react'
import { NewTransactionForm } from './new-transaction-form'
import { ManualStampForm } from './manual-stamp-form'

/**
 * Client coordinator for the New transaction screen: owns the manual form's
 * open state so the scan-confirmation timeout ("no scan arrived") can open the
 * manual fallback directly instead of leaving staff to find it themselves.
 */
export function TransactionScreen() {
  const [manualOpen, setManualOpen] = useState(false)

  return (
    <>
      <NewTransactionForm onRequestManual={() => setManualOpen(true)} />
      <ManualStampForm open={manualOpen} onOpenChange={setManualOpen} />
    </>
  )
}
