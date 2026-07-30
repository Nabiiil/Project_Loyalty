import { redirect } from 'next/navigation'
import { createStaffClient } from '@/lib/supabase/staff-server'
import { getTranslations } from '@/lib/i18n/server'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { StaffNav } from './StaffNav'
import { StaffMenu } from './StaffMenu'

/**
 * Shared shell for the staff screens. Runs the auth/staff check once and renders
 * the top-level navigation between the two dedicated screens (New transaction /
 * Verify reward). Server actions re-check auth independently on submit.
 */
export default async function StaffDashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createStaffClient()
  const t = await getTranslations('staff')

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/staff/login')
  }

  // Confirm this auth user is actually staff and load their business.
  const { data: staff } = await supabase
    .from('staff_users')
    .select('name, business_id, role')
    .eq('auth_user_id', user.id)
    .single()
  if (!staff) {
    redirect('/staff/login')
  }

  const { data: business } = await supabase
    .from('businesses')
    .select('name')
    .eq('id', staff.business_id)
    .single()

  const businessName = business?.name ?? t('yourBusiness')

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-5 py-8">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {/* Everyone gets the menu (it holds the account info + sign-out);
                owner-only entries like Settings are filtered inside it. That
                filtering is UX only — the settings page and every owner action
                re-verify the role server-side. */}
            <StaffMenu name={staff.name} role={staff.role} />
            <p className="truncate text-sm text-zinc-600 dark:text-zinc-400">
              {businessName}
              {staff.name ? ` · ${staff.name}` : ''}
            </p>
          </div>
          <LanguageSwitcher />
        </div>
        <StaffNav />
      </header>

      {children}
    </main>
  )
}
