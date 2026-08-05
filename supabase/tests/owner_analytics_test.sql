-- ============================================================
-- Tests for get_owner_analytics() and get_business_history()
-- Run: psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/owner_analytics_test.sql
--
-- Self-contained: one business (owner + counter staff), three customers with a
-- controlled spread of scanned/manual transactions and one issued+verified
-- redemption, plus a rival business to prove business scoping. Exercises the
-- owner gate, the four analytics metrics, the history union + date filter, and
-- that the aggregation is business-scoped. Safe to re-run (cleans up at end).
-- ============================================================
\set ON_ERROR_STOP on

-- ============================================================
-- Setup
-- ============================================================
insert into businesses (id, name, reward_threshold, reward_description) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbf001', 'Analytics Cafe', 5, 'Free item'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbf002', 'Rival Analytics Cafe', 5, 'Free item');

insert into auth.users (id, instance_id, email, aud, role, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaf001','00000000-0000-0000-0000-000000000000',
   'an-owner@test.com','authenticated','authenticated',now(),now(),'','','',''),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaf002','00000000-0000-0000-0000-000000000000',
   'an-staff@test.com','authenticated','authenticated',now(),now(),'','','',''),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaf003','00000000-0000-0000-0000-000000000000',
   'an-rival-owner@test.com','authenticated','authenticated',now(),now(),'','','','');

insert into staff_users (id, business_id, auth_user_id, name, role) values
  ('11111111-0000-0000-0000-0000000000f1','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbf001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaf001','An Owner','owner'),
  ('11111111-0000-0000-0000-0000000000f2','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbf001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaf002','An Staff','staff'),
  ('11111111-0000-0000-0000-0000000000f3','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbf002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaf003','Rival Owner','owner');

-- Three enrolled customers at Analytics Cafe.
insert into customers (id, device_token, signup_source) values
  ('cccccccc-0000-0000-0000-0000000000c1','an-dev-1','qr_scan'),
  ('cccccccc-0000-0000-0000-0000000000c2','an-dev-2','qr_scan'),
  ('cccccccc-0000-0000-0000-0000000000c3','an-dev-3','qr_scan');

insert into enrollments (id, customer_id, business_id, current_stamps) values
  ('eeeeeeee-0000-0000-0000-0000000000e1','cccccccc-0000-0000-0000-0000000000c1','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbf001', 3),
  ('eeeeeeee-0000-0000-0000-0000000000e2','cccccccc-0000-0000-0000-0000000000c2','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbf001', 2),
  ('eeeeeeee-0000-0000-0000-0000000000e3','cccccccc-0000-0000-0000-0000000000c3','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbf001', 1);

-- Visits (scanned transactions). Customer c1: 3 visits (days -20, -10, -2),
-- c2: 2 visits (days -15, -5), c3: 1 visit (day -1, and it's a MANUAL stamp).
-- Total 6 visits across 3 enrolled customers within 30 days.
insert into transactions (business_id, customer_id, qr_token, status, expires_at, scanned_at, is_manual, manual_reason, created_by_staff_id) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbf001','cccccccc-0000-0000-0000-0000000000c1','an-t1','scanned', now(), now() - interval '20 days', false, null, null),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbf001','cccccccc-0000-0000-0000-0000000000c1','an-t2','scanned', now(), now() - interval '10 days', false, null, null),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbf001','cccccccc-0000-0000-0000-0000000000c1','an-t3','scanned', now(), now() - interval '2 days',  false, null, null),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbf001','cccccccc-0000-0000-0000-0000000000c2','an-t4','scanned', now(), now() - interval '15 days', false, null, null),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbf001','cccccccc-0000-0000-0000-0000000000c2','an-t5','scanned', now(), now() - interval '5 days',  false, null, null),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbf001','cccccccc-0000-0000-0000-0000000000c3','an-t6','scanned', now(), now() - interval '1 days',  true, 'qr_failed', '11111111-0000-0000-0000-0000000000f2');

-- A pending transaction (must be ignored by every metric and the history log).
insert into transactions (business_id, qr_token, status, expires_at) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbf001','an-pending','pending', now() + interval '15 min');

