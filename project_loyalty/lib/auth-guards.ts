/**
 * Redirect guards for the two sign-in surfaces, expressed as pure decisions so
 * the loop-avoidance rule is unit-testable and identical on both sides.
 *
 * The bug these prevent: /staff/login used to redirect ANY authenticated user
 * to /staff/dashboard, while /staff/dashboard (and settings/analytics/history)
 * redirect anyone WITHOUT a staff_users row back to /staff/login — so a user
 * who is authenticated but not staff (e.g. someone who signed in at the staff
 * form with valid Supabase credentials that aren't linked to a staff record)
 * bounced between the two forever.
 *
 * The rule on BOTH surfaces is the same: only redirect a user who actually
 * BELONGS on the destination; otherwise render in place. Membership — not the
 * mere presence of a session — decides.
 */

export type StaffLoginOutcome =
  | 'show-login-form' // no session — show the sign-in form
  | 'redirect-to-dashboard' // authenticated AND a staff member — go to the dashboard
  | 'show-not-staff' // authenticated but NOT staff — show a notice, never redirect

export function staffLoginOutcome(input: {
  hasSession: boolean
  isStaff: boolean
}): StaffLoginOutcome {
  if (!input.hasSession) return 'show-login-form'
  return input.isStaff ? 'redirect-to-dashboard' : 'show-not-staff'
}

export type CustomerDashboardOutcome =
  | 'render-signed-out' // no session and no device token — show sign-in / create-account
  | 'render-empty' // belongs here (session or device token) but no cards yet
  | 'render-cards' // has enrollments to show

/**
 * The reverse guard. The customer dashboard is public-facing: an authenticated
 * user who has no customer row is NOT redirected away (that would be the
 * mirror-image loop) — they render the empty state. This function never yields
 * a redirect, which is the invariant the test pins down.
 */
export function customerDashboardOutcome(input: {
  hasSession: boolean
  hasDeviceToken: boolean
  hasEnrollments: boolean
}): CustomerDashboardOutcome {
  if (!input.hasSession && !input.hasDeviceToken) return 'render-signed-out'
  return input.hasEnrollments ? 'render-cards' : 'render-empty'
}
