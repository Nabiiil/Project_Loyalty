/**
 * Display-name normalisation — pure, shared, and unit-tested so the rule that
 * "unset means NULL" holds identically in the action and in the database.
 *
 * The matching CHECK constraint lives in
 * supabase/migrations/20260808120000_customer_display_name.sql. This module is
 * the friendly gate (it reports a length problem the customer can fix); the
 * constraint is the structural one that holds even if a future writer forgets
 * to call this. They agree on the cap and on the trimmed, non-empty shape.
 */

/**
 * Matches `char_length(display_name) between 1 and 60` in the DB constraint.
 * Long enough for a full name in any of the three supported languages, short
 * enough that it cannot wreck the dashboard header it renders into.
 */
export const DISPLAY_NAME_MAX_LENGTH = 60

/**
 * Query param /auth/complete sets on its redirect to invite a name.
 *
 * A one-navigation signal on purpose. It exists only on the hop straight out of
 * a successful signup, so the prompt cannot reappear on later visits just
 * because the customer still has no name — that would be the nagging this
 * feature is explicitly not.
 */
export const NAME_PROMPT_PARAM = 'welcome'

/**
 * localStorage key recording that the customer skipped the prompt. Belt and
 * braces on top of the one-shot param: it also covers reloading or re-sharing
 * the post-signup URL.
 */
export const NAME_PROMPT_DISMISSED_KEY = 'loyalty.namePrompt.dismissed'

export type DisplayNameResult =
  | { ok: true; value: string | null }
  | { ok: false; error: 'too_long' }

/**
 * Count the way Postgres does. `char_length` counts characters (code points),
 * while JS `.length` counts UTF-16 units — so an emoji or any astral character
 * costs 2 in JS and 1 in Postgres. Counting code points here keeps the app from
 * rejecting a name the database would happily accept.
 */
function characterCount(value: string): number {
  return [...value].length
}

/**
 * Trim, collapse internal whitespace runs, and treat blank as absent.
 *
 * Empty becomes `null`, never `''`: an empty string is a value that renders as
 * a nameless greeting and sorts as "set", and having two representations of
 * "the customer hasn't filled this in" invites bugs at every reader.
 *
 * Whitespace collapsing covers the paste that carries a newline or a double
 * space — a real, quiet source of names that look broken on the dashboard.
 * Beyond that this is deliberately permissive: any script, punctuation, and
 * emoji are all legitimate in a name someone chose for themselves.
 */
export function normalizeDisplayName(raw: string | null | undefined): DisplayNameResult {
  if (raw == null) return { ok: true, value: null }

  const collapsed = raw.replace(/\s+/g, ' ').trim()

  if (collapsed === '') return { ok: true, value: null }
  if (characterCount(collapsed) > DISPLAY_NAME_MAX_LENGTH) return { ok: false, error: 'too_long' }

  return { ok: true, value: collapsed }
}

/**
 * Fields an OAuth provider may carry a human name in, best first.
 *
 * Google populates `full_name` and `name` identically in most cases and
 * `given_name` with just the first name. Falling through matters for the
 * oversized case: rather than truncating a 70-character full name into
 * something mangled, we try the shorter legitimate field the provider already
 * gave us, and store nothing if none of them fit.
 */
const OAUTH_NAME_KEYS = ['full_name', 'name', 'given_name'] as const

/**
 * Pull a usable display name out of an OAuth identity payload, or null.
 *
 * Applies exactly the same normalisation as a name typed by hand, so a value
 * arriving this way can never violate the shape constraint the database
 * enforces. Anything that fails — absent, blank, wrong type, too long — comes
 * back as null, because the alternative (a truncated or malformed name silently
 * attached to someone's account) is worse than no name at all.
 */
export function displayNameFromOAuthMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  if (!metadata) return null

  for (const key of OAUTH_NAME_KEYS) {
    const raw = metadata[key]
    if (typeof raw !== 'string') continue
    const result = normalizeDisplayName(raw)
    if (result.ok && result.value !== null) return result.value
  }

  return null
}
