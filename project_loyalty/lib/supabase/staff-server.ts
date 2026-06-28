import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// All staff session cookies are prefixed with this string so they never
// share a cookie name with the customer session (which uses the default names).
export const STAFF_COOKIE_PREFIX = 'staff_'

export async function createStaffClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
