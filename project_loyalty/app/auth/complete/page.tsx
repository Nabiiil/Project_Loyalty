import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export default async function AuthCompletePage() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()

  if (!user) {
    redirect('/signup?error=auth_failed')
  }

  const cookieStore = await cookies()
  const deviceToken = cookieStore.get('device_token')?.value ?? null

  const service = createServiceClient()

  // Find or create the customer row for this auth user
  const { data: existing } = await service
    .from('customers')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  let customerId: string
  if (existing) {
    customerId = existing.id
  } else {
    const { data: created } = await service
      .from('customers')
      .insert({
        auth_user_id: user.id,
        email: user.email ?? null,
        phone_number: user.phone ?? null,
        signup_source: 'direct_signup',
        claimed_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    customerId = created!.id
  }

  // Merge anonymous stamps if a device_token cookie is present.
  // Runs on both signup and login — auth session always wins going forward.
  if (deviceToken) {
    const { data: anonCustomer } = await service
      .from('customers')
      .select('id')
      .eq('device_token', deviceToken)
      .is('auth_user_id', null)
      .maybeSingle()

    if (anonCustomer && anonCustomer.id !== customerId) {
      const { data: anonEnrollments } = await service
        .from('enrollments')
        .select('id, business_id, current_stamps')
        .eq('customer_id', anonCustomer.id)

      for (const anon of anonEnrollments ?? []) {
        const { data: claimed } = await service
          .from('enrollments')
          .select('id, current_stamps')
          .eq('customer_id', customerId)
          .eq('business_id', anon.business_id)
          .maybeSingle()

        if (claimed) {
          // Both customers have stamps at this business — add them together
          await service
            .from('enrollments')
            .update({ current_stamps: claimed.current_stamps + anon.current_stamps })
            .eq('id', claimed.id)
          await service.from('enrollments').delete().eq('id', anon.id)
        } else {
          // Reassign the enrollment to the auth customer
          await service
            .from('enrollments')
            .update({ customer_id: customerId })
            .eq('id', anon.id)
        }
      }

      // Remove the now-empty anonymous customer row
      await service.from('customers').delete().eq('id', anonCustomer.id)
    }
  }

  redirect('/dashboard')
}
