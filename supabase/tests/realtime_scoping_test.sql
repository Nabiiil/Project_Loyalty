-- ============================================================
-- Tests for Realtime scan-confirmation scoping
-- Run: psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/realtime_scoping_test.sql
--
-- Supabase Realtime (postgres_changes) delivers a change only if the
-- subscriber's role + JWT could SELECT that row under RLS. So the channel
-- scoping guarantee IS the transactions SELECT policy set. This test asserts:
--   1. transactions is in the supabase_realtime publication (events flow at all)
--   2. a staff session can SELECT (⇒ receive) own-business transactions ONLY —
--      a rival business's rows are invisible even when queried by exact id
--   3. the anon role has no transactions SELECT path at all
-- The live end-to-end websocket proof (a rival subscriber receiving nothing on
-- a real channel while the scan fires) lives in realtime_scoping.e2e.mjs.
--
-- Self-contained; safe to re-run (cleans up at the end).
-- ============================================================
\set ON_ERROR_STOP on

-- ============================================================
-- Setup: two businesses, one staff login each, one pending transaction each
-- ============================================================
insert into businesses (id, name, reward_threshold) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbe001', 'Realtime Cafe', 10),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbe002', 'Rival Realtime Cafe', 10);

insert into auth.users (id, instance_id, email, aud, role, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaae001','00000000-0000-0000-0000-000000000000',
   'rt-staff-a@test.com','authenticated','authenticated',now(),now(),'','','',''),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaae002','00000000-0000-0000-0000-000000000000',
   'rt-staff-b@test.com','authenticated','authenticated',now(),now(),'','','','');

insert into staff_users (business_id, auth_user_id, name, role) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbe001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaae001','RT Staff A','staff'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbe002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaae002','RT Staff B','staff');

insert into transactions (id, business_id, qr_token, status, expires_at) values
  ('dddddddd-dddd-dddd-dddd-dddddddde001','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbe001',
   'rt-test-token-a','pending', now() + interval '15 minutes'),
  ('dddddddd-dddd-dddd-dddd-dddddddde002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbe002',
   'rt-test-token-b','pending', now() + interval '15 minutes');

-- ============================================================
-- TEST 1: transactions is published on supabase_realtime
-- ============================================================
do $$
declare v_count int;
begin
  select count(*) into v_count
  from pg_publication_tables
  where pubname = 'supabase_realtime'
    and schemaname = 'public'
    and tablename = 'transactions';
  assert v_count = 1,
    'FAIL TEST 1: transactions is not in the supabase_realtime publication';
  raise notice 'PASS TEST 1: transactions is published for realtime';
end;
$$;

-- ============================================================
-- TEST 2 (RLS = channel scoping): staff A sees own-business transactions ONLY.
-- Realtime evaluates exactly this SELECT visibility per change row; a row that
-- is invisible here is a row whose events are never delivered to A's channel.
-- ============================================================
begin;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaae001","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_count int;
begin
  select count(*) into v_count from transactions
  where id = 'dddddddd-dddd-dddd-dddd-dddddddde001';
  assert v_count = 1, 'FAIL TEST 2a: staff A cannot see their own transaction';

  -- Rival row, queried by exact id — the strongest probe there is.
  select count(*) into v_count from transactions
  where id = 'dddddddd-dddd-dddd-dddd-dddddddde002';
  assert v_count = 0, 'FAIL TEST 2b: staff A can see the rival business''s transaction';

  -- And the filter the client actually subscribes with: rival business_id.
  select count(*) into v_count from transactions
  where business_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbe002';
  assert v_count = 0, 'FAIL TEST 2c: staff A can enumerate the rival''s transaction stream';

  raise notice 'PASS TEST 2: staff transaction visibility (= realtime delivery) is business-scoped';
end;
$$;
rollback;

-- ============================================================
-- TEST 3: anon role has no transactions SELECT path (no session ⇒ no stream)
-- ============================================================
begin;
set local role anon;
do $$
declare v_denied boolean := false; v_count int;
begin
  begin
    select count(*) into v_count from transactions;
    -- If the grant exists, RLS must still hide every row.
    assert v_count = 0, format('FAIL TEST 3: anon can see %s transactions', v_count);
  exception when insufficient_privilege then
    v_denied := true; -- no table grant at all — even better
  end;
  raise notice 'PASS TEST 3: anon receives nothing (denied=%s)', v_denied;
end;
$$;
rollback;

-- ============================================================
-- Cleanup
-- ============================================================
delete from businesses where id in (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbe001',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbe002'
);
delete from auth.users where id in (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaae001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaae002'
);

do $$ begin raise notice ''; raise notice '=== realtime_scoping: all tests passed ==='; end; $$;
