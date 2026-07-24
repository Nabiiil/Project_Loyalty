-- ============================================================
-- End-to-end tests for scan_transaction()
-- Run: psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/scan_transaction_test.sql
-- ============================================================
\set ON_ERROR_STOP on

-- ============================================================
-- Setup: Vault secret + test business
-- ============================================================

select vault.create_secret(
  'test-hmac-secret-32-chars-minimum!!',
  'qr_token_secret',
  'HMAC secret for QR transaction tokens (local dev only)'
);

insert into businesses (id, name, reward_threshold)
values ('cafecafe-cafe-cafe-cafe-cafecafecafe', 'Test Cafe', 3);

-- ============================================================
-- Helper: generate a valid QR token using the same HMAC logic
-- as the function, so tests are fully self-contained in SQL.
-- ============================================================
create or replace function _test_make_token(
  p_business_id    uuid,
  p_secret         text,
  p_exp_offset_sec int default 900
) returns text language plpgsql as $$
declare
  v_now         bigint := floor(extract(epoch from now()));
  v_payload_raw text;
  v_payload_b64 text;
  v_sig         text;
begin
  v_payload_raw := json_build_object(
    'bid', p_business_id,
    'amt', null,
    'iat', v_now,
    'exp', v_now + p_exp_offset_sec,
    'jti', gen_random_uuid()
  )::text;

  v_payload_b64 := translate(
    encode(v_payload_raw::bytea, 'base64'),
    '+/=' || E'\n', '-_'
  );

  v_sig := translate(
    encode(hmac(v_payload_b64, p_secret, 'sha256'), 'base64'),
    '+/=' || E'\n', '-_'
  );

  return v_payload_b64 || '.' || v_sig;
end;
$$;

-- ============================================================
-- TEST 1: Vault secret is readable from vault.decrypted_secrets
-- ============================================================
do $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'qr_token_secret';

  assert v_secret is not null,
    'FAIL TEST 1: vault secret is null';
  assert v_secret = 'test-hmac-secret-32-chars-minimum!!',
    'FAIL TEST 1: vault secret value mismatch';
  raise notice 'PASS TEST 1: Vault secret read OK';
end;
$$;

-- ============================================================
-- TEST 2: Anonymous scan — brand-new customer (no auth, no device_token)
-- Expected: new customer row created, device_token issued, 1 stamp
-- ============================================================
do $$
declare
  v_secret  text  := 'test-hmac-secret-32-chars-minimum!!';
  v_bid     uuid  := 'cafecafe-cafe-cafe-cafe-cafecafecafe';
  v_token   text  := _test_make_token(v_bid, v_secret);
  v_result  jsonb;
begin
  insert into transactions (business_id, qr_token, status, expires_at)
  values (v_bid, v_token, 'pending', now() + interval '15 minutes');

  v_result := public.scan_transaction(v_token, null, null);
  raise notice 'TEST 2 result: %', v_result;

  assert (v_result->>'ok')::boolean,
    format('FAIL TEST 2: ok=false — %s', v_result);
  assert v_result->>'device_token' is not null,
    'FAIL TEST 2: expected a device_token to be issued';
  assert (v_result->>'is_new_customer')::boolean,
    'FAIL TEST 2: expected is_new_customer=true';
  assert (v_result->>'current_stamps')::int = 1,
    'FAIL TEST 2: expected 1 stamp';
  assert not (v_result->>'reward_reached')::boolean,
    'FAIL TEST 2: threshold=3, reward should not be reached yet';
  raise notice 'PASS TEST 2: brand-new anonymous customer, stamp=1';
end;
$$;

-- ============================================================
-- TEST 3: Anonymous scan — returning customer (known device_token)
-- Expected: same customer recognised, stamp count increments to 2
-- ============================================================
do $$
declare
  v_secret      text  := 'test-hmac-secret-32-chars-minimum!!';
  v_bid         uuid  := 'cafecafe-cafe-cafe-cafe-cafecafecafe';
  v_device_tok  text;
  v_token       text;
  v_result      jsonb;
begin
  select device_token into v_device_tok
  from customers order by created_at limit 1;

  v_token := _test_make_token(v_bid, v_secret);
  insert into transactions (business_id, qr_token, status, expires_at)
  values (v_bid, v_token, 'pending', now() + interval '15 minutes');

  v_result := public.scan_transaction(v_token, null, v_device_tok);
  raise notice 'TEST 3 result: %', v_result;

  assert (v_result->>'ok')::boolean,
    format('FAIL TEST 3: ok=false — %s', v_result);
  assert not (v_result->>'is_new_customer')::boolean,
    'FAIL TEST 3: expected existing customer (is_new_customer=false)';
  assert (v_result->>'current_stamps')::int = 2,
    'FAIL TEST 3: expected stamp count = 2';
  raise notice 'PASS TEST 3: returning anonymous customer, stamp=2';
