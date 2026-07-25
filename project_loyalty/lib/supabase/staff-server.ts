import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { STAFF_COOKIE_PREFIX, STAFF_AUTH_STORAGE_KEY } from './constants'

export async function createStaffClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // storageKey must match the browser staff client so the server looks for
      // 'staff-auth' in the stripped-prefix cookies (staff_staff-auth → staff-auth).
      // @supabase/ssr omits storageKey from its auth type but GoTrue still honours it.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      auth: { storageKey: STAFF_AUTH_STORAGE_KEY } as any,
      cookies: {
        getAll() {
          // Strip the prefix before handing to GoTrue so it sees normal key names.
          return cookieStore
            .getAll()
            .filter(c => c.name.startsWith(STAFF_COOKIE_PREFIX))
            .map(c => ({ ...c, name: c.name.slice(STAFF_COOKIE_PREFIX.length) }))
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(STAFF_COOKIE_PREFIX + name, value, options),
            )
          } catch {
            // Server Component — writes handled by proxy.
          }
        },
      },
    },
  )
}
