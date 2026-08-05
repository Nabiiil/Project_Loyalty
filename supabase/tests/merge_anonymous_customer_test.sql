-- ============================================================
-- End-to-end tests for merge_anonymous_customer()
-- Run: psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/merge_anonymous_customer_test.sql
-- ============================================================
-- The property under test is double-counting: an anonymous device-token
-- customer's stamps must land on the claimed account exactly once, and the
-- anonymous row must be unmergeable afterwards no matter how many times a stale
-- device-token cookie drives the caller back here.
-- ============================================================
\set ON_ERROR_STOP on

-- ============================================================
-- Setup: two businesses + an auth user to hang the claimed account off
-- ============================================================
insert into businesses (id, name, reward_threshold)
values
  ('cafecafe-cafe-cafe-cafe-cafecafecafe', 'Test Cafe',   10),
  ('beadbead-bead-bead-bead-beadbeadbead', 'Test Bakery', 10);

insert into auth.users (id, instance_id, aud, role, email)
values (
  'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'claimed@example.com'
);

-- ============================================================
-- TEST 1: Merge transfers everything exactly once
--   Cafe:   both sides hold a card  -> stamps summed (4 + 3 = 7)
--   Bakery: only the anon side      -> enrollment handed over as-is (5)
-- ============================================================
do $$
declare
  v_cafe    uuid := 'cafecafe-cafe-cafe-cafe-cafecafecafe';
  v_bakery  uuid := 'beadbead-bead-bead-bead-beadbeadbead';
  v_anon    uuid;
  v_target  uuid;
  v_result  jsonb;
  v_stamps  int;
  v_count   int;
begin
  insert into customers (device_token, signup_source)
  values ('dt-test-1', 'qr_scan') returning id into v_anon;

  insert into customers (auth_user_id, email, signup_source, claimed_at)
  values ('a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', 'claimed@example.com',
          'direct_signup', now())
  returning id into v_target;

  insert into enrollments (customer_id, business_id, current_stamps) values
    (v_anon,   v_cafe,   3),
    (v_target, v_cafe,   4),
    (v_anon,   v_bakery, 5);

  -- A scan made anonymously, which must stay attributed after the merge.
  insert into transactions (business_id, customer_id, qr_token, status, expires_at, scanned_at)
  values (v_cafe, v_anon, 'qr-merge-test-1', 'scanned', now() + interval '15 minutes', now());

  v_result := public.merge_anonymous_customer(v_anon, v_target);
  raise notice 'TEST 1 result: %', v_result;

  assert (v_result->>'ok')::boolean,
    format('FAIL TEST 1: ok=false - %s', v_result);
  assert (v_result->>'merged')::boolean,
    format('FAIL TEST 1: expected merged=true - %s', v_result);

  select current_stamps into v_stamps
  from enrollments where customer_id = v_target and business_id = v_cafe;
  assert v_stamps = 7,
    format('FAIL TEST 1: overlapping stamps should sum to 7, got %s', v_stamps);

  select current_stamps into v_stamps
  from enrollments where customer_id = v_target and business_id = v_bakery;
  assert v_stamps = 5,
    format('FAIL TEST 1: non-overlapping card should carry over at 5, got %s', v_stamps);

  select count(*) into v_count from customers where id = v_anon;
  assert v_count = 0,
    'FAIL TEST 1: the anonymous row must be retired by the merge';

  select count(*) into v_count from enrollments where customer_id = v_anon;
  assert v_count = 0,
    'FAIL TEST 1: no enrollment may be left pointing at the retired row';

  select count(*) into v_count
  from transactions where qr_token = 'qr-merge-test-1' and customer_id = v_target;
  assert v_count = 1,
    'FAIL TEST 1: scan history should follow the customer, not be nulled out';

  raise notice 'PASS TEST 1: 7 + 5 stamps on the account, anonymous row retired';
end;
$$;

-- ============================================================
-- TEST 2: The merge is single-use - replaying it adds nothing
-- This is the double-count guard: a stale device_token cookie driving a second
-- claim must not re-add the stamps that were already transferred.
-- ============================================================
do $$
declare
  v_cafe    uuid := 'cafecafe-cafe-cafe-cafe-cafecafecafe';
  v_anon    uuid;
  v_target  uuid;
  v_result  jsonb;
  v_stamps  int;