end;
$$;

-- ============================================================
-- TEST 4: Third scan — reward_reached fires at threshold (3)
-- ============================================================
do $$
declare
  v_secret      text  := 'test-hmac-secret-32-chars-minimum!!';
  v_bid         uuid  := 'cafecafe-cafe-cafe-cafe-cafecafecafe';
  v_device_tok  text;
  v_token       text;
  v_result      jsonb;
begin
  select device_token into v_device_tok
  from customers order by created_at limit 1;

  v_token := _test_make_token(v_bid, v_secret);
  insert into transactions (business_id, qr_token, status, expires_at)
  values (v_bid, v_token, 'pending', now() + interval '15 minutes');

  v_result := public.scan_transaction(v_token, null, v_device_tok);
  raise notice 'TEST 4 result: %', v_result;

  assert (v_result->>'ok')::boolean,
    format('FAIL TEST 4: ok=false — %s', v_result);
  assert (v_result->>'current_stamps')::int = 3,
    'FAIL TEST 4: expected stamp count = 3';
  assert (v_result->>'reward_reached')::boolean,
    'FAIL TEST 4: expected reward_reached=true at threshold 3';
  raise notice 'PASS TEST 4: reward_reached fires at threshold=3, stamp=3';
end;
$$;

-- ============================================================
-- TEST 5: Logged-in customer scan via p_auth_user_id
--         (server-side path: Next.js route resolves the session,
--          passes auth_user_id to the function)
-- Expected: stamps attributed to the claimed customer row
-- ============================================================
do $$
declare
  v_secret      text  := 'test-hmac-secret-32-chars-minimum!!';
  v_bid         uuid  := 'cafecafe-cafe-cafe-cafe-cafecafecafe';
  v_auth_uid    uuid  := gen_random_uuid();
  v_customer_id uuid;
  v_token       text;
  v_result      jsonb;
begin
  -- Minimal auth.users row (direct_signup customer, confirmed email)
  insert into auth.users (
    id, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_user_meta_data, raw_app_meta_data
  ) values (
    v_auth_uid,
    'loggedin@example.com',
    crypt('pw', gen_salt('bf')),
    now(), now(), now(),
    '{}',
    '{"provider":"email","providers":["email"]}'
  );

  -- Customer linked to auth user; no device_token (direct signup)
  insert into customers (email, auth_user_id, claimed_at, signup_source)
  values ('loggedin@example.com', v_auth_uid, now(), 'direct_signup')
  returning id into v_customer_id;

  v_token := _test_make_token(v_bid, v_secret);
  insert into transactions (business_id, qr_token, status, expires_at)
  values (v_bid, v_token, 'pending', now() + interval '15 minutes');

  v_result := public.scan_transaction(v_token, v_auth_uid, null);
  raise notice 'TEST 5 result: %', v_result;

  assert (v_result->>'ok')::boolean,
    format('FAIL TEST 5: ok=false — %s', v_result);
  assert (v_result->>'customer_id')::uuid = v_customer_id,
    'FAIL TEST 5: stamp attributed to wrong customer';
  assert v_result->>'device_token' is null,
    'FAIL TEST 5: device_token should be null for a claimed customer with no device_token';
  assert (v_result->>'current_stamps')::int = 1,
    'FAIL TEST 5: expected 1 stamp for fresh enrollment';
  raise notice 'PASS TEST 5: logged-in customer via p_auth_user_id, stamp=1';
end;
$$;

-- ============================================================
-- TEST 6: auth.uid() session takes priority over p_auth_user_id
--         Simulated by setting request.jwt.claims in-transaction,
--         which is exactly what PostgREST does when serving a JWT.
-- Expected: session uid wins; decoy p_auth_user_id is ignored
-- ============================================================
do $$
declare
  v_secret      text  := 'test-hmac-secret-32-chars-minimum!!';
  v_bid         uuid  := 'cafecafe-cafe-cafe-cafe-cafecafecafe';
  v_auth_uid    uuid;
  v_customer_id uuid;
  v_decoy_uid   uuid  := gen_random_uuid();
  v_token       text;
  v_result      jsonb;
