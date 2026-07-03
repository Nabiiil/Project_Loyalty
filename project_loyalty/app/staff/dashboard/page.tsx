import { redirect } from 'next/navigation'
import { createStaffClient } from '@/lib/supabase/staff-server'
import { NewTransactionForm } from './new-transaction-form'
import { VerifyRewardForm } from './verify-reward-form'

export default async function StaffDashboardPage() {
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
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-5 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-white">
          New transaction
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {businessName}
          {staff.name ? ` · ${staff.name}` : ''}
        </p>
      </header>

      <NewTransactionForm />

      <VerifyRewardForm />
    </main>
  )
}
