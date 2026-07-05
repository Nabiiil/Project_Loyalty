import { NewTransactionForm } from './new-transaction-form'

/**
 * Screen 1 — New transaction (default landing after staff login).
 * The high-frequency screen: staff taps once and a large transaction QR fills
 * the view for the customer to scan. Auth is handled by the segment layout.
 */
export default function StaffNewTransactionPage() {
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-white">
        New transaction
      </h1>
      <NewTransactionForm />
    </section>
  )
}
