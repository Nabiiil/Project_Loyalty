import { TransactionScreen } from './transaction-screen'
import { getTranslations } from '@/lib/i18n/server'

/**
 * Screen 1 — New transaction (default landing after staff login).
 * The high-frequency screen: staff taps once and a large transaction QR fills
 * the view for the customer to scan, then a Realtime confirmation appears the
 * moment the scan lands. The manual-stamp fallback sits below, collapsed and
 * de-emphasized, so it never competes with the QR flow. Auth is handled by the
 * segment layout; every action re-checks staff server-side.
 */
export default async function StaffNewTransactionPage() {
  const t = await getTranslations('staff')
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-white">
        {t('newTransaction')}
      </h1>
      <TransactionScreen />
    </section>
  )
}
