'use client'

import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const STAFF_COOKIE_PREFIX = 'staff_'

// Custom cookie storage adapter that physically prefixes every cookie name with
// STAFF_COOKIE_PREFIX. This keeps staff session cookies completely separate from
// the customer session cookies that @supabase/ssr writes under its own names.
// Using createClient from @supabase/supabase-js directly avoids the
// @supabase/ssr module-level singleton, which would otherwise share one instance
// (and one session) between staff and customer regardless of any storageKey option.
const staffCookieStorage = {
  getItem(key: string): string | null {
    if (typeof document === 'undefined') return null
    const name = STAFF_COOKIE_PREFIX + key
    const match = document.cookie.split('; ').find(row => row.startsWith(name + '='))
    return match ? decodeURIComponent(match.slice(name.length + 1)) : null
  },
  setItem(key: string, value: string): void {
    if (typeof document === 'undefined') return
    const name = STAFF_COOKIE_PREFIX + key
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 7}; samesite=lax`
  },
  removeItem(key: string): void {
    if (typeof document === 'undefined') return
    const name = STAFF_COOKIE_PREFIX + key
    document.cookie = `${name}=; path=/; max-age=0; samesite=lax`
  },
}

let _client: ReturnType<typeof createClient> | null = null

function getStaffClient() {
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          storage: staffCookieStorage,
          detectSessionInUrl: false,
          persistSession: true,
          autoRefreshToken: true,
        },
      },
    )
  }
  return _client
}

export function LoginForm() {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setPending(true)

    const form = new FormData(e.currentTarget)
    const email = form.get('email') as string
    const password = form.get('password') as string

    const { error: authError } = await getStaffClient().auth.signInWithPassword({ email, password })

    if (authError) {
      setError('Invalid email or password.')
      setPending(false)
      return
    }

    window.location.href = '/staff/dashboard'
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
        Email
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          className="h-12 rounded-lg border border-gray-300 px-4 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
        Password
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          className="h-12 rounded-lg border border-gray-300 px-4 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
        />
      </label>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="h-14 w-full rounded-lg bg-gray-900 text-base font-semibold text-white disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
