-- ============================================================
-- Business-configurable loyalty settings
-- ============================================================
-- Adds staff-editable loyalty settings to the (already live) businesses table:
--   * earning_mode       — per_transaction (MVP) or per_amount (modelled, unused)
--   * points_per_unit     — reserved for spend-based earning; nullable, unused in MVP
--   * reward_description  — human copy for what the reward actually is
-- reward_threshold already exists and is unchanged.
--
-- These statements are written idempotently (guarded type + `if not exists`
-- columns + drop/create policy) so this migration is a no-op on a fresh
-- `db reset` where init_schema.sql already carries the mirrored definitions,
-- while still applying cleanly to the live database that predates them.
-- ============================================================

do $$ begin
  create type earning_mode as enum ('per_transaction', 'per_amount');
exception when duplicate_object then null;
end $$;

alter table businesses
  add column if not exists earning_mode earning_mode not null default 'per_transaction',
  add column if not exists points_per_unit numeric(10,2),
  add column if not exists reward_description text not null default 'Free item';

-- ------------------------------------------------------------
-- RLS: staff may UPDATE their own business (same scoping subquery as the
-- existing select policy). A business's settings are never editable by staff of
-- another business. The actual write path goes through update_business_settings()
-- below (atomic validation + eligibility preservation); this policy is the RLS
-- gate for any direct update and defense-in-depth.
-- ------------------------------------------------------------
drop policy if exists staff_update_own_business on businesses;
create policy staff_update_own_business on businesses
  for update
  using (
    id in (select business_id from staff_users where auth_user_id = auth.uid())
  )
  with check (
    id in (select business_id from staff_users where auth_user_id = auth.uid())
  );

grant update on businesses to authenticated;

-- ------------------------------------------------------------
-- update_business_settings(): staff side.
-- Validates inputs server-side, updates ONLY the caller's own business, and
-- atomically preserves already-earned reward eligibility on a threshold increase.
--
-- SECURITY DEFINER because the eligibility-preservation step writes across
-- enrollments (which staff cannot UPDATE via RLS); the staff-identity check
-- below — auth.uid() -> staff_users.business_id, the same subquery the RLS
-- policies use — is the security boundary, and it scopes every write to the
-- caller's own business only.
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
  v_old_threshold int;
  v_desc          text;
  v_mode          earning_mode;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  -- Staff identity + business scope (mirrors the RLS scoping subquery).
  select business_id into v_business_id
  from staff_users where auth_user_id = v_uid;

  if v_business_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_staff');
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

revoke all on function public.update_business_settings(int, text, text, uuid) from public;
grant execute on function public.update_business_settings(int, text, text, uuid)
  to authenticated, service_role;

comment on function public.update_business_settings(int, text, text, uuid) is
  'Staff side: validates and updates the caller''s own business loyalty settings '
  '(reward_threshold, reward_description, earning_mode) and atomically preserves '
  'already-earned reward eligibility when the threshold is raised. Returns '
  '{ ok:true, ... } or { ok:false, error }.';
