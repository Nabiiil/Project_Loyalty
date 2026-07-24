import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(new URL('/signup?error=auth_failed', origin))
  }

  // Build the redirect response first so we can attach cookies to it directly.
  // cookieStore.set() from next/headers does NOT attach to NextResponse.redirect()
  // because they are separate response objects — so we must set cookies on the
  // redirect response explicitly (same pattern as proxy.ts).
  let response = NextResponse.redirect(new URL('/auth/complete', origin))

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.redirect(new URL('/auth/complete', origin))
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    console.error('[auth/callback] exchangeCodeForSession failed:', error.message, error.status)
    console.error('[auth/callback] cookies present:', request.cookies.getAll().map(c => c.name))
    return NextResponse.redirect(new URL('/signup?error=auth_failed', origin))
  }

  return response
}
