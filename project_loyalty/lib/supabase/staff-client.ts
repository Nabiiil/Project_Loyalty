'use client'

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

/**
 * Browser-side staff Supabase client (login, sign-out). One module-level
 * singleton so every staff screen shares the same in-memory session — which is
 * also why sign-out MUST go through this instance: clearing cookies alone
 * would leave this client's autoRefreshToken free to write them right back.
 */
export function getStaffClient() {
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          storage: staffCookieStorage,
          // Unique storageKey → unique BroadcastChannel key ('supabase-staff-auth').
          // Without this, the customer SIGNED_IN broadcast overwrites staff_sb-*
          // cookies because both clients share the same default channel key.
          storageKey: 'staff-auth',
          detectSessionInUrl: false,
          persistSession: true,
          autoRefreshToken: true,
        },
      },
    )
  }
  return _client
}
