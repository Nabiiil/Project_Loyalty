-- ============================================================
-- Tests for owner vs staff roles
-- Run: psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/staff_roles_test.sql
--
-- Self-contained: builds two businesses, each with one owner and one staff
-- login, then proves every denial the role model promises — not just the
-- happy paths. RLS tests impersonate the `authenticated` role with a real
-- request.jwt.claims sub, so the actual policies + grants are what's being
-- exercised. Safe to re-run (cleans up at the end).
--
-- Cast of characters:
--   Business ONE  bbbbbbbb-...-bbbbbbbbbb11   Owner One  aaaaaaaa-...-aaaaaaaaaa11
--                                             Staff One  aaaaaaaa-...-aaaaaaaaaa12
--   Business TWO  bbbbbbbb-...-bbbbbbbbbb22   Owner Two  aaaaaaaa-...-aaaaaaaaaa21
--                                             Staff Two  aaaaaaaa-...-aaaaaaaaaa22
-- ============================================================
\set ON_ERROR_STOP on

-- ============================================================
-- Setup
-- ============================================================
insert into businesses (id, name, reward_threshold, reward_description) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11', 'Roles Cafe One', 10, 'Free item'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb22', 'Roles Cafe Two', 10, 'Free item');

insert into auth.users (id, instance_id, email, aud, role, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11','00000000-0000-0000-0000-000000000000',
   'roles-owner1@test.com','authenticated','authenticated',now(),now(),'','','',''),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa12','00000000-0000-0000-0000-000000000000',
   'roles-staff1@test.com','authenticated','authenticated',now(),now(),'','','',''),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa21','00000000-0000-0000-0000-000000000000',
   'roles-owner2@test.com','authenticated','authenticated',now(),now(),'','','',''),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa22','00000000-0000-0000-0000-000000000000',
   'roles-staff2@test.com','authenticated','authenticated',now(),now(),'','','','');

-- Owner rows are explicit; the staff rows deliberately OMIT role to prove the
-- column defaults to the least-privileged 'staff'.
insert into staff_users (business_id, auth_user_id, name, role) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11','Owner One','owner'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb22','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa21','Owner Two','owner');
insert into staff_users (business_id, auth_user_id, name) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa12','Staff One'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb22','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa22','Staff Two');

-- ============================================================
-- TEST 1: role defaults to 'staff' when not set explicitly
-- ============================================================
do $$
declare v_role staff_role;
begin
  select role into v_role from staff_users
  where auth_user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa12';
  assert v_role = 'staff', format('FAIL TEST 1: default role is %s, expected staff', v_role);
  raise notice 'PASS TEST 1: role defaults to staff';
end;
$$;

