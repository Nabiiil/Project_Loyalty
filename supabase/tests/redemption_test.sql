-- ============================================================
-- End-to-end tests for create_redemption() + verify_redemption()
-- Run: psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/redemption_test.sql
--
-- Self-contained: builds its own business, staff, claimed customer and an
-- enrollment sitting exactly at the reward threshold, then exercises the
-- customer-mint and staff-verify paths. Safe to re-run (cleans up at the end).
-- ============================================================
\set ON_ERROR_STOP on

-- ============================================================
-- Setup
-- ============================================================
insert into businesses (id, name, reward_threshold)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Redeem Cafe', 3);

-- Second business + its staff, to prove business scoping.
insert into businesses (id, name, reward_threshold)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbff', 'Rival Cafe', 3);

insert into auth.users (id, instance_id, email, aud, role, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','00000000-0000-0000-0000-000000000000',
   'staff-redeem@test.com','authenticated','authenticated',now(),now(),'','','',''),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaff','00000000-0000-0000-0000-000000000000',
   'staff-rival@test.com','authenticated','authenticated',now(),now(),'','','',''),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','00000000-0000-0000-0000-000000000000',
   'cust-redeem@test.com','authenticated','authenticated',now(),now(),'','','','');

insert into staff_users (business_id, auth_user_id, name) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Redeem Staff'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbff','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaff','Rival Staff');

-- Claimed customer (has auth_user_id) with an enrollment at threshold (3/3).
insert into customers (id, email, auth_user_id, claimed_at, signup_source)
values ('dddddddd-dddd-dddd-dddd-dddddddddddd','cust-redeem@test.com',
  'cccccccc-cccc-cccc-cccc-cccccccccccc', now(), 'qr_scan');

insert into enrollments (id, customer_id, business_id, current_stamps)
values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','dddddddd-dddd-dddd-dddd-dddddddddddd',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 3);

-- An anonymous (unclaimed) customer + enrollment, to prove the account gate.
insert into customers (id, device_token, signup_source)
values ('dddddddd-dddd-dddd-dddd-ddddddddddff','anon-device-xyz','qr_scan');

insert into enrollments (id, customer_id, business_id, current_stamps)
values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeff','dddddddd-dddd-dddd-dddd-ddddddddddff',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 3);

-- ============================================================
-- TEST 1: Account gate — anonymous customer cannot mint a code
-- ============================================================
do $$
declare v_result jsonb;
begin
  v_result := public.create_redemption(
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeff'::uuid,
    'dddddddd-dddd-dddd-dddd-ddddddddddff'::uuid);
  raise notice 'TEST 1 result: %', v_result;
  assert not (v_result->>'ok')::boolean,
    'FAIL TEST 1: anonymous customer should be blocked';
  assert v_result->>'error' = 'account_required',
    format('FAIL TEST 1: expected account_required, got %s', v_result);
  raise notice 'PASS TEST 1: account gate enforced';
end;
$$;

-- ============================================================
-- TEST 2: Claimed customer mints a code (eligible, 3/3)
-- ============================================================
do $$
declare v_result jsonb;
begin
  v_result := public.create_redemption(
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
    'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid);
  raise notice 'TEST 2 result: %', v_result;
  assert (v_result->>'ok')::boolean, format('FAIL TEST 2: %s', v_result);
  assert length(v_result->>'code') = 6, 'FAIL TEST 2: expected a 6-char code';
  assert not (v_result->>'reused')::boolean, 'FAIL TEST 2: first mint should not be reused';
  raise notice 'PASS TEST 2: code minted';
end;
$$;

-- ============================================================
-- TEST 3: Idempotent — a second mint returns the SAME live code
-- ============================================================
do $$
declare v_first text; v_second jsonb;
begin
  select redemption_code into v_first
  from redemptions where enrollment_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

  v_second := public.create_redemption(
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
    'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid);
  raise notice 'TEST 3 result: %', v_second;
  assert (v_second->>'reused')::boolean, 'FAIL TEST 3: expected reused=true';
  assert v_second->>'code' = v_first,
    'FAIL TEST 3: reused code should match the original';
  assert (select count(*) from redemptions
          where enrollment_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee') = 1,
    'FAIL TEST 3: only one redemption row should exist';
  raise notice 'PASS TEST 3: idempotent mint';
end;
$$;

-- ============================================================
-- TEST 4: Wrong business — rival staff cannot verify, stamps untouched
-- ============================================================
do $$
declare v_code text; v_result jsonb; v_stamps int;
begin
  select redemption_code into v_code
  from redemptions where enrollment_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

  v_result := public.verify_redemption(v_code, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaff'::uuid);
  raise notice 'TEST 4 result: %', v_result;
  assert (v_result->>'ok')::boolean and not (v_result->>'valid')::boolean,
    format('FAIL TEST 4: %s', v_result);
  assert v_result->>'reason' = 'wrong_business',
    format('FAIL TEST 4: expected wrong_business, got %s', v_result);

  select current_stamps into v_stamps
  from enrollments where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  assert v_stamps = 3, 'FAIL TEST 4: stamps must be untouched after a failed verify';
  raise notice 'PASS TEST 4: wrong-business rejected, stamps intact';
end;
$$;

-- ============================================================
-- TEST 5: Valid verify — correct staff, stamps reset to 0
-- ============================================================
do $$
declare v_code text; v_result jsonb; v_stamps int;
begin
  select redemption_code into v_code
  from redemptions where enrollment_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

  -- lower-case on purpose: input must be normalised
  v_result := public.verify_redemption(lower(v_code), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);
  raise notice 'TEST 5 result: %', v_result;
  assert (v_result->>'valid')::boolean, format('FAIL TEST 5: %s', v_result);
  assert v_result->>'business_name' = 'Redeem Cafe', 'FAIL TEST 5: business name mismatch';

  select current_stamps into v_stamps
  from enrollments where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  assert v_stamps = 0, 'FAIL TEST 5: stamps should reset to 0';
  raise notice 'PASS TEST 5: valid verify, card reset';
end;
$$;

-- ============================================================
-- TEST 6: Single-use — the same code cannot be verified twice
-- ============================================================
do $$
declare v_code text; v_result jsonb;
begin
  select redemption_code into v_code
  from redemptions where enrollment_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

  v_result := public.verify_redemption(v_code, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);
  raise notice 'TEST 6 result: %', v_result;
  assert v_result->>'reason' = 'already_used',
    format('FAIL TEST 6: expected already_used, got %s', v_result);
  raise notice 'PASS TEST 6: single-use enforced';
end;
$$;

-- ============================================================
-- TEST 7: Unknown code -> invalid_code
-- ============================================================
do $$
declare v_result jsonb;
begin
  v_result := public.verify_redemption('ZZZZZZ', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);
  raise notice 'TEST 7 result: %', v_result;
  assert v_result->>'reason' = 'invalid_code',
    format('FAIL TEST 7: expected invalid_code, got %s', v_result);
  raise notice 'PASS TEST 7: unknown code rejected';
end;
$$;

-- ============================================================
-- Cleanup
-- ============================================================
delete from redemptions where enrollment_id in
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeff');
delete from enrollments where business_id in
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbff');
delete from staff_users where business_id in
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbff');
delete from customers where id in
  ('dddddddd-dddd-dddd-dddd-dddddddddddd','dddddddd-dddd-dddd-dddd-ddddddddddff');
delete from businesses where id in
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbff');
delete from auth.users where id in
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaff',
   'cccccccc-cccc-cccc-cccc-cccccccccccc');

\echo 'ALL REDEMPTION TESTS PASSED'
