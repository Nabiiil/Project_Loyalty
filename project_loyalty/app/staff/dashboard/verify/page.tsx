import { VerifyRewardForm } from '../verify-reward-form'
import { getTranslations } from '@/lib/i18n/server'

/**
 * Screen 2 — Verify reward (separate, lower-frequency, higher-stakes screen).
 * Staff enters the customer's redemption code; submit calls the server-side
 * verify_redemption logic and shows an unambiguous valid / not-eligible result.
 * Auth is handled by the segment layout.
 */
export default async function StaffVerifyRewardPage() {
  const t = await getTranslations('staff')
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-white">
        {t('verifyReward')}
      </h1>
      <VerifyRewardForm />
    </section>
  )
}
