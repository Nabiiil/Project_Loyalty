-- ============================================================
-- Manual stamp override (staff adds a stamp without a QR scan)
-- ============================================================
-- Reuses the transactions table rather than a new one, so a manual stamp shows
-- up in history and analytics like any other transaction — just flagged:
--   * is_manual           — true for a staff override
--   * manual_reason       — 'category' or 'category: note' (category stays the
--                           leading token so abuse analytics can group on it)
--   * created_by_staff_id — the acting staff member (the abuse surface)
--
-- The increment itself must NOT be duplicated: the enrollment upsert that a
-- real scan performs is extracted into increment_enrollment_stamp(), and both
-- scan_transaction() (refactored below) and add_manual_stamp() call it. So a
-- manual stamp and a scanned stamp move the exact same counter the exact same
-- way; only the transactions row that records it differs.
--
-- Written idempotently (`if not exists` columns/index + create-or-replace
-- functions) so it is a no-op on a fresh `db reset` where init_schema.sql
-- already carries the mirrored definitions, while still applying cleanly to the
-- live database that predates them.
-- ============================================================

-- ------------------------------------------------------------
-- transactions: manual-override flags
-- ------------------------------------------------------------
alter table transactions
  add column if not exists is_manual boolean not null default false,
  add column if not exists manual_reason text,
  add column if not exists created_by_staff_id uuid references staff_users(id);

-- Serves both the per-staff/day rate-limit count and the owner history filter;
-- partial so it only indexes the (rare) manual rows.
create index if not exists idx_transactions_manual_staff
  on transactions (created_by_staff_id, created_at)
  where is_manual;

-- ------------------------------------------------------------
-- increment_enrollment_stamp(): the ONE place a stamp is added.
-- Upserts the (customer, business) enrollment and bumps the counter by one.
-- Internal only — SECURITY DEFINER and callable exclusively by the two stamp
-- functions below (both owned by postgres, so they reach it without a grant).
-- It is deliberately NOT granted to authenticated: a direct grant would let any
-- logged-in user hand themselves stamps.
-- ------------------------------------------------------------
create or replace function public.increment_enrollment_stamp(
  p_customer_id uuid,
  p_business_id uuid
)
returns table (enrollment_id uuid, current_stamps int)
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into enrollments (customer_id, business_id, current_stamps)
  values (p_customer_id, p_business_id, 1)
  on conflict (customer_id, business_id)
  do update set current_stamps = enrollments.current_stamps + 1
  returning enrollments.id, enrollments.current_stamps;
$$;

revoke all on function public.increment_enrollment_stamp(uuid, uuid) from public;

-- ------------------------------------------------------------
-- scan_transaction(): unchanged behavior — only the inline enrollment upsert is
-- replaced by a call to increment_enrollment_stamp() so the increment lives in
-- exactly one place. Everything else (HMAC verify, single-use lock, identity
-- resolution, mark-scanned) is identical to 20260628090000.
-- ------------------------------------------------------------
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

  v_expected_sig := translate(
    encode(hmac(v_payload_b64, v_secret, 'sha256'), 'base64'),
    '+/=' || E'\n', '-_'
  );

  if v_expected_sig <> v_sig then
    return jsonb_build_object('ok', false, 'error', 'invalid_signature');
  end if;

  -- ---- 2. Decode the payload + check expiry ----
  begin
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
  select * into v_txn
  from transactions
  where qr_token = p_qr_token
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  if v_txn.business_id <> v_token_bid then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  if v_txn.status = 'scanned' then
    return jsonb_build_object('ok', false, 'error', 'already_scanned');
  end if;

  if v_txn.status = 'expired' or v_txn.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'token_expired');
  end if;

  -- ---- 4. Identity resolution (priority order, per CLAUDE.md) ----
  if v_session_uid is not null then
    v_auth_user_id := v_session_uid;
  else
    v_auth_user_id := p_auth_user_id;
  end if;

  if v_auth_user_id is not null then
    select id, device_token
      into v_customer_id, v_device_token
    from customers
    where auth_user_id = v_auth_user_id;

    if not found then
      return jsonb_build_object('ok', false, 'error', 'customer_not_found');
    end if;

  elsif p_device_token is not null and p_device_token <> '' then
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
        select id into v_customer_id
        from customers where device_token = v_device_token;
      end;
    end if;

  else
    v_device_token := gen_random_uuid()::text;
    insert into customers (device_token, signup_source)
    values (v_device_token, 'qr_scan')
    returning id into v_customer_id;
    v_is_new_customer := true;
  end if;

  -- ---- 5. Upsert enrollment + increment stamps (shared with manual stamps) ----
  select ins.enrollment_id, ins.current_stamps
    into v_enrollment_id, v_current_stamps
  from public.increment_enrollment_stamp(v_customer_id, v_txn.business_id) ins;

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
    'device_token',     v_device_token,
    'is_new_customer',  v_is_new_customer,
    'enrollment_id',    v_enrollment_id,
    'current_stamps',   v_current_stamps,
    'reward_threshold', v_threshold,
    'reward_reached',   v_current_stamps >= v_threshold
  );
