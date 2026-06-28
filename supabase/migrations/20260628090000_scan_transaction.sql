-- ============================================================
-- scan_transaction(): atomic "customer scans a QR" operation
-- ============================================================
-- Records a stamp for a scanned transaction QR in a single, atomic
-- transaction. It:
--   1. Verifies the QR token's HMAC signature and expiry.
--   2. Locks the transaction row and enforces single-use (pending only).
--   3. Resolves or creates the customer following the identity-resolution
--      priority in CLAUDE.md (auth session > device_token > brand new).
--   4. Upserts the (customer, business) enrollment and increments stamps.
--   5. Marks the transaction 'scanned'.
--
-- Runs SECURITY DEFINER because anonymous customers have no auth.uid(), so
-- the customer/enrollment/transaction RLS policies would otherwise block
-- these writes. The QR token's signature + single-use check are the security
-- boundary, not RLS.
--
-- The token format (mirrors lib/qr-token.ts) is a header-less JWT:
--   base64url(payloadJson) . base64url(HMAC-SHA256(payloadB64, secret))
-- where payload = { bid, amt, iat, exp, jti }.
--
-- ---- One-time setup (the signing secret) -------------------
-- The same secret used by the Node signer (QR_TOKEN_SECRET) must be stored in
-- Supabase Vault under the name 'qr_token_secret', e.g.:
--
--   select vault.create_secret('<the same value as QR_TOKEN_SECRET>',
--                              'qr_token_secret',
--                              'HMAC secret for signing QR transaction tokens');
--
-- Vault keeps it encrypted at rest and out of reach of the anon/authenticated
-- API roles; only this SECURITY DEFINER function (owned by postgres) reads it.
-- ============================================================

create extension if not exists supabase_vault;

