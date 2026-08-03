'use client'

import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/database.types'
import { STAFF_COOKIE_PREFIX, STAFF_AUTH_STORAGE_KEY } from './constants'

/**
 * Browser-side staff Supabase client (login, sign-out, and the live
 * scan-confirmation reads/realtime).
 *
 * Built on @supabase/ssr's createBrowserClient — NOT plain @supabase/supabase-js
 * with a hand-rolled cookie storage — so it reads and writes the staff session
 * cookie in the EXACT SAME format the proxy (proxy.ts) and server client
 * (staff-server.ts) use: base64url-encoded and chunked, keyed by the staff
 * storageKey, physically prefixed with STAFF_COOKIE_PREFIX.
 *
 * Why this matters (the bug this fixes): the previous plain client stored the
 * session as a single raw-JSON cookie. Once the proxy refreshed the token it
 * rewrote `staff_staff-auth` in ssr's `base64-…` format; the plain client then
 * failed to JSON.parse it, getSession() returned null, and every browser staff
 * request (the scan-confirmation transactions read AND the Realtime channel
 * auth) silently fell back to the anon key — which staff RLS correctly denies
 * (401 / 42501), so the "code scanned" banner never fired. Sharing one cookie
 * format across all three runtimes is what lets getSession() resolve the staff
 * JWT so those requests carry the staff user's token.
 *
 * Two things preserve the prior guarantees:
 * - `isSingleton: false` keeps this instance out of @supabase/ssr's shared
 *   browser-client cache, so it never collides with the customer client
 *   (lib/supabase/client.ts) — the isolation the old comment worried about.
 * - our own module-level `_client` memo keeps ONE staff instance per tab, which
 *   is why sign-out must go through it (clearing cookies alone would let this
 *   client's autoRefreshToken write them straight back).
 */

/** Parse a `document.cookie` string into name/value pairs (values decoded). */
export function parseDocumentCookies(cookieString: string): { name: string; value: string }[] {
  if (!cookieString) return []
  return cookieString
    .split('; ')
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=')
      const name = eq === -1 ? pair : pair.slice(0, eq)
      const rawValue = eq === -1 ? '' : pair.slice(eq + 1)
      let value = rawValue
      try {
        value = decodeURIComponent(rawValue)
      } catch {
        // Leave malformed percent-encoding as-is rather than throwing.
      }
      return { name, value }
    })
}

/**
 * Keep only the staff-namespaced cookies and strip the prefix, so GoTrue sees
 * plain key names (`staff_staff-auth` → `staff-auth`). Mirrors the getAll side
 * of staff-server.ts / proxy.ts.
 */
export function toStaffScopedCookies(
  cookies: { name: string; value: string }[],
): { name: string; value: string }[] {
  return cookies
    .filter((c) => c.name.startsWith(STAFF_COOKIE_PREFIX))
    .map((c) => ({ name: c.name.slice(STAFF_COOKIE_PREFIX.length), value: c.value }))
}

type CookieOptions = {
  path?: string
  domain?: string
  maxAge?: number
  expires?: Date
  sameSite?: boolean | 'lax' | 'strict' | 'none'
  secure?: boolean
  // httpOnly is intentionally ignored: the browser cannot set it via
  // document.cookie, and the staff session cookie is httpOnly:false by design.
}

/**
 * Serialize a single Set-Cookie for `document.cookie`, re-adding the staff
 * prefix (`staff-auth` → `staff_staff-auth`). Mirrors the setAll side of
 * staff-server.ts / proxy.ts and the encoding @supabase/ssr uses on the server.
 */
export function serializeStaffCookie(
  name: string,
  value: string,
  options: CookieOptions = {},
): string {
  const parts = [`${STAFF_COOKIE_PREFIX}${name}=${encodeURIComponent(value)}`]
  parts.push(`Path=${options.path ?? '/'}`)
  if (options.domain) parts.push(`Domain=${options.domain}`)
  if (typeof options.maxAge === 'number') parts.push(`Max-Age=${options.maxAge}`)
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`)
  if (options.sameSite) {
    const sameSite = options.sameSite === true ? 'Strict' : options.sameSite
    parts.push(`SameSite=${sameSite}`)
  }
  if (options.secure) parts.push('Secure')
  return parts.join('; ')
}

/**
 * Cookie adapter backing the staff client on the browser: reads/writes
 * `document.cookie` under the staff prefix. @supabase/ssr layers its own
 * base64url encoding and chunking on top, so this only handles the physical
 * prefix + document.cookie IO — the same division of labor as the server
 * adapter, which is what keeps the two formats identical.
 */
const staffBrowserCookies = {
  getAll() {
    if (typeof document === 'undefined') return []
    return toStaffScopedCookies(parseDocumentCookies(document.cookie))
  },
  setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
    if (typeof document === 'undefined') return
    for (const { name, value, options } of cookiesToSet) {
      document.cookie = serializeStaffCookie(name, value, options)
    }
  },
}

let _client: ReturnType<typeof createBrowserClient<Database>> | null = null

export function getStaffClient() {
  if (!_client) {
    _client = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        // Never share @supabase/ssr's cached browser singleton with the customer
        // client — a separate staff instance with its own session.
        isSingleton: false,
        // cookieOptions.name sets the GoTrue storageKey; combined with the staff
        // prefix in the adapter above the physical cookie is `staff_staff-auth`,
        // matching proxy.ts and staff-server.ts exactly.
        cookieOptions: { name: STAFF_AUTH_STORAGE_KEY },
        cookies: staffBrowserCookies,
        auth: {
          detectSessionInUrl: false,
          persistSession: true,
          autoRefreshToken: true,
        },
      },
    )
  }
  return _client
}
