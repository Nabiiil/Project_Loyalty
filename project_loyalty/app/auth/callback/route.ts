import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import {
  DEVICE_TOKEN_COOKIE,
  DEVICE_TOKEN_QUERY_PARAM,
  DEVICE_TOKEN_MAX_AGE,
} from '@/lib/customer-claim'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(new URL('/signup?error=auth_failed', origin))
  }

  // The anonymous device token is carried through the OAuth round-trip on the
  // redirect URL (GoogleSignInButton), because the SameSite=Lax cookie can be
  // dropped on the cross-site bounce. Prefer the browser's own cookie when it
  // survived; fall back to the carried value. Whatever we resolve is (a) handed
  // to /auth/complete so it can find and claim the existing anonymous row, and
  // (b) re-set as a cookie so the token is restored for the rest of the app.
  const carriedDeviceToken = searchParams.get(DEVICE_TOKEN_QUERY_PARAM)
  const existingCookie = request.cookies.get(DEVICE_TOKEN_COOKIE)?.value ?? null
  const effectiveDeviceToken = existingCookie || carriedDeviceToken || null

  const completeUrl = new URL('/auth/complete', origin)
  if (effectiveDeviceToken) {
    completeUrl.searchParams.set(DEVICE_TOKEN_QUERY_PARAM, effectiveDeviceToken)
  }

  // Build the redirect response first so we can attach cookies to it directly.
  // cookieStore.set() from next/headers does NOT attach to NextResponse.redirect()
  // because they are separate response objects — so we must set cookies on the
  // redirect response explicitly (same pattern as proxy.ts).
  let response = NextResponse.redirect(completeUrl)

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
          response = NextResponse.redirect(completeUrl)
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

  // Restore the device-token cookie if the round-trip dropped it, so the rest of
  // the app (and a retry of /auth/complete) can still resolve the anonymous
  // identity. Only backfill — never clobber a cookie the browser still holds.
  if (!existingCookie && carriedDeviceToken) {
    response.cookies.set(DEVICE_TOKEN_COOKIE, carriedDeviceToken, {
      path: '/',
      maxAge: DEVICE_TOKEN_MAX_AGE,
      sameSite: 'lax',
      httpOnly: false, // must be readable client-side per CLAUDE.md
    })
  }

  return response
}