create or replace function public.scan_transaction(
  p_qr_token     text,
  p_auth_user_id uuid default null,
  p_device_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_secret          text;
  v_payload_b64     text;
  v_sig             text;
  v_expected_sig    text;
  v_b64             text;
  v_payload         jsonb;
  v_token_bid       uuid;
  v_token_exp       bigint;
  v_now             bigint := floor(extract(epoch from now()));

  v_txn             transactions%rowtype;

  v_session_uid     uuid := auth.uid();
  v_auth_user_id    uuid;

  v_customer_id     uuid;
  v_device_token    text;
  v_is_new_customer boolean := false;

  v_enrollment_id   uuid;
  v_current_stamps  int;
  v_threshold       int;
begin
  if p_qr_token is null or p_qr_token = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  -- ---- 1. Parse + verify the HMAC signature ----
  -- Must be exactly two base64url segments separated by a single dot.
  if p_qr_token !~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  v_payload_b64 := split_part(p_qr_token, '.', 1);
  v_sig         := split_part(p_qr_token, '.', 2);

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'qr_token_secret'
  limit 1;

  if v_secret is null then
    raise exception 'qr_token_secret is not configured in Supabase Vault'
      using errcode = 'P0001';
  end if;

  -- base64 -> base64url, all in one translate: + -> -, / -> _, drop '=' and \n.
  v_expected_sig := translate(
    encode(hmac(v_payload_b64, v_secret, 'sha256'), 'base64'),
    '+/=' || E'\n', '-_'
  );

  -- NOTE: not a constant-time compare. Acceptable here because forging a valid
  -- signature is infeasible without the secret, and the token must also match
  -- an existing pending transactions row below.
  if v_expected_sig <> v_sig then
    return jsonb_build_object('ok', false, 'error', 'invalid_signature');
  end if;

  -- ---- 2. Decode the payload + check expiry ----
  begin
    -- base64url -> base64: restore +,/ then pad to a multiple of 4.
    v_b64 := translate(v_payload_b64, '-_', '+/');
    v_b64 := rpad(v_b64, ((length(v_b64) + 3) / 4) * 4, '=');
    v_payload   := convert_from(decode(v_b64, 'base64'), 'utf8')::jsonb;
    v_token_bid := (v_payload->>'bid')::uuid;
    v_token_exp := (v_payload->>'exp')::bigint;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end;

  if v_token_exp is null or v_token_exp <= v_now then
    return jsonb_build_object('ok', false, 'error', 'token_expired');
  end if;

  -- ---- 3. Lock the transaction + enforce single-use ----
  -- FOR UPDATE serialises concurrent scans of the same QR: the second waits,
  -- then sees status = 'scanned' and is rejected.
  select * into v_txn
  from transactions
  where qr_token = p_qr_token
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  if v_txn.business_id <> v_token_bid then
    -- Signed token and stored row disagree on the business; treat as invalid.
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  if v_txn.status = 'scanned' then
    return jsonb_build_object('ok', false, 'error', 'already_scanned');
  end if;

  if v_txn.status = 'expired' or v_txn.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'token_expired');
  end if;

  -- ---- 4. Identity resolution (priority order, per CLAUDE.md) ----
  -- A real Supabase Auth session ALWAYS wins over any passed identifier, so a
  -- logged-in customer's stamps never scatter into an anonymous identity.
  if v_session_uid is not null then
    v_auth_user_id := v_session_uid;
  else
    v_auth_user_id := p_auth_user_id;
  end if;

  if v_auth_user_id is not null then
    -- (1) Logged-in customer: attribute via auth_user_id.
    select id, device_token
      into v_customer_id, v_device_token
    from customers
    where auth_user_id = v_auth_user_id;

    if not found then
      -- A valid session should always have a customer row (created at
      -- signup/claim with phone/email). If not, we cannot synthesise one
      -- (the has-identifier check requires device_token/phone/email).
      return jsonb_build_object('ok', false, 'error', 'customer_not_found');
    end if;

  elsif p_device_token is not null and p_device_token <> '' then
    -- (2) Anonymous customer identified by an existing device token.
    v_device_token := p_device_token;

    select id into v_customer_id
    from customers
    where device_token = v_device_token;

    if not found then
      begin
        insert into customers (device_token, signup_source)
        values (v_device_token, 'qr_scan')
        returning id into v_customer_id;
        v_is_new_customer := true;
      exception when unique_violation then
        -- Concurrent first scan from the same token; re-read the winner.
        select id into v_customer_id
        from customers where device_token = v_device_token;
      end;
    end if;

  else
    -- (3) Brand-new anonymous customer: issue a fresh device token.
    -- NOTE: a plain UUID for now. Tamper-proofing (HMAC-signed device tokens)
    -- is a later milestone (week 5 in CLAUDE.md); the caller sets this as the
    -- device_token cookie.
    v_device_token := gen_random_uuid()::text;
    insert into customers (device_token, signup_source)
    values (v_device_token, 'qr_scan')
    returning id into v_customer_id;
    v_is_new_customer := true;
  end if;

  -- ---- 5. Upsert enrollment + increment stamps ----
  insert into enrollments (customer_id, business_id, current_stamps)
  values (v_customer_id, v_txn.business_id, 1)
  on conflict (customer_id, business_id)
  do update set current_stamps = enrollments.current_stamps + 1
  returning id, current_stamps
    into v_enrollment_id, v_current_stamps;

  -- ---- 6. Mark the transaction scanned (single-use) ----
  update transactions
  set status      = 'scanned',
      customer_id = v_customer_id,
      scanned_at  = now()
  where id = v_txn.id;

  select reward_threshold into v_threshold
  from businesses
  where id = v_txn.business_id;

  return jsonb_build_object(
    'ok',               true,
    'transaction_id',   v_txn.id,
    'business_id',      v_txn.business_id,
    'customer_id',      v_customer_id,
    'device_token',     v_device_token,   -- resolved or newly issued (null if logged-in & no device token)
    'is_new_customer',  v_is_new_customer,
    'enrollment_id',    v_enrollment_id,
    'current_stamps',   v_current_stamps,
    'reward_threshold', v_threshold,
    'reward_reached',   v_current_stamps >= v_threshold
  );
end;
$$;

-- Lock down execution. The anonymous scan WRITE is expected to go through a
-- server route using the service role (mirroring the anonymous-read pattern in
-- CLAUDE.md); logged-in customers may call it directly. anon is intentionally
-- excluded — add `grant execute ... to anon` only if you decide to call this
-- straight from the client.
revoke all on function public.scan_transaction(text, uuid, text) from public;
grant execute on function public.scan_transaction(text, uuid, text)
  to authenticated, service_role;

comment on function public.scan_transaction(text, uuid, text) is
  'Atomically validates a QR token, resolves/creates the customer, increments '
  'their stamp count, and marks the transaction scanned. Returns a jsonb result '
  'with { ok, ... } or { ok:false, error }. Requires the qr_token_secret in Vault.';
