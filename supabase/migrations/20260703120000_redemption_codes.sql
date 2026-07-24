-- ============================================================
-- Redemption codes: account-gated reward claim + atomic staff verify
-- ============================================================
-- Task 7. Earning stamps stays fully account-free (scan_transaction). Only the
-- reward-CLAIM step requires an account.
--
-- Reusing the scan-and-stamp mechanism: a redemption code carries the same
-- single-use + expiry + atomic-DB-function guarantees as a QR token. The code
-- itself is a short, human-typable 6-char string rather than an HMAC-signed
-- token — a 6-char code can't hold a signature — so authenticity comes from the
-- code being minted server-side into a `redemptions` row and every check
-- happening inside one locked transaction (exactly like scan_transaction's
-- FOR UPDATE single-use enforcement), not from a self-verifying token.
--
-- Two functions, both SECURITY DEFINER (they must write across customer/staff
-- RLS boundaries; the checks below are the security boundary, not RLS):
--   * create_redemption()  — customer side: mint (or re-return) a live code for
--     an eligible, already-CLAIMED enrollment.
--   * verify_redemption()  — staff side: re-check eligibility live and, in one
--     atomic locked transaction, mark the code used and reset the stamp count.
-- ============================================================

create extension if not exists "pgcrypto";

-- Short-lived, single-use: mirrors transactions.expires_at.
alter table redemptions
  add column if not exists expires_at timestamptz;

-- ------------------------------------------------------------
-- gen_redemption_code(): random N-char code from an unambiguous
-- alphabet (no 0/O/1/I/L, so staff can read it off a phone screen).
-- ------------------------------------------------------------
create or replace function public.gen_redemption_code(p_len int default 6)
returns text
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- 31 chars
  v_code     text := '';
  i          int;
begin
  for i in 1..p_len loop
    v_code := v_code || substr(
      v_alphabet,
      1 + (get_byte(gen_random_bytes(1), 0) % length(v_alphabet)),
      1
    );
  end loop;
  return v_code;
end;
$$;

-- ------------------------------------------------------------
-- create_redemption(): customer side.
-- Locks the enrollment, enforces the account gate + live eligibility, and
-- returns a live single-use code. Idempotent: if a pending, unexpired code
-- already exists for the enrollment it is returned as-is, so re-rendering the
-- dashboard never mints a fresh code (and never invalidates one already shown).
-- ------------------------------------------------------------
create or replace function public.create_redemption(
  p_enrollment_id uuid,
  p_customer_id   uuid,
  p_ttl_seconds   int default 1800   -- 30 min; long enough to walk to the counter
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_enr        enrollments%rowtype;
  v_auth_uid   uuid;
  v_threshold  int;
  v_existing   redemptions%rowtype;
  v_code       text;
  v_expires_at timestamptz;
  v_attempt    int := 0;
begin
  -- Lock the enrollment so the eligibility read + code mint are race-free.
  select * into v_enr
  from enrollments
  where id = p_enrollment_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_enrollment');
  end if;

  -- Ownership: the caller's customer must own this enrollment.
  if v_enr.customer_id <> p_customer_id then
    return jsonb_build_object('ok', false, 'error', 'not_your_enrollment');
  end if;

  -- Account gate: only a CLAIMED customer (real login) may mint a code.
  select auth_user_id into v_auth_uid
  from customers where id = v_enr.customer_id;

  if v_auth_uid is null then
    return jsonb_build_object('ok', false, 'error', 'account_required');
  end if;

  -- Live eligibility: enough stamps right now.
  select reward_threshold into v_threshold
  from businesses where id = v_enr.business_id;

  if v_enr.current_stamps < v_threshold then
    return jsonb_build_object('ok', false, 'error', 'not_eligible');
  end if;

  -- Reuse an existing live (pending, unexpired) code if there is one.
  select * into v_existing
  from redemptions
  where enrollment_id = p_enrollment_id
    and status = 'pending'
    and (expires_at is null or expires_at > now())
  order by created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'ok',            true,
      'code',          v_existing.redemption_code,
      'redemption_id', v_existing.id,
      'expires_at',    v_existing.expires_at,
      'reused',        true
    );
  end if;

  v_expires_at := now() + make_interval(secs => p_ttl_seconds);

  -- Mint a fresh code, retrying on the (rare) unique(redemption_code) collision.
  loop
    v_attempt := v_attempt + 1;
    v_code := gen_redemption_code(6);
    begin
      insert into redemptions (enrollment_id, redemption_code, status, expires_at)
      values (p_enrollment_id, v_code, 'pending', v_expires_at);
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then
        raise exception 'could not allocate a unique redemption code'
          using errcode = 'P0001';
      end if;
    end;
  end loop;

  return jsonb_build_object(
    'ok',         true,
    'code',       v_code,
    'expires_at', v_expires_at,
    'reused',     false
  );
