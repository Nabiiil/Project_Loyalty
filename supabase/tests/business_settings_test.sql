-- ============================================================
-- Tests for update_business_settings()
-- Run: psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/business_settings_test.sql
--
-- Self-contained: builds two businesses (each with staff) and a spread of
-- enrollments, then exercises validation, business scoping, and — the important
-- one — that raising the reward threshold never revokes eligibility a customer
-- had already earned. Safe to re-run (cleans up at the end).
-- ============================================================
\set ON_ERROR_STOP on

-- ============================================================
-- Setup
-- ============================================================
insert into businesses (id, name, reward_threshold, reward_description)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb001', 'Settings Cafe', 10, 'Free item');

-- A rival business + staff, to prove a staff member can only edit their own.
insert into businesses (id, name, reward_threshold, reward_description)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb002', 'Rival Cafe', 10, 'Free item');

insert into auth.users (id, instance_id, email, aud, role, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa001','00000000-0000-0000-0000-000000000000',
   'staff-settings@test.com','authenticated','authenticated',now(),now(),'','','',''),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa002','00000000-0000-0000-0000-000000000000',
   'staff-rival2@test.com','authenticated','authenticated',now(),now(),'','','','');

-- Settings changes are owner-only since the staff-roles migration, so the
-- acting login must be an owner. (Role-denial cases live in staff_roles_test.sql.)
insert into staff_users (business_id, auth_user_id, name, role) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa001','Settings Owner','owner'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa002','Rival Owner','owner');

-- Three anonymous customers at Settings Cafe, across the threshold boundary.
--   below   :  8 stamps  (was NOT eligible at 10)
--   exactly : 10 stamps  (JUST eligible at 10 — earned the reward)
--   over    : 12 stamps  (eligible + extra progress)
insert into customers (id, device_token, signup_source) values
  ('dddddddd-dddd-dddd-dddd-ddddddddd001','dev-below','qr_scan'),
  ('dddddddd-dddd-dddd-dddd-ddddddddd002','dev-exact','qr_scan'),
  ('dddddddd-dddd-dddd-dddd-ddddddddd003','dev-over','qr_scan');

insert into enrollments (id, customer_id, business_id, current_stamps) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeee001','dddddddd-dddd-dddd-dddd-ddddddddd001','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb001', 8),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeee002','dddddddd-dddd-dddd-dddd-ddddddddd002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb001', 10),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeee003','dddddddd-dddd-dddd-dddd-ddddddddd003','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb001', 12);

-- ============================================================
-- TEST 1: Not staff -> rejected
-- ============================================================
do $$
declare v_result jsonb;
begin
  v_result := public.update_business_settings(5, 'Free coffee', 'per_transaction',
    '00000000-0000-0000-0000-0000000000ff'::uuid);
  raise notice 'TEST 1 result: %', v_result;
  assert not (v_result->>'ok')::boolean and v_result->>'error' = 'not_staff',
    format('FAIL TEST 1: expected not_staff, got %s', v_result);
  raise notice 'PASS TEST 1: non-staff rejected';
end;
$$;