-- ============================================================
-- TEST 2: update_business_settings() RPC — staff denied, owner allowed
-- ============================================================
do $$
declare v_result jsonb;
begin
  v_result := public.update_business_settings(7, 'Free coffee', 'per_transaction',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa12'::uuid);
  assert not (v_result->>'ok')::boolean and v_result->>'error' = 'not_owner',
    format('FAIL TEST 2a: staff should get not_owner, got %s', v_result);

  v_result := public.update_business_settings(7, 'Free coffee', 'per_transaction',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11'::uuid);
  assert (v_result->>'ok')::boolean,
    format('FAIL TEST 2b: owner should succeed, got %s', v_result);

  raise notice 'PASS TEST 2: settings RPC is owner-only';
end;
$$;

-- ============================================================
-- TEST 3 (RLS): staff cannot UPDATE businesses — own or rival
-- ============================================================
begin;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa12","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_count int;
begin
  update businesses set reward_threshold = 99
  where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11';
  get diagnostics v_count = row_count;
  assert v_count = 0, format('FAIL TEST 3a: staff updated own business settings (%s rows)', v_count);

  update businesses set reward_threshold = 99
  where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb22';
  get diagnostics v_count = row_count;
  assert v_count = 0, format('FAIL TEST 3b: staff updated ANOTHER business (%s rows)', v_count);

  raise notice 'PASS TEST 3: staff cannot update businesses settings';
end;
$$;
rollback;

-- ============================================================
-- TEST 4 (RLS): staff can still SELECT their own business (and only it)
-- ============================================================
begin;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa12","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_count int;
begin
  select count(*) into v_count from businesses
  where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11';
  assert v_count = 1, 'FAIL TEST 4a: staff lost SELECT on their own business';

  select count(*) into v_count from businesses
  where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb22';
  assert v_count = 0, 'FAIL TEST 4b: staff can see another business';

  raise notice 'PASS TEST 4: staff SELECT scoped to own business only';
end;
$$;
rollback;

-- ============================================================
-- TEST 5 (RLS): staff see only their OWN staff_users row — not their
-- colleagues', not the owner's, not another business's
-- ============================================================
begin;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa12","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_count int; v_name text;
begin
  select count(*), min(name) into v_count, v_name from staff_users;
  assert v_count = 1 and v_name = 'Staff One',
    format('FAIL TEST 5: staff sees %s staff rows (%s), expected only their own', v_count, v_name);
  raise notice 'PASS TEST 5: staff cannot read other staff accounts';
end;
$$;
rollback;

-- ============================================================
-- TEST 6 (RLS): owner sees ALL staff of their business, none of another's
-- ============================================================
begin;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_count int;
begin
  select count(*) into v_count from staff_users
  where business_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11';
  assert v_count = 2, format('FAIL TEST 6a: owner sees %s own-business staff rows, expected 2', v_count);

  select count(*) into v_count from staff_users
  where business_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb22';
  assert v_count = 0, format('FAIL TEST 6b: owner sees %s rows of ANOTHER business, expected 0', v_count);

  raise notice 'PASS TEST 6: owner staff list scoped to own business';
end;
$$;
rollback;

-- ============================================================
-- TEST 7 (RLS): owner CAN update their own business, still not a rival's
-- ============================================================
begin;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_count int;
begin
  update businesses set reward_threshold = 12
  where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11';
  get diagnostics v_count = row_count;
  assert v_count = 1, format('FAIL TEST 7a: owner update hit %s rows, expected 1', v_count);

  update businesses set reward_threshold = 99
  where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb22';
  get diagnostics v_count = row_count;
  assert v_count = 0, format('FAIL TEST 7b: owner updated a RIVAL business (%s rows)', v_count);

  raise notice 'PASS TEST 7: owner update works and is scoped to own business';
end;
$$;
rollback;

-- ============================================================
-- TEST 8 (grants): the API roles hold NO write privilege on staff_users —
-- adding/removing staff is possible only via the service role, server-side.
-- Fail-closed guardrail: even a missing/buggy RLS policy could not open a
-- write path, because the base grant does not exist.
-- ============================================================
do $$
begin
  assert not has_table_privilege('authenticated', 'public.staff_users', 'INSERT'),
    'FAIL TEST 8: authenticated can INSERT staff_users';
  assert not has_table_privilege('authenticated', 'public.staff_users', 'UPDATE'),
    'FAIL TEST 8: authenticated can UPDATE staff_users';
  assert not has_table_privilege('authenticated', 'public.staff_users', 'DELETE'),
    'FAIL TEST 8: authenticated can DELETE staff_users';
  assert not has_table_privilege('anon', 'public.staff_users', 'SELECT'),
    'FAIL TEST 8: anon can SELECT staff_users';
  assert not has_function_privilege('anon', 'public.is_business_owner(uuid)', 'EXECUTE'),
    'FAIL TEST 8: anon can execute is_business_owner';
  raise notice 'PASS TEST 8: no client-side write path to staff_users exists';
end;
$$;

-- ============================================================
-- Cleanup
-- ============================================================
delete from staff_users where business_id in
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb22');
delete from businesses where id in
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb22');
delete from auth.users where id in
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa12',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa21','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa22');

\echo 'ALL STAFF ROLES TESTS PASSED'