begin
  select auth_user_id, id into v_auth_uid, v_customer_id
  from customers where email = 'loggedin@example.com';

  -- Simulate an active Supabase Auth session for this user
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_auth_uid, 'role', 'authenticated')::text,
    true  -- transaction-local; cleared automatically after this DO block
  );

  v_token := _test_make_token(v_bid, v_secret);
  insert into transactions (business_id, qr_token, status, expires_at)
  values (v_bid, v_token, 'pending', now() + interval '15 minutes');

  -- Pass a decoy p_auth_user_id — auth.uid() (session) must win
  v_result := public.scan_transaction(v_token, v_decoy_uid, null);
  raise notice 'TEST 6 result: %', v_result;

  assert (v_result->>'ok')::boolean,
    format('FAIL TEST 6: ok=false — %s', v_result);
  assert (v_result->>'customer_id')::uuid = v_customer_id,
    format('FAIL TEST 6: session uid should win over decoy; got customer_id=%s', v_result->>'customer_id');
  assert (v_result->>'current_stamps')::int = 2,
    'FAIL TEST 6: expected 2 stamps (second visit for loggedin customer)';
  raise notice 'PASS TEST 6: auth.uid() session beats p_auth_user_id, stamp=2';
end;
$$;

-- ============================================================
-- TEST 7: Double-scan rejection
-- ============================================================
do $$
declare
  v_secret  text  := 'test-hmac-secret-32-chars-minimum!!';
  v_bid     uuid  := 'cafecafe-cafe-cafe-cafe-cafecafecafe';
  v_token   text  := _test_make_token(v_bid, v_secret);
  v_result  jsonb;
begin
  insert into transactions (business_id, qr_token, status, expires_at)
  values (v_bid, v_token, 'pending', now() + interval '15 minutes');

  perform public.scan_transaction(v_token, null, null);       -- first scan (succeeds)
  v_result := public.scan_transaction(v_token, null, null);  -- second scan (must fail)
  raise notice 'TEST 7 result: %', v_result;

  assert not (v_result->>'ok')::boolean,
    'FAIL TEST 7: second scan should be rejected';
  assert v_result->>'error' = 'already_scanned',
    format('FAIL TEST 7: expected error=already_scanned, got %s', v_result->>'error');
  raise notice 'PASS TEST 7: double-scan rejected with already_scanned';
end;
$$;

-- ============================================================
-- TEST 8: Invalid signature rejected
-- ============================================================
do $$
declare
  v_bid     uuid  := 'cafecafe-cafe-cafe-cafe-cafecafecafe';
  -- Token signed with a different secret — signature will not match vault secret
  v_token   text  := _test_make_token(v_bid, 'completely-wrong-secret-!!!!!!!!!');
  v_result  jsonb;
begin
  insert into transactions (business_id, qr_token, status, expires_at)
  values (v_bid, v_token, 'pending', now() + interval '15 minutes');

  v_result := public.scan_transaction(v_token, null, null);
  raise notice 'TEST 8 result: %', v_result;

  assert not (v_result->>'ok')::boolean,
    'FAIL TEST 8: tampered token should be rejected';
  assert v_result->>'error' = 'invalid_signature',
    format('FAIL TEST 8: expected error=invalid_signature, got %s', v_result->>'error');
  raise notice 'PASS TEST 8: invalid signature rejected';
end;
$$;

-- ============================================================
-- TEST 9: Expired token rejected (exp claim in the past)
-- ============================================================
do $$
declare
  v_secret  text  := 'test-hmac-secret-32-chars-minimum!!';
  v_bid     uuid  := 'cafecafe-cafe-cafe-cafe-cafecafecafe';
  -- exp_offset = -1 → exp = now() - 1 second (already expired)
  v_token   text  := _test_make_token(v_bid, v_secret, -1);
  v_result  jsonb;
begin
  insert into transactions (business_id, qr_token, status, expires_at)
  values (v_bid, v_token, 'pending', now() + interval '15 minutes');

  v_result := public.scan_transaction(v_token, null, null);
  raise notice 'TEST 9 result: %', v_result;

  assert not (v_result->>'ok')::boolean,
    'FAIL TEST 9: expired token should be rejected';
  assert v_result->>'error' = 'token_expired',
    format('FAIL TEST 9: expected error=token_expired, got %s', v_result->>'error');
  raise notice 'PASS TEST 9: expired token rejected';
end;
$$;

-- ============================================================
-- Cleanup temp helper
-- ============================================================
drop function _test_make_token(uuid, text, int);

do $$ begin raise notice ''; raise notice '=== All 9 tests passed ==='; end; $$;
