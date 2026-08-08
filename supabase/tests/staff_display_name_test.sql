-- ============================================================
-- Tests for get_customer_display_name() — staff-side name visibility
-- Run: psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/staff_display_name_test.sql
--
-- Two promises are under test, and the second matters more than the first:
--   1. Staff CAN see the chosen name of a customer who visits their business.
--   2. Staff can see NOTHING else — not another business's customers, and not
--      any contact detail of their own customers.
--
-- The function is SECURITY DEFINER, so it bypasses RLS by construction. That
-- makes its own two gates (caller is staff / customer belongs to that business)
-- the entire access control, which is why the denial cases are exercised
-- against the deployed function rather than against app code.
--
-- Cast of characters:
--   Business ONE  bbbbbbbb-...-bbbbbbbbbb11   Staff One  aaaaaaaa-...-aaaaaaaaaa11
--   Business TWO  bbbbbbbb-...-bbbbbbbbbb22   Staff Two  aaaaaaaa-...-aaaaaaaaaa22
--   Customer ONE  cccccccc-...-cccccccccc11   "Nabil"   — enrolled at ONE only
--   Customer TWO  cccccccc-...-cccccccccc22   "Amina"   — enrolled at TWO only
--   Customer NAMELESS cccccccc-...-cccccccccc33        — enrolled at ONE, no name
--   Plain user    aaaaaaaa-...-aaaaaaaaaa99   authenticated but not staff
-- ============================================================
\set ON_ERROR_STOP on

-- ============================================================
-- Setup (idempotent: a failed run aborts before its own cleanup)
-- ============================================================
delete from enrollments where customer_id in (
  'cccccccc-cccc-cccc-cccc-cccccccccc11',
  'cccccccc-cccc-cccc-cccc-cccccccccc22',
  'cccccccc-cccc-cccc-cccc-cccccccccc33');
delete from customers where id in (
  'cccccccc-cccc-cccc-cccc-cccccccccc11',
  'cccccccc-cccc-cccc-cccc-cccccccccc22',
  'cccccccc-cccc-cccc-cccc-cccccccccc33');