begin
  select id into v_target from customers
  where auth_user_id = 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0';

  -- The retired token must no longer resolve to anything.
  select id into v_anon from customers where device_token = 'dt-test-1';
  assert v_anon is null,
    'FAIL TEST 2: precondition - dt-test-1 should have been retired in TEST 1';

  select current_stamps into v_stamps
  from enrollments where customer_id = v_target and business_id = v_cafe;
  assert v_stamps = 7,
    format('FAIL TEST 2: precondition - expected 7 stamps, got %s', v_stamps);

  -- Replay against a row that no longer exists: a successful no-op, not an error.
  v_result := public.merge_anonymous_customer(gen_random_uuid(), v_target);
  raise notice 'TEST 2 result: %', v_result;

  assert (v_result->>'ok')::boolean,
    format('FAIL TEST 2: a replayed merge should report ok=true - %s', v_result);
  assert not (v_result->>'merged')::boolean,
    format('FAIL TEST 2: expected merged=false - %s', v_result);
  assert v_result->>'reason' = 'already_merged',
    format('FAIL TEST 2: expected reason=already_merged - %s', v_result);

  select current_stamps into v_stamps
  from enrollments where customer_id = v_target and business_id = v_cafe;
  assert v_stamps = 7,
    format('FAIL TEST 2: replay must not add stamps - expected 7, got %s', v_stamps);

  raise notice 'PASS TEST 2: replayed merge is a no-op, stamps still 7';
end;
$$;

-- ============================================================
-- TEST 3: An already-claimed row is never merged again
-- A row that has been claimed (auth_user_id set) belongs to somebody; folding
-- it into another account would move stamps out from under its owner.
-- ============================================================
do $$
declare
  v_cafe     uuid := 'cafecafe-cafe-cafe-cafe-cafecafecafe';
  v_claimed  uuid;
  v_target   uuid;
  v_result   jsonb;
  v_stamps   int;
begin
  insert into auth.users (id, instance_id, aud, role, email)
  values ('b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0b0b0',
          '00000000-0000-0000-0000-000000000000',
          'authenticated', 'authenticated', 'other@example.com');

  insert into customers (device_token, auth_user_id, email, signup_source, claimed_at)
  values ('dt-test-3', 'b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0b0b0', 'other@example.com',
          'qr_scan', now())
  returning id into v_claimed;

  insert into enrollments (customer_id, business_id, current_stamps)
  values (v_claimed, v_cafe, 6);

  select id into v_target from customers
  where auth_user_id = 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0';

  v_result := public.merge_anonymous_customer(v_claimed, v_target);
  raise notice 'TEST 3 result: %', v_result;

  assert not (v_result->>'merged')::boolean,
    format('FAIL TEST 3: a claimed row must not be merged - %s', v_result);

  select current_stamps into v_stamps
  from enrollments where customer_id = v_claimed and business_id = v_cafe;
  assert v_stamps = 6,
    format('FAIL TEST 3: the claimed owner keeps their 6 stamps, got %s', v_stamps);

  select current_stamps into v_stamps
  from enrollments where customer_id = v_target and business_id = v_cafe;
  assert v_stamps = 7,
    format('FAIL TEST 3: target must be untouched at 7, got %s', v_stamps);

  raise notice 'PASS TEST 3: claimed row left alone';
end;
$$;

-- ============================================================
-- TEST 4: Guard rails - null args and a self-merge
-- ============================================================
do $$
declare
  v_target uuid;
  v_result jsonb;
begin
  select id into v_target from customers
  where auth_user_id = 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0';

  v_result := public.merge_anonymous_customer(null, v_target);
  assert not (v_result->>'ok')::boolean and v_result->>'error' = 'invalid_request',
    format('FAIL TEST 4: null source should be rejected - %s', v_result);

  -- Same row on both sides: nothing to move, and nothing may be deleted.
  v_result := public.merge_anonymous_customer(v_target, v_target);
  assert (v_result->>'ok')::boolean and not (v_result->>'merged')::boolean,
    format('FAIL TEST 4: self-merge should be a no-op - %s', v_result);
  assert exists (select 1 from customers where id = v_target),
    'FAIL TEST 4: a self-merge must never retire the account';

  raise notice 'PASS TEST 4: guard rails hold';
end;
$$;
