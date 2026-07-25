import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { STAFF_COOKIE_PREFIX } from '@/lib/supabase/staff-server'

export async function middleware(request: NextRequest) {
  // Supabase local sometimes ignores emailRedirectTo and sends the auth code
  // to site_url (i.e. /?code=...). Catch that and forward to the real callback.
  const { pathname, search } = new URL(request.url)
  if (pathname === '/' && new URL(request.url).searchParams.has('code')) {
    return NextResponse.redirect(new URL('/auth/callback' + search, request.url))
  }

  let supabaseResponse = NextResponse.next({ request })

  const isStaffRoute = pathname.startsWith('/staff')

  // Staff and customer use completely separate cookie namespaces.
  // Staff cookies are prefixed with STAFF_COOKIE_PREFIX; customer cookies use
  // @supabase/ssr's default names. The two never overlap.
  const cookieHandlers = isStaffRoute
    ? {
        getAll() {
          return request.cookies
            .getAll()
            .filter(c => c.name.startsWith(STAFF_COOKIE_PREFIX))
            .map(c => ({ ...c, name: c.name.slice(STAFF_COOKIE_PREFIX.length) }))
        },
        setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(STAFF_COOKIE_PREFIX + name, value),
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(STAFF_COOKIE_PREFIX + name, value, options as never),
          )
        },
      }
    : {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options as never),
          )
        },
      }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: cookieHandlers,
      // Staff routes must use the same storageKey as the browser staff client
      // so GoTrue searches for 'staff-auth' in the stripped-prefix cookie list.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(isStaffRoute ? { auth: { storageKey: 'staff-auth' } as any } : {}),
    },
  )

  await supabase.auth.getUser()

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
