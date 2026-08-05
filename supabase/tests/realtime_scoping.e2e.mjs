/**
 * Live end-to-end proof that the Realtime scan-confirmation stream is scoped
 * per business by RLS — a staff login of one business cannot receive another
 * business's transaction events over an actual websocket.
 *
 * The subscriptions here are deliberately UNFILTERED ("give me every
 * transactions change") — the strongest possible probe: Supabase Realtime
 * (postgres_changes) may only deliver the rows each subscriber's RLS allows.
 * (It is also the shape the app itself uses: the local Realtime build rejects
 * any column filter at registration, so scan-confirmation.tsx subscribes
 * unfiltered and relies on RLS + a client-side id match.)
 *
 * Companion to realtime_scoping_test.sql (which proves the SELECT policies
 * Realtime enforces). Requires the local stack (`npx supabase start`) and the
 * demo logins (`node supabase/setup-dev.mjs`).
 *
 * Run: node supabase/tests/realtime_scoping.e2e.mjs
 *
 * Scenario:
 *   Business A = Demo Café (owner@demo.com), Business B = a rival created here.
 *   1. Staff A and rival staff B each open an unfiltered subscription.
 *   2. A scan lands at A: staff A must get the event; B must not.
 *   3. A scan lands at B: B must get THAT event (control: B's pipe works,
 *      so the silence in step 2 is RLS denial, not a broken subscription) —
 *      and A must not see B's event either.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(path.join(repoRoot, 'project_loyalty', 'package.json'))
const { createClient } = require('@supabase/supabase-js')

const env = Object.fromEntries(
  readFileSync(path.join(repoRoot, 'project_loyalty', '.env.local'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY

const BIZ_A = 'a0000000-0000-0000-0000-000000000001' // Demo Café (seed.sql)
const BIZ_B = 'b0000000-0000-0000-0000-00000000e2e2' // rival, created below
const RIVAL_EMAIL = 'rt-rival-e2e@test.com'
const RIVAL_PASSWORD = 'password123'

const service = createClient(URL_, SERVICE, { auth: { persistSession: false } })

let failures = 0
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${extra ? ' — ' + extra : ''}`)
  if (!cond) failures++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function cleanup() {
  await service.from('transactions').delete().like('qr_token', 'rt-e2e-%')
  await service.from('businesses').delete().eq('id', BIZ_B)
  const { data } = await service.auth.admin.listUsers({ perPage: 1000 })
  const rival = data?.users?.find((u) => u.email === RIVAL_EMAIL)
  if (rival) await service.auth.admin.deleteUser(rival.id)
}

// ---- Setup ----
await cleanup()
await service.from('businesses').insert({ id: BIZ_B, name: 'RT Rival Cafe', reward_threshold: 10 })
const { data: rivalUser, error: rivalErr } = await service.auth.admin.createUser({
  email: RIVAL_EMAIL,
  password: RIVAL_PASSWORD,
  email_confirm: true,
})
if (rivalErr) throw rivalErr
await service.from('staff_users').insert({
  business_id: BIZ_B,
  auth_user_id: rivalUser.user.id,
  name: 'RT Rival Staff',
  role: 'staff',
})

const { data: txnA } = await service
  .from('transactions')
  .insert({ business_id: BIZ_A, qr_token: `rt-e2e-a-${Date.now()}`, status: 'pending',
    expires_at: new Date(Date.now() + 15 * 60_000).toISOString() })
  .select('id').single()
const { data: txnB } = await service
  .from('transactions')
  .insert({ business_id: BIZ_B, qr_token: `rt-e2e-b-${Date.now()}`, status: 'pending',
    expires_at: new Date(Date.now() + 15 * 60_000).toISOString() })
  .select('id').single()

// ---- Two real signed-in websocket clients ----
const staffA = createClient(URL_, ANON, { auth: { persistSession: false } })
const rival = createClient(URL_, ANON, { auth: { persistSession: false } })
{
  const { error } = await staffA.auth.signInWithPassword({ email: 'owner@demo.com', password: 'password123' })
  if (error) throw new Error(`Demo Café login failed (run node supabase/setup-dev.mjs first): ${error.message}`)
}
{
  const { error } = await rival.auth.signInWithPassword({ email: RIVAL_EMAIL, password: RIVAL_PASSWORD })
  if (error) throw error
}

const received = { staffA: [], rival: [] }

// Unfiltered subscription — registration must be confirmed by the
// postgres_changes system message, not just the phoenix join.
function subscribe(client, channelName, bucket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${channelName}: no registration ack`)), 10_000)
    const ch = client.channel(channelName)
    ch.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'transactions' },
      (payload) => bucket.push(payload.new),
    )
    ch.on('system', {}, (msg) => {
      if (msg.status === 'ok') { clearTimeout(timer); resolve() }
      else { clearTimeout(timer); reject(new Error(`${channelName}: ${msg.message}`)) }
    })
    ch.subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer)
        reject(err ?? new Error(`${channelName}: ${status}`))
      }
    })
  })
}

await subscribe(staffA, 'e2e-staff-a', received.staffA)
await subscribe(rival, 'e2e-rival', received.rival)
console.log('both unfiltered subscriptions registered')

// ---- Scan lands at business A (same UPDATE the scan path performs) ----
await service.from('transactions')
  .update({ status: 'scanned', scanned_at: new Date().toISOString() })
  .eq('id', txnA.id)

const deadlineA = Date.now() + 10_000
while (Date.now() < deadlineA && !received.staffA.some((r) => r.id === txnA.id)) await sleep(200)
check('staff A receives own-business scan event',
  received.staffA.some((r) => r.id === txnA.id && r.status === 'scanned'))

// ---- Scan lands at business B: rival must see it (control) ----
await service.from('transactions')
  .update({ status: 'scanned', scanned_at: new Date().toISOString() })
  .eq('id', txnB.id)
const deadlineB = Date.now() + 10_000
while (Date.now() < deadlineB && !received.rival.some((r) => r.id === txnB.id)) await sleep(200)
check('rival receives their OWN business event (control: pipe works)',
  received.rival.some((r) => r.id === txnB.id))

await sleep(3_000) // grace window for any late cross-business delivery

check('rival never received business A\'s event (RLS denial on an unfiltered subscription)',
  !received.rival.some((r) => r.id === txnA.id),
  `rival saw ${received.rival.length} event(s), all their own`)
check('staff A never received business B\'s event',
  !received.staffA.some((r) => r.id === txnB.id))

// ---- Teardown ----
await staffA.removeAllChannels()
await rival.removeAllChannels()
await cleanup()

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
