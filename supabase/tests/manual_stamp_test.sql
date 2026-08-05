-- ============================================================
-- Tests for add_manual_stamp() (manual staff override)
-- Run: psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/manual_stamp_test.sql
--
-- Self-contained: builds one business with an owner + two staff logins and a
-- spread of customers, then exercises auth/role, reason validation, customer
-- identification (short code + phone, not-found, ambiguous), the shared-increment
-- path, and the per-staff daily rate limit. Safe to re-run (cleans up at the end).
-- ============================================================
\set ON_ERROR_STOP on

-- ============================================================
-- Setup
-- ============================================================
insert into businesses (id, name, reward_threshold, reward_description)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbd001', 'Manual Cafe', 10, 'Free item');

insert into auth.users (id, instance_id, email, aud, role, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaad001','00000000-0000-0000-0000-000000000000',
   'manual-owner@test.com','authenticated','authenticated',now(),now(),'','','',''),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaad002','00000000-0000-0000-0000-000000000000',
   'manual-staff@test.com','authenticated','authenticated',now(),now(),'','','',''),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaad003','00000000-0000-0000-0000-000000000000',
   'manual-staff2@test.com','authenticated','authenticated',now(),now(),'','','','');

insert into staff_users (business_id, auth_user_id, name, role) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbd001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaad001','Manual Owner','owner'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbd001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaad002','Manual Staff','staff'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbd001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaad003','Manual Staff Two','staff');

-- Customer identified by short code (first 8 hex of id = 'c1c1c1c1').
insert into customers (id, device_token, signup_source) values
  ('c1c1c1c1-1111-1111-1111-111111111111','dev-manual-code','qr_scan');

-- Claimed customer identified by phone (formatting differs from what staff type).
insert into customers (id, phone_number, email, signup_source) values
  ('c2c2c2c2-2222-2222-2222-222222222222','+212 600-112233','phone-cust@test.com','direct_signup');

-- Two customers sharing the same first-8-hex prefix → ambiguous by short code.
insert into customers (id, device_token, signup_source) values
  ('abababab-1111-1111-1111-111111111111','dev-ambig-1','qr_scan'),
  ('abababab-2222-2222-2222-222222222222','dev-ambig-2','qr_scan');

-- ============================================================
-- TEST 1: not a staff row -> not_staff
-- ============================================================
do $$
declare v jsonb;
begin
  v := public.add_manual_stamp('c1c1c1c1', 'code', 'staff_error', null,
    '00000000-0000-0000-0000-0000000000ff'::uuid);
  assert not (v->>'ok')::boolean and v->>'error' = 'not_staff',
    format('FAIL TEST 1: expected not_staff, got %s', v);
  raise notice 'PASS TEST 1: non-staff rejected';
end;
$$;

