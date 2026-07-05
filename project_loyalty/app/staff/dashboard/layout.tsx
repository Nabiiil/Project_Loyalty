import { redirect } from 'next/navigation'
import { createStaffClient } from '@/lib/supabase/staff-server'
import { StaffNav } from './StaffNav'

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

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/staff/login')
  }

  // Confirm this auth user is actually staff and load their business.
  const { data: staff } = await supabase
    .from('staff_users')
    .select('name, business_id')
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

  const businessName = business?.name ?? 'your business'

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-5 py-8">
      <header className="flex flex-col gap-3">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {businessName}
          {staff.name ? ` · ${staff.name}` : ''}
        </p>
        <StaffNav />
      </header>

      {children}
    </main>
  )
}
