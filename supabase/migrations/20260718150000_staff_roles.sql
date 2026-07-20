-- ============================================================
-- Owner vs staff roles
-- ============================================================
-- Splits staff logins into two roles:
--   * owner — the founder-onboarded business owner; can edit business
--             settings and manage (list/add/remove) staff logins.
--   * staff — counter staff; can run transactions and verify rewards,
--             nothing else.
--
-- Rules encoded here (the DB is the last line of defense, the app
-- layers repeat these checks):
--   * staff_users.role defaults to 'staff'; owner is only ever set
--     explicitly (founder onboarding / service role). One owner per
--     business in the MVP — owners cannot mint other owners.
--   * UPDATE on businesses requires role = 'owner'. SELECT stays
--     available to all staff of the business.
--   * Owners can SELECT all staff_users rows of their own business
--     (to render the staff management screen). Non-owners still see
--     only their own row. All staff-management WRITES go through the
--     service role server-side; authenticated has no insert/update/
--     delete grants on staff_users at all.
--
-- Written idempotently (guarded type + `if not exists` column +
-- drop/create policy + create-or-replace functions) so it is a no-op
-- on a fresh `db reset` where init_schema.sql already carries the
-- mirrored definitions, while still applying cleanly to the live
-- database that predates them.
-- ============================================================

do $$ begin
  create type staff_role as enum ('owner', 'staff');
exception when duplicate_object then null;
end $$;

-- Default is the least-privileged role; existing live rows become 'staff'.
-- The demo/test owner gets promoted explicitly (see setup-dev.mjs / manual SQL).
alter table staff_users
  add column if not exists role staff_role not null default 'staff';

-- ------------------------------------------------------------
-- is_business_owner(): does the current auth.uid() hold an owner
-- staff_users row for this business?
--
-- SECURITY DEFINER for two reasons:
--   1. A policy on staff_users cannot subquery staff_users itself
--      (infinite RLS recursion); this function reads it as the table
--      owner, outside RLS.
--   2. It keeps the owner test in exactly one place for the
--      businesses policy, the staff_users policy, and any future
--      owner-gated object.
-- ------------------------------------------------------------
create or replace function public.is_business_owner(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from staff_users
    where auth_user_id = auth.uid()
      and business_id  = p_business_id
      and role         = 'owner'
  );
$$;

revoke all on function public.is_business_owner(uuid) from public;
grant execute on function public.is_business_owner(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- businesses: settings writes are owner-only. SELECT (staff_select_own_business)
-- is untouched — all staff of a business may still read it.
-- ------------------------------------------------------------
-- Drop BOTH names: staff_update_own_business is the live pre-role policy, and
-- on a fresh db reset the 20260718120000 migration recreates it after
-- init_schema already created owner_update_own_business — without both drops
-- the permissive policy would survive (policies OR together) or the create
-- below would collide.
drop policy if exists staff_update_own_business on businesses;
drop policy if exists owner_update_own_business on businesses;
create policy owner_update_own_business on businesses
  for update
  using (public.is_business_owner(id))
  with check (public.is_business_owner(id));

-- ------------------------------------------------------------
-- staff_users: owners see every staff row of their own business
-- (staff management list). staff_select_own_staff_row (own row only)
-- stays for non-owners. No write policies and no write grants for
-- authenticated: adding/removing staff happens server-side via the
-- service role only.
-- ------------------------------------------------------------
drop policy if exists owner_select_business_staff on staff_users;
create policy owner_select_business_staff on staff_users
  for select using (public.is_business_owner(business_id));

-- ------------------------------------------------------------
-- update_business_settings(): now owner-only.
-- Same body as 20260718120000, plus the role gate — this function is
-- SECURITY DEFINER, so the businesses RLS policy above does NOT apply
-- inside it; without this explicit check any staff login could still
-- edit settings through the RPC.
-- ------------------------------------------------------------
create or replace function public.update_business_settings(
  p_reward_threshold   int,
  p_reward_description text,
  p_earning_mode       text default 'per_transaction',
  p_staff_auth_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  -- A real session always wins; fall back to the passed id (tests / trusted
  -- server callers), mirroring scan_transaction / verify_redemption.
  v_uid           uuid := coalesce(auth.uid(), p_staff_auth_user_id);
  v_business_id   uuid;
  v_role          staff_role;
  v_old_threshold int;
  v_desc          text;
  v_mode          earning_mode;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  -- Staff identity + business scope (mirrors the RLS scoping subquery).
  select business_id, role into v_business_id, v_role
  from staff_users where auth_user_id = v_uid;

  if v_business_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_staff');
  end if;

  -- Settings are owner-only; counter staff cannot change loyalty terms.
  if v_role <> 'owner' then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  -- ---- Server-side validation (never trust the client) ----
  if p_reward_threshold is null or p_reward_threshold < 1 then
    return jsonb_build_object('ok', false, 'error', 'invalid_threshold');
  end if;

  v_desc := btrim(coalesce(p_reward_description, ''));
  if v_desc = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_description');
  end if;
  if length(v_desc) > 120 then
    return jsonb_build_object('ok', false, 'error', 'description_too_long');
  end if;

  -- MVP: only per_transaction earning is supported. per_amount lives in the data
  -- model but spend-based earning logic isn't built, so it is not selectable.
  if p_earning_mode is null or p_earning_mode <> 'per_transaction' then
    return jsonb_build_object('ok', false, 'error', 'invalid_earning_mode');
  end if;
  v_mode := p_earning_mode::earning_mode;

  -- Lock the business row so the old-threshold read, the update, and the
  -- eligibility-preservation pass are one atomic unit — no redemption can slip
  -- in between and see an inconsistent threshold.
  select reward_threshold into v_old_threshold
  from businesses where id = v_business_id
  for update;

  update businesses
  set reward_threshold   = p_reward_threshold,
      reward_description = v_desc,
      earning_mode       = v_mode
  where id = v_business_id;

  -- ---- Threshold change behavior (explicit eligibility preservation) ----
  -- Changes apply going forward. A threshold INCREASE must never retroactively
  -- revoke a reward a customer already qualified for. Any enrollment that already
  -- met the OLD threshold but would now fall short of the NEW one is topped up to
  -- the new threshold so it stays redeemable. (Verifying a redemption resets
  -- stamps to 0 regardless, so this preserves exactly the one earned reward.)
  if p_reward_threshold > v_old_threshold then
    update enrollments
    set current_stamps = p_reward_threshold
    where business_id = v_business_id
      and current_stamps >= v_old_threshold
      and current_stamps < p_reward_threshold;
  end if;

  return jsonb_build_object(
    'ok',                 true,
    'reward_threshold',   p_reward_threshold,
    'reward_description', v_desc,
    'earning_mode',       v_mode
  );
end;
$$;

comment on function public.update_business_settings(int, text, text, uuid) is
  'Owner side: validates and updates the caller''s own business loyalty settings '
  '(reward_threshold, reward_description, earning_mode) and atomically preserves '
  'already-earned reward eligibility when the threshold is raised. Requires '
  'staff_users.role = owner. Returns { ok:true, ... } or { ok:false, error }.';
