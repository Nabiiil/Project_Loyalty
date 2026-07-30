import { redirect } from 'next/navigation'
import { createStaffClient } from '@/lib/supabase/staff-server'
import { getTranslations } from '@/lib/i18n/server'
import { IdentityForm } from './identity-form'
import { SettingsForm } from './settings-form'
import { StaffManager } from './staff-manager'

/**
 * Settings screen — reached from the hamburger menu, owner-only. Loads the
 * owner's own business settings and staff list (RLS scopes both reads to
 * their business) and hands them to the client forms. Saving goes through
 * updateBusinessSettings(); staff management through addStaffLogin() /
 * removeStaffLogin(). Counter staff who hit this URL directly are bounced
 * back to the dashboard — and even if they weren't, every write path
 * re-checks the owner role server-side.
 */
export default async function StaffSettingsPage() {
  const supabase = await createStaffClient()
  const t = await getTranslations('settings')

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/staff/login')
  }

  const { data: staff } = await supabase
    .from('staff_users')
    .select('id, business_id, role')
    .eq('auth_user_id', user.id)
    .single()
  if (!staff) {
    redirect('/staff/login')
  }
  if (staff.role !== 'owner') {
    redirect('/staff/dashboard')
  }

  const { data: business } = await supabase
    .from('businesses')
    .select('name, logo_url, brand_color, reward_threshold, reward_description, earning_mode')
    .eq('id', staff.business_id)
    .single()
  if (!business) {
    redirect('/staff/login')
  }

  // Owner sees every staff login of their business (owner_select_business_staff).
  const { data: staffList } = await supabase
    .from('staff_users')
    .select('id, name, role, created_at')
    .eq('business_id', staff.business_id)
    .order('created_at', { ascending: true })

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-white">
        {t('title')}
      </h1>

      <h2 className="text-lg font-semibold text-black dark:text-white">{t('identitySection')}</h2>
      <IdentityForm
        initialName={business.name}
        initialLogoUrl={business.logo_url}
        initialBrandColor={business.brand_color}
      />

      <h2 className="text-lg font-semibold text-black dark:text-white">{t('loyaltySection')}</h2>
      <SettingsForm
        initialThreshold={business.reward_threshold}
        initialDescription={business.reward_description}
        initialEarningMode={business.earning_mode}
      />

      <StaffManager staffList={staffList ?? []} />
    </section>
  )
}
