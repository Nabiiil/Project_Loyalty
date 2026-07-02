/**
 * One-time local dev setup — run after `npx supabase db reset`.
 * Creates the demo staff auth account via GoTrue admin API and links it to
 * the Demo Café business that seed.sql inserted.
 *
 * Usage: node supabase/setup-dev.mjs
 */

const SUPABASE_URL = 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const BUSINESS_ID = 'a0000000-0000-0000-0000-000000000001'
const STAFF_EMAIL = 'staff@demo.com'
const STAFF_PASSWORD = 'password123'

// 1. Create the staff auth user via GoTrue admin API
const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    apikey: SERVICE_ROLE_KEY,
  },
  body: JSON.stringify({
    email: STAFF_EMAIL,
    password: STAFF_PASSWORD,
    email_confirm: true,
  }),
})

const user = await createRes.json()

if (!createRes.ok) {
  console.error('Failed to create auth user:', user)
  process.exit(1)
}

const userId = user.id
console.log(`✓ Auth user created: ${STAFF_EMAIL} (${userId})`)

// 2. Insert the staff_users row linking the auth user to the business
const insertRes = await fetch(
  `${SUPABASE_URL}/rest/v1/staff_users`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      business_id: BUSINESS_ID,
      auth_user_id: userId,
      name: 'Demo Staff',
    }),
  },
)

if (!insertRes.ok) {
  const err = await insertRes.text()
  console.error('Failed to insert staff_users row:', err)
  process.exit(1)
}

console.log('✓ Staff user linked to Demo Café')
console.log('')
console.log('Ready. Log in at http://localhost:3000/staff/login')
console.log(`  Email:    ${STAFF_EMAIL}`)
console.log(`  Password: ${STAFF_PASSWORD}`)