delete from staff_users where auth_user_id in (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa22');
delete from businesses where id in (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb22');
delete from auth.users where id in (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa22',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa99');

insert into businesses (id, name, reward_threshold) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11', 'Cafe One', 10),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb22', 'Cafe Two', 10);

insert into auth.users (id, instance_id, aud, role, email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'staff-one@example.com'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa22', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'staff-two@example.com'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa99', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'plain@example.com');

insert into staff_users (business_id, auth_user_id, name, role) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11', 'Staff One', 'staff'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb22', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa22', 'Staff Two', 'staff');

-- Contact details are present on purpose: the point is that staff can reach the
-- name while these stay unreachable.
insert into customers (id, device_token, email, phone_number, signup_source, display_name) values
  ('cccccccc-cccc-cccc-cccc-cccccccccc11', 'dt-name-1', 'nabil@example.com', '+212600000001', 'qr_scan', 'Nabil'),
  ('cccccccc-cccc-cccc-cccc-cccccccccc22', 'dt-name-2', 'amina@example.com', '+212600000002', 'qr_scan', 'Amina'),
  ('cccccccc-cccc-cccc-cccc-cccccccccc33', 'dt-name-3', 'nemo@example.com',  '+212600000003', 'qr_scan', null);

insert into enrollments (customer_id, business_id, current_stamps) values
  ('cccccccc-cccc-cccc-cccc-cccccccccc11', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11', 7),
  ('cccccccc-cccc-cccc-cccc-cccccccccc22', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb22', 3),
  ('cccccccc-cccc-cccc-cccc-cccccccccc33', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11', 2);

-- ============================================================
-- TEST 1: staff see the name of their OWN business's customer
-- ============================================================
begin;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_name text;
begin
  v_name := public.get_customer_display_name('cccccccc-cccc-cccc-cccc-cccccccccc11');
  assert v_name = 'Nabil', format('FAIL TEST 1: expected Nabil, got %L', v_name);
  raise notice 'PASS TEST 1: staff can greet their own regular by name';
end;
$$;
rollback;

-- ============================================================
-- TEST 2 (THE DENIAL CASE): staff CANNOT see another business's customer
-- Customer TWO visits Cafe Two only. Staff One must get nothing.
-- ============================================================
begin;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_name text;
begin
  v_name := public.get_customer_display_name('cccccccc-cccc-cccc-cccc-cccccccccc22');
  assert v_name is null,
    format('FAIL TEST 2a: Staff One read a Cafe Two customer''s name (%L)', v_name);

  -- And the mirror image, so the test cannot pass by the function simply
  -- always returning null for customer TWO.
  raise notice 'PASS TEST 2a: no cross-business read';
end;
$$;
rollback;

begin;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa22","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_name text;
begin
  v_name := public.get_customer_display_name('cccccccc-cccc-cccc-cccc-cccccccccc22');
  assert v_name = 'Amina',
    format('FAIL TEST 2b: Staff Two cannot see their OWN customer (%L)', v_name);

  v_name := public.get_customer_display_name('cccccccc-cccc-cccc-cccc-cccccccccc11');
  assert v_name is null,
    format('FAIL TEST 2c: Staff Two read a Cafe One customer''s name (%L)', v_name);

  raise notice 'PASS TEST 2b/2c: scoping is per-business in both directions';
end;
$$;
rollback;

-- ============================================================
-- TEST 3: an authenticated NON-staff user gets nothing
-- Being signed in is not the same as working at the counter.
-- ============================================================
begin;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa99","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_name text;
begin
  v_name := public.get_customer_display_name('cccccccc-cccc-cccc-cccc-cccccccccc11');
  assert v_name is null, format('FAIL TEST 3: a non-staff user read a name (%L)', v_name);
  raise notice 'PASS TEST 3: non-staff callers get nothing';
end;
$$;
rollback;

-- ============================================================
-- TEST 4: a customer with no name returns NULL, not '' or a placeholder
-- The UI relies on this to render the count alone with no empty artifact.
-- ============================================================
begin;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_name text;
begin
  v_name := public.get_customer_display_name('cccccccc-cccc-cccc-cccc-cccccccccc33');
  assert v_name is null, format('FAIL TEST 4a: expected NULL, got %L', v_name);

  -- A customer id that does not exist is indistinguishable from the above, so
  -- the function cannot be used to probe which ids are real.
  v_name := public.get_customer_display_name('cccccccc-cccc-cccc-cccc-ccccccccdead');
  assert v_name is null, format('FAIL TEST 4b: expected NULL, got %L', v_name);

  v_name := public.get_customer_display_name(null);
  assert v_name is null, 'FAIL TEST 4c: null argument should return null';

  raise notice 'PASS TEST 4: nameless, unknown and null all return NULL alike';
end;
$$;
rollback;

-- ============================================================
-- TEST 5 (THE CONTAINMENT CASE): the name is ALL staff can reach
-- The whole design rests on the direct table path staying shut. If a future
-- change adds a staff SELECT policy on customers, the table-wide column grant
-- means email and phone go with it — this test is what catches that.
-- ============================================================
begin;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_count int;
begin
  -- Their own business's customer, whose NAME they are allowed to see.
  select count(*) into v_count from customers
  where id = 'cccccccc-cccc-cccc-cccc-cccccccccc11';
  assert v_count = 0,
    'FAIL TEST 5a: staff can SELECT a customer row directly — contact details are exposed';

  select count(*) into v_count from customers;
  assert v_count = 0,
    format('FAIL TEST 5b: staff can see %s customer rows through the table', v_count);

  raise notice 'PASS TEST 5: staff have no direct table access to customers';
end;
$$;
rollback;

-- ============================================================
-- TEST 6: the function's signature cannot carry a contact detail
-- Belt and braces on TEST 5: whatever the body does, the return type is text.
-- ============================================================
do $$
declare v_type text;
begin
  select pg_catalog.format_type(prorettype, null) into v_type
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_customer_display_name';

  assert v_type = 'text',
    format('FAIL TEST 6: return type is %L — a row type could carry more than the name', v_type);
  raise notice 'PASS TEST 6: returns a bare text value';
end;
$$;

-- ============================================================
-- TEST 7: anon (no session at all) cannot execute it
-- ============================================================
begin;
set local role anon;
do $$
declare v_name text;
begin
  begin
    v_name := public.get_customer_display_name('cccccccc-cccc-cccc-cccc-cccccccccc11');
    raise exception 'FAIL TEST 7: anon executed the function (got %L)', v_name;
  exception
    when insufficient_privilege then
      raise notice 'PASS TEST 7: anon cannot execute the function';
  end;
end;
$$;
rollback;

-- ============================================================
-- Cleanup
-- ============================================================
delete from enrollments where customer_id in (
  'cccccccc-cccc-cccc-cccc-cccccccccc11',
  'cccccccc-cccc-cccc-cccc-cccccccccc22',
  'cccccccc-cccc-cccc-cccc-cccccccccc33');
delete from customers where id in (
  'cccccccc-cccc-cccc-cccc-cccccccccc11',
  'cccccccc-cccc-cccc-cccc-cccccccccc22',
  'cccccccc-cccc-cccc-cccc-cccccccccc33');
delete from staff_users where auth_user_id in (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa22');
delete from businesses where id in (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb22');
delete from auth.users where id in (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa22',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa99');

select 'staff_display_name_test: all tests passed' as result;