end;
$$;

-- ------------------------------------------------------------
-- verify_redemption(): staff side.
-- Re-checks eligibility live and atomically consumes the code. Mirrors
-- scan_transaction: a real staff session wins (auth.uid()); the redemption AND
-- enrollment rows are locked FOR UPDATE so two staff verifying the same code
-- serialise — the second sees status = 'verified' and is rejected.
--
-- Returns { ok:true, valid:true|false, ... }. A malformed/unauthenticated call
-- returns { ok:false, error }. Distinct `reason`s let the UI show precise copy.
-- ------------------------------------------------------------
create or replace function public.verify_redemption(
  p_code               text,
  p_staff_auth_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_session_uid uuid := auth.uid();
  v_staff_uid   uuid;
  v_business_id uuid;
  v_red         redemptions%rowtype;
  v_enr         enrollments%rowtype;
  v_threshold   int;
  v_biz_name    text;
begin
  if p_code is null or btrim(p_code) = '' then
    return jsonb_build_object('ok', true, 'valid', false, 'reason', 'invalid_code');
  end if;

  -- Staff identity: a real session always wins; fall back to the passed id
  -- (used by tests / trusted server callers), mirroring scan_transaction.
  v_staff_uid := coalesce(v_session_uid, p_staff_auth_user_id);
  if v_staff_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select business_id into v_business_id
  from staff_users where auth_user_id = v_staff_uid;

  if v_business_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_staff');
  end if;

  -- Lock the redemption row (single-use serialisation).
  select * into v_red
  from redemptions
  where redemption_code = upper(btrim(p_code))
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'valid', false, 'reason', 'invalid_code');
  end if;

  if v_red.status = 'verified' then
    return jsonb_build_object('ok', true, 'valid', false, 'reason', 'already_used');
  end if;

  if v_red.expires_at is not null and v_red.expires_at <= now() then
    return jsonb_build_object('ok', true, 'valid', false, 'reason', 'expired');
  end if;

  -- Lock the enrollment so the eligibility check + stamp reset are atomic.
  select * into v_enr
  from enrollments
  where id = v_red.enrollment_id
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'valid', false, 'reason', 'invalid_code');
  end if;

  -- Business scoping: staff may only verify codes for their own business.
  if v_enr.business_id <> v_business_id then
    return jsonb_build_object('ok', true, 'valid', false, 'reason', 'wrong_business');
  end if;

  select reward_threshold, name into v_threshold, v_biz_name
  from businesses where id = v_enr.business_id;

  if v_enr.current_stamps < v_threshold then
    return jsonb_build_object('ok', true, 'valid', false, 'reason', 'not_eligible');
  end if;

  -- All checks pass: consume the code (single-use) and reset the card.
  update redemptions
  set status = 'verified', verified_at = now()
  where id = v_red.id;

  update enrollments
  set current_stamps = 0
  where id = v_enr.id;

  return jsonb_build_object(
    'ok',            true,
    'valid',         true,
    'business_name', v_biz_name,
    'enrollment_id', v_enr.id,
    'redemption_id', v_red.id
  );
end;
$$;

-- ------------------------------------------------------------
-- Execution grants. Both funcs are the security boundary themselves, so lock
-- out PUBLIC and expose only to the authenticated API role (customers/staff
-- call them through their own sessions) and service_role (server routes/tests).
-- ------------------------------------------------------------
revoke all on function public.gen_redemption_code(int) from public;

revoke all on function public.create_redemption(uuid, uuid, int) from public;
grant execute on function public.create_redemption(uuid, uuid, int)
  to authenticated, service_role;

revoke all on function public.verify_redemption(text, uuid) from public;
grant execute on function public.verify_redemption(text, uuid)
  to authenticated, service_role;

comment on function public.create_redemption(uuid, uuid, int) is
  'Customer side: mints (or re-returns) a live single-use redemption code for an '
  'eligible, account-claimed enrollment. Returns { ok, code, expires_at, ... }.';

comment on function public.verify_redemption(text, uuid) is
  'Staff side: atomically re-checks reward eligibility for a redemption code, '
  'marks it verified (single-use) and resets the enrollment stamp count. '
  'Returns { ok:true, valid, reason?, business_name? }.';
