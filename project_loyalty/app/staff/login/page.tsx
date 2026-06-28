import { redirect } from 'next/navigation'
import { createStaffClient } from '@/lib/supabase/staff-server'
import { LoginForm } from './LoginForm'

export default async function StaffLoginPage() {
  const supabase = await createStaffClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/staff/dashboard')

  return (
    <main className="min-h-dvh flex items-center justify-center bg-white px-6">
      <div className="w-full max-w-sm flex flex-col gap-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Staff login</h1>
          <p className="text-sm text-gray-500">Sign in to access the dashboard.</p>
        </div>
        <LoginForm />
      </div>
    </main>
  )
}
