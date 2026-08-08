-- ============================================================
-- Tests for customers.display_name — RLS scoping and column grants
-- Run: psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/customer_profile_test.sql
--
-- The profile form saves through the customer's OWN authenticated session, so
-- the policy and the column grant ARE the access control — there is no
-- service-role write path to fall back on. These tests impersonate the
-- `authenticated` role with a real request.jwt.claims sub, so what is exercised
-- is the deployed policy, not an app-level check.
--
-- Cast of characters:
--   Customer ONE   cccccccc-...-cccccccccc11   auth aaaaaaaa-...-aaaaaaaaaa11
--   Customer TWO   cccccccc-...-cccccccccc22   auth aaaaaaaa-...-aaaaaaaaaa22
--   Anonymous      cccccccc-...-cccccccccc33   device-token only, never claimed
-- ============================================================
\set ON_ERROR_STOP on

-- ============================================================
-- Setup
-- ============================================================
-- Clear fixtures first, not only at the end: a run that fails an assertion
-- aborts before its own cleanup, and without this the NEXT run dies on a
-- duplicate key instead of reporting the real failure.
delete from customers where id in (
  'cccccccc-cccc-cccc-cccc-cccccccccc11',
  'cccccccc-cccc-cccc-cccc-cccccccccc22',
  'cccccccc-cccc-cccc-cccc-cccccccccc33'
);
delete from auth.users where id in (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa22'
);

