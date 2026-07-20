/**
 * One-time local dev setup — run after `npx supabase db reset`.
 * Creates the demo auth accounts via GoTrue admin API and links them to
 * the Demo Café business that seed.sql inserted:
 *   * owner@demo.com — role 'owner'  (settings + staff management)
 *   * staff@demo.com — role 'staff'  (transactions + verify reward only)
 *
 * Usage: node supabase/setup-dev.mjs
 */

const SUPABASE_URL = 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const BUSINESS_ID = 'a0000000-0000-0000-0000-000000000001'

const DEMO_LOGINS = [
  { email: 'owner@demo.com', password: 'password123', name: 'Demo Owner', role: 'owner' },
  { email: 'staff@demo.com', password: 'password123', name: 'Demo Staff', role: 'staff' },
]

for (const login of DEMO_LOGINS) {
  // 1. Create the auth user via GoTrue admin API
  const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      apikey: SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({
      email: login.email,
      password: login.password,
      email_confirm: true,
    }),
  })

  const user = await createRes.json()

  if (!createRes.ok) {
    console.error(`Failed to create auth user ${login.email}:`, user)
    process.exit(1)
  }

  console.log(`✓ Auth user created: ${login.email} (${user.id})`)

  // 2. Insert the staff_users row linking the auth user to the business
  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/staff_users`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      business_id: BUSINESS_ID,
      auth_user_id: user.id,
      name: login.name,
      role: login.role,
    }),
  })

  if (!insertRes.ok) {
    const err = await insertRes.text()
    console.error(`Failed to insert staff_users row for ${login.email}:`, err)
    process.exit(1)
  }

  console.log(`✓ ${login.name} (${login.role}) linked to Demo Café`)
}

console.log('')
console.log('Ready. Log in at http://localhost:3000/staff/login')
for (const login of DEMO_LOGINS) {
  console.log(`  ${login.role.padEnd(5)} — ${login.email} / ${login.password}`)
}
