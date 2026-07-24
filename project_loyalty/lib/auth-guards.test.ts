import { describe, it, expect } from 'vitest'
import { staffLoginOutcome, customerDashboardOutcome } from './auth-guards'

describe('staffLoginOutcome (staff side)', () => {
  it('shows the login form when there is no session', () => {
    expect(staffLoginOutcome({ hasSession: false, isStaff: false })).toBe('show-login-form')
    // isStaff is irrelevant with no session.
    expect(staffLoginOutcome({ hasSession: false, isStaff: true })).toBe('show-login-form')
  })

  it('redirects only a real staff member to the dashboard', () => {
    expect(staffLoginOutcome({ hasSession: true, isStaff: true })).toBe('redirect-to-dashboard')
  })

  // The regression: an authenticated user who is NOT staff must never be
  // redirected — that was the /staff/login <-> /staff/dashboard loop.
  it('shows the not-staff notice (never redirects) for an authenticated non-staff user', () => {
    expect(staffLoginOutcome({ hasSession: true, isStaff: false })).toBe('show-not-staff')
  })

  it('never returns redirect-to-dashboard without staff membership', () => {
    for (const hasSession of [true, false]) {
      expect(staffLoginOutcome({ hasSession, isStaff: false })).not.toBe('redirect-to-dashboard')
    }
  })
})

describe('customerDashboardOutcome (reverse side)', () => {
  it('shows the signed-out / create-account state only with no session AND no device token', () => {
    expect(
      customerDashboardOutcome({ hasSession: false, hasDeviceToken: false, hasEnrollments: false }),
    ).toBe('render-signed-out')
  })

  // The reverse of the staff case: an authenticated user who is NOT a customer
  // (no enrollments / no customer row) is rendered in place, NEVER redirected —
  // so the customer side can't develop the mirror-image loop.
  it('renders (does not redirect) an authenticated user who is not a customer', () => {
    const outcome = customerDashboardOutcome({
      hasSession: true,
      hasDeviceToken: false,
      hasEnrollments: false,
    })
    expect(outcome).toBe('render-empty')
    expect(outcome).not.toBe('render-signed-out')
  })

  it('renders cards when there are enrollments (session or device token)', () => {
    expect(
      customerDashboardOutcome({ hasSession: true, hasDeviceToken: false, hasEnrollments: true }),
    ).toBe('render-cards')
    expect(
      customerDashboardOutcome({ hasSession: false, hasDeviceToken: true, hasEnrollments: true }),
    ).toBe('render-cards')
  })

  it('always renders (one of three render states) — never a redirect signal', () => {
    const renderStates = ['render-signed-out', 'render-empty', 'render-cards']
    for (const hasSession of [true, false]) {
      for (const hasDeviceToken of [true, false]) {
        for (const hasEnrollments of [true, false]) {
          expect(renderStates).toContain(
            customerDashboardOutcome({ hasSession, hasDeviceToken, hasEnrollments }),
          )
        }
      }
    }
  })
})