-- One redemption for c1: issued 3 days ago, verified 2 days ago.
insert into redemptions (id, enrollment_id, redemption_code, status, created_at, verified_at, expires_at) values
  ('dddddddd-0000-0000-0000-0000000000d1','eeeeeeee-0000-0000-0000-0000000000e1','ANLYT1','verified',
   now() - interval '3 days', now() - interval '2 days', now() + interval '10 min');

-- Rival business: a visit that must never leak into Analytics Cafe's numbers.
insert into customers (id, device_token, signup_source) values
  ('cccccccc-0000-0000-0000-0000000000f9','an-rival-dev','qr_scan');
insert into enrollments (id, customer_id, business_id, current_stamps) values
  ('eeeeeeee-0000-0000-0000-0000000000f9','cccccccc-0000-0000-0000-0000000000f9','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbf002', 1);
insert into transactions (business_id, customer_id, qr_token, status, expires_at, scanned_at) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbf002','cccccccc-0000-0000-0000-0000000000f9','an-rival-t','scanned', now(), now() - interval '3 days');

-- ============================================================
-- TEST 1: owner gate — not authenticated / not staff / not owner
-- ============================================================
do $$
declare v jsonb;
begin
  v := public.get_owner_analytics(30, null);
  assert v->>'error' = 'not_authenticated', format('FAIL 1a: %s', v);

  v := public.get_owner_analytics(30, '00000000-0000-0000-0000-0000000000ff'::uuid);
  assert v->>'error' = 'not_staff', format('FAIL 1b: %s', v);

  v := public.get_owner_analytics(30, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaf002'::uuid); -- counter staff
  assert v->>'error' = 'not_owner', format('FAIL 1c: %s', v);

  v := public.get_business_history(null, null, 100, 0, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaf002'::uuid);
  assert v->>'error' = 'not_owner', format('FAIL 1d: history should be owner-only, got %s', v);

  raise notice 'PASS TEST 1: owner-only gate enforced at the function layer';
end;
$$;

-- ============================================================
-- TEST 2: analytics metrics are correct and business-scoped
-- ============================================================
do $$
declare v jsonb;
begin
  v := public.get_owner_analytics(30, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaf001'::uuid);
  assert (v->>'ok')::boolean, format('FAIL 2: %s', v);

  -- Repeat visit rate: 6 visits / 3 enrolled / (30/30 months) = 2.00
  assert (v->>'enrolled_customers')::int = 3, format('FAIL 2a enrolled: %s', v->>'enrolled_customers');
  assert (v->>'repeat_visit_rate')::numeric = 2.00,
    format('FAIL 2b repeat rate: expected 2.00, got %s', v->>'repeat_visit_rate');

  -- Redemptions: 1 issued, 1 verified.
  assert (v->>'redemptions_issued')::int = 1, format('FAIL 2c issued: %s', v->>'redemptions_issued');
  assert (v->>'redemptions_verified')::int = 1, format('FAIL 2d verified: %s', v->>'redemptions_verified');

  -- Avg days between visits: c1 gaps 10 & 8 -> 9; c2 gap 10 -> 10; c3 single visit -> excluded.
  -- avg(9, 10) = 9.5
  assert (v->>'avg_days_between_visits')::numeric = 9.5,
    format('FAIL 2e avg gap: expected 9.5, got %s', v->>'avg_days_between_visits');

  -- New vs returning series present and spans the window (31 daily buckets).
  assert jsonb_array_length(v->'new_vs_returning') between 30 and 32,
    format('FAIL 2f series length: %s', jsonb_array_length(v->'new_vs_returning'));

  raise notice 'PASS TEST 2: metrics correct (repeat=2.00, redemptions 1/1, avg gap 9.5)';
end;
$$;

-- ============================================================
-- TEST 3: new-vs-returning classification (c1's day -20 is NEW, day -10 RETURNING)
-- ============================================================
do $$
declare v jsonb; v_sum_new int; v_sum_ret int; e jsonb;
begin
  v := public.get_owner_analytics(30, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaf001'::uuid);
  v_sum_new := 0; v_sum_ret := 0;
  for e in select * from jsonb_array_elements(v->'new_vs_returning') loop
    v_sum_new := v_sum_new + (e->>'new')::int;
    v_sum_ret := v_sum_ret + (e->>'returning')::int;
  end loop;
  -- 3 customers each have exactly one "new" day (their first visit in-window).
  assert v_sum_new = 3, format('FAIL 3a: expected 3 new across window, got %s', v_sum_new);
  -- Returning visit-days: c1 has 2 (days -10, -2), c2 has 1 (day -5). c3 none.
  assert v_sum_ret = 3, format('FAIL 3b: expected 3 returning across window, got %s', v_sum_ret);
  raise notice 'PASS TEST 3: new(3) vs returning(3) classification correct';
end;
$$;

-- ============================================================
-- TEST 4: history log — union, ordering, badges, non-PII code, scoping
-- ============================================================
do $$
declare v jsonb; rows jsonb; kinds text[];
begin
  v := public.get_business_history(null, null, 100, 0, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaf001'::uuid);
  assert (v->>'ok')::boolean, format('FAIL 4: %s', v);

  -- 6 scanned transactions + 1 redemption = 7 events (pending excluded).
  assert (v->>'total')::int = 7, format('FAIL 4a total: expected 7, got %s', v->>'total');
  rows := v->'rows';
  assert jsonb_array_length(rows) = 7, format('FAIL 4b rows: %s', jsonb_array_length(rows));

  -- Reverse chronological: first row is the newest (the manual stamp, day -1).
  assert rows->0->>'kind' = 'manual', format('FAIL 4c newest kind: %s', rows->0->>'kind');
  assert rows->0->>'detail' = 'qr_failed', format('FAIL 4d manual reason: %s', rows->0->>'detail');

  -- Customer identifier is the short non-PII code (8 upper hex), never the UUID.
  assert rows->0->>'customer_code' = 'CCCCCCCC',
    format('FAIL 4e customer_code: %s', rows->0->>'customer_code');

  -- Exactly one redemption event is present in the union.
  select array_agg(distinct value->>'kind') into kinds
  from jsonb_array_elements(rows) as value;
  assert 'redemption' = any(kinds) and 'scan' = any(kinds) and 'manual' = any(kinds),
    format('FAIL 4f kinds present: %s', kinds);

  raise notice 'PASS TEST 4: history unions txns+redemptions, newest-first, flagged, non-PII';
end;
$$;

-- ============================================================
-- TEST 5: date-range filter narrows the window
-- ============================================================
do $$
declare v jsonb;
begin
  -- Only the last 3 days: manual stamp (day -1), c1 visit (day -2), redemption
  -- (verified day -2). The redemption row is timed at verified_at (day -2). = 3.
  v := public.get_business_history(now() - interval '3 days', now(), 100, 0,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaf001'::uuid);
  assert (v->>'total')::int = 3, format('FAIL 5: expected 3 in last 3 days, got %s', v->>'total');
  raise notice 'PASS TEST 5: date-range filter applied in SQL';
end;
$$;

-- ============================================================
-- TEST 6: rival owner sees ONLY their own business (scoping)
-- ============================================================
do $$
declare v jsonb;
begin
  v := public.get_business_history(null, null, 100, 0, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaf003'::uuid);
  assert (v->>'total')::int = 1, format('FAIL 6a: rival should see only their 1 event, got %s', v->>'total');

  v := public.get_owner_analytics(30, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaf003'::uuid);
  assert (v->>'enrolled_customers')::int = 1,
    format('FAIL 6b: rival analytics should count only their own customer, got %s', v->>'enrolled_customers');
  raise notice 'PASS TEST 6: every aggregate is scoped to the caller''s own business';
end;
$$;

-- ============================================================
-- Cleanup
-- ============================================================
delete from businesses where id in (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbf001',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbf002'
);
delete from customers where id in (
  'cccccccc-0000-0000-0000-0000000000c1',
  'cccccccc-0000-0000-0000-0000000000c2',
  'cccccccc-0000-0000-0000-0000000000c3',
  'cccccccc-0000-0000-0000-0000000000f9'
);
delete from auth.users where id in (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaf001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaf002',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaf003'
);

do $$ begin raise notice ''; raise notice '=== owner_analytics: all tests passed ==='; end; $$;
