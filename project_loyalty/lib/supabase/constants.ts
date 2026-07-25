/**
 * Pure, dependency-free constants for the staff/customer cookie split.
 *
 * This module deliberately has NO imports — no next/headers, no service-role
 * client, no Node APIs — so the Edge-runtime middleware can import these values
 * without pulling in any server-only code. staff-server.ts (Node) and
 * staff-client.ts (browser) import the same constants, so the cookie namespace
 * has a single source of truth shared across all three runtimes.
 */

// Every staff session cookie is prefixed with this so it never collides with
// the customer session cookies (which use @supabase/ssr's default names).
export const STAFF_COOKIE_PREFIX = 'staff_'

// GoTrue storageKey for the staff auth client. Must match across the browser
// client, the server client, and the middleware so all three read and write the
// same staff-prefixed 'staff_staff-auth' cookie(s).
export const STAFF_AUTH_STORAGE_KEY = 'staff-auth'