-- ============================================================
-- TEST 2: reason is required and validated (never skippable)
-- ============================================================
do $$
declare v jsonb;
begin
  v := public.add_manual_stamp('c1c1c1c1', 'code', '', null,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaad002'::uuid);
  assert v->>'error' = 'invalid_reason',
    format('FAIL TEST 2a: expected invalid_reason, got %s', v);

  v := public.add_manual_stamp('c1c1c1c1', 'code', 'not_a_category', null,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaad002'::uuid);
  assert v->>'error' = 'invalid_reason',
    format('FAIL TEST 2b: expected invalid_reason, got %s', v);
  raise notice 'PASS TEST 2: reason required + validated';
end;
$$;

-- ============================================================
-- TEST 3: unidentifiable customer -> customer_not_found (no orphan stamp)
-- ============================================================
do $$
declare v jsonb; v_before int; v_after int;
begin
  select count(*) into v_before from transactions where is_manual;
  v := public.add_manual_stamp('ZZZZZZZZ', 'code', 'qr_failed', null,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaad002'::uuid);
  assert v->>'error' = 'customer_not_found',
    format('FAIL TEST 3a: expected customer_not_found, got %s', v);

  v := public.add_manual_stamp('99999999', 'code', 'qr_failed', null,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaad002'::uuid);
  assert v->>'error' = 'customer_not_found',
    format('FAIL TEST 3b: expected customer_not_found, got %s', v);

  select count(*) into v_after from transactions where is_manual;
  assert v_before = v_after,
    'FAIL TEST 3c: a not-found override must never create a transaction';
  raise notice 'PASS TEST 3: unidentifiable customer refused, no orphan';
end;
$$;

-- ============================================================
-- TEST 4: ambiguous short code -> ambiguous_customer (no stamp)
-- ============================================================
do $$
declare v jsonb;
begin
  v := public.add_manual_stamp('abababab', 'code', 'staff_error', null,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaad002'::uuid);
  assert v->>'error' = 'ambiguous_customer',
    format('FAIL TEST 4: expected ambiguous_customer, got %s', v);
  raise notice 'PASS TEST 4: ambiguous short code refused';
end;
$$;

-- ============================================================
-- TEST 5: success by short code — flagged row + shared increment
-- ============================================================
do $$
declare v jsonb; v_txn transactions%rowtype; v_stamps int;
begin
  v := public.add_manual_stamp('C1C1C1C1', 'code', 'staff_error', null,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaad002'::uuid);
  assert (v->>'ok')::boolean, format('FAIL TEST 5: ok=false — %s', v);
  assert (v->>'current_stamps')::int = 1, 'FAIL TEST 5: expected 1 stamp';
  assert (v->>'is_manual')::boolean, 'FAIL TEST 5: is_manual should be true';

  -- The recorded transaction is flagged, reasoned, and attributed to the staff.
  select * into v_txn from transactions
  where customer_id = 'c1c1c1c1-1111-1111-1111-111111111111' and is_manual
  order by created_at desc limit 1;
  assert v_txn.is_manual, 'FAIL TEST 5: transaction not flagged manual';
  assert v_txn.manual_reason = 'staff_error', 'FAIL TEST 5: reason not stored';
  assert v_txn.created_by_staff_id is not null, 'FAIL TEST 5: acting staff not recorded';
  assert v_txn.qr_token like 'manual-%', 'FAIL TEST 5: expected synthetic qr_token';
  assert v_txn.status = 'scanned', 'FAIL TEST 5: manual stamp should be recorded as scanned';

  -- Enrollment counter actually moved (shared increment path).
  select current_stamps into v_stamps from enrollments
  where customer_id = 'c1c1c1c1-1111-1111-1111-111111111111'
    and business_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbd001';
  assert v_stamps = 1, 'FAIL TEST 5: enrollment not incremented';
  raise notice 'PASS TEST 5: manual stamp by short code, flagged + incremented';
end;
$$;

-- ============================================================
-- TEST 6: success by phone (claimed) with a free-text note
-- Category stays the leading token; second stamp increments to 2.
-- ============================================================
do $$
declare v jsonb; v_reason text;
begin
  -- Staff types the same number with different punctuation/spacing; the
  -- digits-only match still finds them (formatting-insensitive, same digits).
  v := public.add_manual_stamp('212-600-11 22 33', 'phone', 'other', 'regular, till was down',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaad002'::uuid);
  raise notice 'TEST 6 result: %', v;
  assert (v->>'ok')::boolean, format('FAIL TEST 6: ok=false — %s', v);

  select manual_reason into v_reason from transactions
  where customer_id = 'c2c2c2c2-2222-2222-2222-222222222222' and is_manual
  order by created_at desc limit 1;
  assert v_reason = 'other: regular, till was down',
    format('FAIL TEST 6: unexpected manual_reason %s', v_reason);
  assert split_part(v_reason, ':', 1) = 'other',
    'FAIL TEST 6: category must stay the leading token for analytics';

  -- A second manual stamp for the same customer increments the same card.
  v := public.add_manual_stamp('212600112233', 'phone', 'phone_dead', null,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaad002'::uuid);
  assert (v->>'current_stamps')::int = 2, 'FAIL TEST 6: expected 2 stamps';
  raise notice 'PASS TEST 6: manual stamp by phone, note stored, increments';
end;
$$;

-- ============================================================
-- TEST 7: owner role is allowed too (no role gate)
-- ============================================================
do $$
declare v jsonb;
begin
  v := public.add_manual_stamp('C1C1C1C1', 'code', 'qr_failed', null,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaad001'::uuid);  -- owner acting
  assert (v->>'ok')::boolean, format('FAIL TEST 7: owner should be allowed — %s', v);
  raise notice 'PASS TEST 7: owner can add manual stamps';
end;
$$;

-- ============================================================
-- TEST 8: per-staff daily rate limit (10) — 11th is refused
-- Uses staff2 (clean count). 10 succeed, the 11th is rate_limited, and no
-- extra transaction is written for the refused attempt.
-- ============================================================
do $$
declare v jsonb; i int; v_manual_count int;
begin
  for i in 1..10 loop
    v := public.add_manual_stamp('C1C1C1C1', 'code', 'staff_error', null,
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaad003'::uuid);
    assert (v->>'ok')::boolean,
      format('FAIL TEST 8: manual stamp %s of 10 failed — %s', i, v);
  end loop;

  select count(*) into v_manual_count from transactions
  where created_by_staff_id = (
    select id from staff_users where auth_user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaad003'
  ) and is_manual;
  assert v_manual_count = 10, format('FAIL TEST 8: expected 10 manual rows, got %s', v_manual_count);

  v := public.add_manual_stamp('C1C1C1C1', 'code', 'staff_error', null,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaad003'::uuid);
  assert not (v->>'ok')::boolean and v->>'error' = 'rate_limited',
    format('FAIL TEST 8: 11th should be rate_limited, got %s', v);
  assert (v->>'limit')::int = 10, 'FAIL TEST 8: limit should be reported as 10';

  select count(*) into v_manual_count from transactions
  where created_by_staff_id = (
    select id from staff_users where auth_user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaad003'
  ) and is_manual;
  assert v_manual_count = 10, 'FAIL TEST 8: rate-limited attempt must not write a row';
  raise notice 'PASS TEST 8: daily rate limit holds at 10';
end;
$$;

-- ============================================================
-- Cleanup
-- ============================================================
delete from businesses where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbd001';
delete from customers where id in (
  'c1c1c1c1-1111-1111-1111-111111111111',
  'c2c2c2c2-2222-2222-2222-222222222222',
  'abababab-1111-1111-1111-111111111111',
  'abababab-2222-2222-2222-222222222222'
);
delete from auth.users where id in (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaad001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaad002',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaad003'
);

do $$ begin raise notice ''; raise notice '=== manual_stamp: all tests passed ==='; end; $$;