end;
$$;

-- ------------------------------------------------------------
-- add_manual_stamp(): staff override side.
--
-- Available to BOTH owner and staff roles (no role gate). Identifies the
-- customer, enforces the per-staff daily rate limit, records a flagged
-- transactions row, and increments through the SAME shared helper as a scan —
-- all in one atomic function.
--
-- SECURITY DEFINER because it writes across the customer/enrollment RLS
-- boundaries (staff cannot upsert an arbitrary customer's enrollment via RLS);
-- the staff-identity check below — auth.uid() -> staff_users — is the security
-- boundary. A real session always wins over the passed id (tests / trusted
-- server callers), mirroring scan_transaction / verify_redemption.
--
-- Customer resolution is intentionally GLOBAL (find the person), not scoped to
-- this business's existing enrollments: a manual stamp may be the customer's
-- first visit here, and the increment upserts the enrollment. If the customer
-- cannot be pinned to exactly one row, NO stamp is written (no orphan).
-- ------------------------------------------------------------
create or replace function public.add_manual_stamp(
  p_identifier         text,               -- phone digits or short code the staff typed
  p_id_kind            text,               -- 'phone' | 'code'
  p_reason_category    text,               -- qr_failed | phone_dead | staff_error | other
  p_reason_note        text default null,  -- optional free text
  p_staff_auth_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  -- Per-staff daily cap. "Start at 10" — the abuse surface is made visible in
  -- the owner history view, not silently blocked beyond this soft limit.
  c_daily_limit constant int := 10;

  v_session_uid    uuid := auth.uid();
  v_staff_uid      uuid;
  v_staff_id       uuid;
  v_business_id    uuid;

  v_category       text;
  v_note           text;
  v_reason         text;

  v_ident          text;
  v_digits         text;
  v_customer_id    uuid;
  v_match_count    int;

  v_used_today     int;
  v_qr_token       text;
  v_enrollment_id  uuid;
  v_current_stamps int;
  v_threshold      int;
begin
  -- ---- Staff identity (owner OR staff; no role gate) ----
  v_staff_uid := coalesce(v_session_uid, p_staff_auth_user_id);
  if v_staff_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select id, business_id into v_staff_id, v_business_id
  from staff_users where auth_user_id = v_staff_uid;

  if v_staff_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_staff');
  end if;

  -- ---- Reason (never skippable) ----
  v_category := lower(btrim(coalesce(p_reason_category, '')));
  if v_category not in ('qr_failed', 'phone_dead', 'staff_error', 'other') then
    return jsonb_build_object('ok', false, 'error', 'invalid_reason');
  end if;
  v_note := btrim(coalesce(p_reason_note, ''));
  if length(v_note) > 200 then
    v_note := left(v_note, 200);
  end if;
  -- Category stays the leading token so analytics can split_part(...,':',1).
  v_reason := case when v_note = '' then v_category else v_category || ': ' || v_note end;

  -- ---- Identify the customer (no orphan stamps) ----
  v_ident := btrim(coalesce(p_identifier, ''));
  if v_ident = '' then
    return jsonb_build_object('ok', false, 'error', 'customer_required');
  end if;

  if p_id_kind = 'phone' then
    -- Match on digits only, so counter formatting differences don't matter.
    v_digits := regexp_replace(v_ident, '\D', '', 'g');
    if length(v_digits) < 6 then
      return jsonb_build_object('ok', false, 'error', 'customer_not_found');
    end if;
    select count(*), (array_agg(id))[1] into v_match_count, v_customer_id
    from customers
    where phone_number is not null
      and regexp_replace(phone_number, '\D', '', 'g') = v_digits;

  elsif p_id_kind = 'code' then
    -- Short code = first 8 hex chars of customers.id (shown on the customer's
    -- own dashboard). Not guaranteed globally unique, so we require an EXACT
    -- single match and otherwise refuse.
    v_ident := lower(regexp_replace(v_ident, '[^0-9a-fA-F]', '', 'g'));
    if length(v_ident) < 8 then
      return jsonb_build_object('ok', false, 'error', 'customer_not_found');
    end if;
    v_ident := left(v_ident, 8);
    select count(*), (array_agg(id))[1] into v_match_count, v_customer_id
    from customers
    where left(id::text, 8) = v_ident;

  else
    return jsonb_build_object('ok', false, 'error', 'invalid_id_kind');
  end if;

  if coalesce(v_match_count, 0) = 0 then
    return jsonb_build_object('ok', false, 'error', 'customer_not_found');
  end if;
  if v_match_count > 1 then
    return jsonb_build_object('ok', false, 'error', 'ambiguous_customer');
  end if;

  -- ---- Rate limit (per staff, per calendar day) ----
  -- Lock this staff's row first so two concurrent overrides can't both read a
  -- count under the cap and both insert past it. NOTE: the day boundary is UTC
  -- (now() is UTC); for Morocco (UTC+1) that resets at ~01:00 local — fine for
  -- a soft abuse cap.
  perform 1 from staff_users where id = v_staff_id for update;

  select count(*) into v_used_today
  from transactions
  where created_by_staff_id = v_staff_id
    and is_manual
    and created_at >= date_trunc('day', now());

  if v_used_today >= c_daily_limit then
    return jsonb_build_object(
      'ok', false, 'error', 'rate_limited',
      'limit', c_daily_limit, 'used', v_used_today
    );
  end if;

  -- ---- Record the flagged transaction ----
  -- qr_token is NOT NULL UNIQUE and meaningless for a manual entry, so mint a
  -- namespaced synthetic value that can never collide with a real signed token
  -- (which is always base64url '.' base64url).
  v_qr_token := 'manual-' || gen_random_uuid()::text;

  insert into transactions (
    business_id, customer_id, qr_token, amount, status,
    expires_at, scanned_at, is_manual, manual_reason, created_by_staff_id
  ) values (
    v_business_id, v_customer_id, v_qr_token, null, 'scanned',
    now(), now(), true, v_reason, v_staff_id
  );

  -- ---- Same atomic increment as a real scan ----
  select ins.enrollment_id, ins.current_stamps
    into v_enrollment_id, v_current_stamps
  from public.increment_enrollment_stamp(v_customer_id, v_business_id) ins;

  select reward_threshold into v_threshold
  from businesses where id = v_business_id;

  return jsonb_build_object(
    'ok',                 true,
    'customer_id',        v_customer_id,
    'enrollment_id',      v_enrollment_id,
    'current_stamps',     v_current_stamps,
    'reward_threshold',   v_threshold,
    'reward_reached',     v_current_stamps >= v_threshold,
    'is_manual',          true,
    'manual_used_today',  v_used_today + 1,
    'manual_daily_limit', c_daily_limit
  );
end;
$$;

revoke all on function public.add_manual_stamp(text, text, text, text, uuid) from public;
grant execute on function public.add_manual_stamp(text, text, text, text, uuid)
  to authenticated, service_role;

comment on function public.increment_enrollment_stamp(uuid, uuid) is
  'Internal: the single place a stamp is added — upserts the (customer, business) '
  'enrollment and increments current_stamps by one. Called only by '
  'scan_transaction() and add_manual_stamp(); not granted to authenticated.';

comment on function public.add_manual_stamp(text, text, text, text, uuid) is
  'Staff (owner or staff) manual stamp override. Identifies the customer by phone '
  'or short code, enforces a per-staff daily limit, records a flagged manual '
  'transaction, and increments via increment_enrollment_stamp(). Returns '
  '{ ok:true, current_stamps, ... } or { ok:false, error }.';
