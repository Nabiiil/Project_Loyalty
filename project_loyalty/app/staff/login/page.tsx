import { redirect } from 'next/navigation'
import { createStaffClient } from '@/lib/supabase/staff-server'
import { staffLoginOutcome } from '@/lib/auth-guards'
import { LoginForm } from './LoginForm'
import { NotStaffNotice } from './NotStaffNotice'

export default async function StaffLoginPage() {
  const supabase = await createStaffClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Only redirect a user who is ACTUALLY staff. Checking the session alone here
  // (while /staff/dashboard requires a staff_users row) is what created the
  // /staff/login <-> /staff/dashboard loop for authenticated non-staff users.
  let isStaff = false
  if (user) {
    const { data: staff } = await supabase
      .from('staff_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle()
    isStaff = !!staff
  }

  const outcome = staffLoginOutcome({ hasSession: !!user, isStaff })
  if (outcome === 'redirect-to-dashboard') {
    redirect('/staff/dashboard')
  }

  return (
    <main className="min-h-dvh flex items-center justify-center bg-white px-6">
      <div className="w-full max-w-sm flex flex-col gap-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Staff login</h1>
          <p className="text-sm text-gray-500">
            {outcome === 'show-not-staff'
              ? 'You’re signed in, but this account isn’t staff.'
              : 'Sign in to access the dashboard.'}
          </p>
        </div>
        {outcome === 'show-not-staff' ? <NotStaffNotice /> : <LoginForm />}
      </div>
    </main>
  )
}