insert into auth.users (id, instance_id, aud, role, email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'one@example.com'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa22', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'two@example.com');

insert into customers (id, auth_user_id, email, signup_source, claimed_at, display_name) values
  ('cccccccc-cccc-cccc-cccc-cccccccccc11', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11',
   'one@example.com', 'direct_signup', now(), null),
  ('cccccccc-cccc-cccc-cccc-cccccccccc22', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa22',
   'two@example.com', 'direct_signup', now(), 'Two');

insert into customers (id, device_token, signup_source) values
  ('cccccccc-cccc-cccc-cccc-cccccccccc33', 'dt-profile-anon', 'qr_scan');

-- ============================================================
-- TEST 1 (RLS, THE DENIAL CASE): one customer cannot update another's profile
-- ============================================================
begin;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_count int;
begin
  update customers set display_name = 'Hacked'
  where id = 'cccccccc-cccc-cccc-cccc-cccccccccc22';
  get diagnostics v_count = row_count;
  assert v_count = 0,
    format('FAIL TEST 1a: customer ONE updated customer TWO''s profile (%s rows)', v_count);

  -- Unscoped blast attempt: no WHERE at all. The policy must still confine the
  -- write to their own row rather than letting it sweep the table.
  update customers set display_name = 'Everyone';
  get diagnostics v_count = row_count;
  assert v_count <= 1,
    format('FAIL TEST 1b: a bare UPDATE touched %s rows, expected at most 1', v_count);

  raise notice 'PASS TEST 1: a customer cannot write another customer''s profile';
end;
$$;
rollback;

-- Belt and braces: prove nothing above leaked past the rollback.
do $$
declare v_name text;
begin
  select display_name into v_name from customers
  where id = 'cccccccc-cccc-cccc-cccc-cccccccccc22';
  assert v_name = 'Two', format('FAIL TEST 1c: customer TWO''s name is now %L', v_name);
  raise notice 'PASS TEST 1c: customer TWO''s name untouched';
end;
$$;

-- ============================================================
-- TEST 2 (RLS): a customer CAN update their own profile
-- The denial above is only meaningful if the allow case actually works.
-- ============================================================
begin;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  v_count int;
  v_name  text;
begin
  update customers set display_name = 'Nabil'
  where id = 'cccccccc-cccc-cccc-cccc-cccccccccc11';
  get diagnostics v_count = row_count;
  assert v_count = 1, format('FAIL TEST 2a: expected 1 row updated, got %s', v_count);

  select display_name into v_name from customers
  where id = 'cccccccc-cccc-cccc-cccc-cccccccccc11';
  assert v_name = 'Nabil', format('FAIL TEST 2b: read back %L', v_name);

  -- Clearing is a first-class operation, and must land as NULL not ''.
  update customers set display_name = null
  where id = 'cccccccc-cccc-cccc-cccc-cccccccccc11';
  select display_name into v_name from customers
  where id = 'cccccccc-cccc-cccc-cccc-cccccccccc11';
  assert v_name is null, format('FAIL TEST 2c: clearing left %L', v_name);

  raise notice 'PASS TEST 2: a customer can set and clear their own name';
end;
$$;
rollback;

-- ============================================================
-- TEST 3 (COLUMN GRANT): the write path reaches display_name and NOTHING else
-- Without the column grant, the same policy would let a customer rewrite their
-- own email, phone or device_token — a far bigger hole than the profile form.
-- ============================================================
begin;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_sqlstate text;
begin
  for v_sqlstate in
    select unnest(array['email', 'phone_number', 'device_token', 'auth_user_id', 'claimed_at'])
  loop
    begin
      execute format(
        'update customers set %I = %L where id = %L',
        v_sqlstate,
        case v_sqlstate
          when 'auth_user_id' then 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa22'
          when 'claimed_at'   then '2020-01-01T00:00:00Z'
          else 'tampered@example.com'
        end,
        'cccccccc-cccc-cccc-cccc-cccccccccc11'
      );
      raise exception 'FAIL TEST 3: customer was allowed to UPDATE customers.%', v_sqlstate;
    exception
      when insufficient_privilege then
        null; -- exactly what the column grant should produce
    end;
  end loop;

  raise notice 'PASS TEST 3: only display_name is writable by the customer';
end;
$$;
rollback;

-- ============================================================
-- TEST 4 (RLS): an anonymous device-token row is not writable by anyone
-- This is what keeps an unclaimed visitor out of the profile form: their row
-- has auth_user_id null, and null = auth.uid() is null, never true.
-- ============================================================
begin;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_count int;
begin
  update customers set display_name = 'Claimed by proxy'
  where id = 'cccccccc-cccc-cccc-cccc-cccccccccc33';
  get diagnostics v_count = row_count;
  assert v_count = 0,
    format('FAIL TEST 4: an authenticated user wrote an anonymous row (%s rows)', v_count);
  raise notice 'PASS TEST 4: anonymous rows are unwritable through this path';
end;
$$;
rollback;

-- ============================================================
-- TEST 5 (RLS): a customer cannot READ another customer's profile either
-- The select policy stays own-row-only for EVERY authenticated caller, staff
-- included. Staff reach a customer's name through get_customer_display_name()
-- and only that — see supabase/tests/staff_display_name_test.sql. Keeping this
-- direct path shut is what stops the name grant from dragging email and
-- phone_number along with it.
-- ============================================================
begin;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_count int;
begin
  select count(*) into v_count from customers
  where id = 'cccccccc-cccc-cccc-cccc-cccccccccc22';
  assert v_count = 0, 'FAIL TEST 5a: customer ONE can read customer TWO''s row';

  select count(*) into v_count from customers
  where id = 'cccccccc-cccc-cccc-cccc-cccccccccc11';
  assert v_count = 1, 'FAIL TEST 5b: customer ONE lost SELECT on their own row';

  raise notice 'PASS TEST 5: profile reads are scoped to the owner';
end;
$$;
rollback;

-- ============================================================
-- TEST 6 (CONSTRAINT): the database itself refuses a blank or oversized name
-- The app normalises first; this proves the data cannot be wrong even if a
-- future writer forgets to.
-- ============================================================
do $$
declare v_id uuid := 'cccccccc-cccc-cccc-cccc-cccccccccc11';
begin
  begin
    update customers set display_name = '' where id = v_id;
    raise exception 'FAIL TEST 6a: empty string was accepted';
  exception when check_violation then null;
  end;

  begin
    update customers set display_name = '  Nabil  ' where id = v_id;
    raise exception 'FAIL TEST 6b: an untrimmed name was accepted';
  exception when check_violation then null;
  end;

  begin
    update customers set display_name = repeat('a', 61) where id = v_id;
    raise exception 'FAIL TEST 6c: a 61-character name was accepted';
  exception when check_violation then null;
  end;

  -- The boundary itself must still be allowed.
  update customers set display_name = repeat('a', 60) where id = v_id;
  update customers set display_name = null where id = v_id;

  raise notice 'PASS TEST 6: constraint rejects blank, untrimmed and oversized';
end;
$$;

-- ============================================================
-- Cleanup
-- ============================================================
delete from customers where id in (
  'cccccccc-cccc-cccc-cccc-cccccccccc11',
  'cccccccc-cccc-cccc-cccc-cccccccccc22',
  'cccccccc-cccc-cccc-cccc-cccccccccc33'
);
delete from auth.users where id in (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa22'
);

select 'customer_profile_test: all tests passed' as result;