-- ============================================================
-- TEST 2: Server-side validation (threshold < 1, blank desc, bad mode)
-- ============================================================
do $$
declare v_result jsonb;
begin
  v_result := public.update_business_settings(0, 'Free coffee', 'per_transaction',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa001'::uuid);
  assert v_result->>'error' = 'invalid_threshold',
    format('FAIL TEST 2a: expected invalid_threshold, got %s', v_result);

  v_result := public.update_business_settings(5, '   ', 'per_transaction',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa001'::uuid);
  assert v_result->>'error' = 'invalid_description',
    format('FAIL TEST 2b: expected invalid_description, got %s', v_result);

  v_result := public.update_business_settings(5, 'Free coffee', 'per_amount',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa001'::uuid);
  assert v_result->>'error' = 'invalid_earning_mode',
    format('FAIL TEST 2c: expected invalid_earning_mode (per_amount not built), got %s', v_result);

  raise notice 'PASS TEST 2: server-side validation enforced';
end;
$$;

-- ============================================================
-- TEST 3: Threshold INCREASE preserves earned eligibility
--   Raise 10 -> 15. Already-qualified customers (>= 10) must stay redeemable.
-- ============================================================
do $$
declare v_result jsonb; v_below int; v_exact int; v_over int;
begin
  v_result := public.update_business_settings(15, 'Free coffee', 'per_transaction',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa001'::uuid);
  raise notice 'TEST 3 result: %', v_result;
  assert (v_result->>'ok')::boolean, format('FAIL TEST 3: %s', v_result);

  select current_stamps into v_below from enrollments where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeee001';
  select current_stamps into v_exact from enrollments where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeee002';
  select current_stamps into v_over  from enrollments where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeee003';

  -- Not-yet-eligible customer is untouched (still working toward the reward).
  assert v_below = 8, format('FAIL TEST 3: below-threshold changed, got %s', v_below);
  -- Already-eligible customers are topped up to the new threshold so they stay
  -- redeemable — a raise must never revoke a reward already earned.
  assert v_exact = 15, format('FAIL TEST 3: exactly-eligible not preserved, got %s', v_exact);
  assert v_over = 15,  format('FAIL TEST 3: over-eligible not preserved, got %s', v_over);

  -- And they are in fact still eligible under the new threshold.
  assert v_exact >= 15 and v_over >= 15, 'FAIL TEST 3: preserved customers not eligible';
  raise notice 'PASS TEST 3: threshold raise preserves earned eligibility';
end;
$$;

-- ============================================================
-- TEST 4: Threshold DECREASE applies going forward (no revocation issue)
--   Lower 15 -> 5. Everyone at/above 5 is naturally eligible; no bumping needed.
-- ============================================================
do $$
declare v_result jsonb; v_below int;
begin
  v_result := public.update_business_settings(5, 'Free coffee', 'per_transaction',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa001'::uuid);
  assert (v_result->>'ok')::boolean, format('FAIL TEST 4: %s', v_result);

  -- The previously below-threshold customer (8) is untouched and now eligible.
  select current_stamps into v_below from enrollments where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeee001';
  assert v_below = 8, format('FAIL TEST 4: decrease should not mutate stamps, got %s', v_below);
  raise notice 'PASS TEST 4: threshold decrease leaves stamps intact';
end;
$$;

-- ============================================================
-- TEST 5: Scoping — staff can only edit their OWN business
--   Settings Staff edits; Rival Cafe must be untouched.
-- ============================================================
do $$
declare v_rival_threshold int; v_rival_desc text;
begin
  select reward_threshold, reward_description into v_rival_threshold, v_rival_desc
  from businesses where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb002';
  assert v_rival_threshold = 10 and v_rival_desc = 'Free item',
    format('FAIL TEST 5: rival business was modified (%s / %s)', v_rival_threshold, v_rival_desc);
  raise notice 'PASS TEST 5: edits scoped to own business only';
end;
$$;

-- ============================================================
-- TEST 6: Happy path persisted the settings on the OWN business
-- ============================================================
do $$
declare v_threshold int; v_desc text; v_mode text;
begin
  select reward_threshold, reward_description, earning_mode::text
    into v_threshold, v_desc, v_mode
  from businesses where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb001';
  assert v_threshold = 5 and v_desc = 'Free coffee' and v_mode = 'per_transaction',
    format('FAIL TEST 6: settings not persisted (%s / %s / %s)', v_threshold, v_desc, v_mode);
  raise notice 'PASS TEST 6: settings persisted';
end;
$$;

-- ============================================================
-- Cleanup
-- ============================================================
delete from enrollments where business_id in
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb001','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb002');
delete from staff_users where business_id in
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb001','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb002');
delete from customers where id in
  ('dddddddd-dddd-dddd-dddd-ddddddddd001','dddddddd-dddd-dddd-dddd-ddddddddd002','dddddddd-dddd-dddd-dddd-ddddddddd003');
delete from businesses where id in
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb001','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb002');
delete from auth.users where id in
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa002');

\echo 'ALL BUSINESS SETTINGS TESTS PASSED'
