-- ============================================================
-- get_customer_display_name(): staff may greet a regular by name
-- ============================================================
-- Reverses the visibility decision recorded in
-- 20260808120000_customer_display_name.sql. A display name is NOT a contact
-- detail: the "no customer details to businesses" principle in CLAUDE.md exists
-- to stop a business marketing directly to a customer or pulling them out of
-- the centralized relationship, and a chosen first name does neither. Staff
-- recognising a regular by name is the relationship moment the scan
-- confirmation exists to create, so the name — and only the name — now crosses
-- to the business side.
--
-- ---- Why an RPC and NOT an RLS policy ------------------------------------
-- The obvious-looking implementation is a second SELECT policy on customers
-- letting staff see rows belonging to their business. That would be a serious
-- leak. `grant select on customers to authenticated` is TABLE-WIDE (see
-- init_schema), so any row a policy exposes to staff is exposed with every
-- column on it: email, phone_number, device_token, auth_user_id, claimed_at.
-- Row-level access cannot express "this column only".
--
-- This function can. It returns `text` — there is no shape in which it could
-- hand back a contact detail even if the body were later edited carelessly. The
-- customers SELECT policy stays exactly as it was (own row only), which keeps
-- the direct table path shut for staff; see the denial tests in
-- supabase/tests/customer_profile_test.sql and staff_display_name_test.sql.
--
-- ---- Scoping --------------------------------------------------------------
-- Two gates, both server-side:
--   1. The caller must hold a staff_users row. Identity comes from auth.uid(),
--      read from the caller's JWT — there is no staff-id parameter to forge.
--   2. The customer must actually be this business's customer (an enrollment,
--      or a scanned transaction, with the caller's business).
-- Failing either returns NULL, the same value as "this customer has not set a
-- name". A caller therefore cannot use it to probe whether a customer id exists
-- or belongs to someone else.
--
-- The write path is untouched: customers still update only their own
-- display_name through the column grant and customer_update_own_row.
-- ============================================================

create or replace function public.get_customer_display_name(p_customer_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_business_id uuid;
  v_name        text;
begin
  if p_customer_id is null then
    return null;
  end if;

  -- ---- Gate 1: the caller is staff, and we take their business from the
  -- session rather than from an argument.
  select business_id into v_business_id
  from staff_users
  where auth_user_id = auth.uid();

  if not found then
    return null;
  end if;

  -- ---- Gate 2: the customer is one of THIS business's customers.
  if not exists (
    select 1 from enrollments e
    where e.customer_id = p_customer_id
      and e.business_id = v_business_id
  ) and not exists (
    select 1 from transactions t
    where t.customer_id = p_customer_id
      and t.business_id = v_business_id
      and t.status = 'scanned'
  ) then
    return null;
  end if;

  select display_name into v_name
  from customers
  where id = p_customer_id;

  return v_name;
end;
$$;

revoke all on function public.get_customer_display_name(uuid) from public;
grant execute on function public.get_customer_display_name(uuid) to authenticated, service_role;

comment on function public.get_customer_display_name(uuid) is
  'Returns a customer''s chosen display name to staff of a business that '
  'customer actually visits, or NULL. Deliberately returns text and not a row: '
  'it is the ONLY staff-side path to display_name, and it cannot expose email, '
  'phone_number, device_token, auth_user_id or claimed_at. Scoped by auth.uid() '
  'to the caller''s own business.';

-- The column comment on customers.display_name documented the previous
-- (customer-only) decision. Restate it so the schema does not describe a policy
-- the code no longer follows.
comment on column customers.display_name is
  'Optional self-chosen name. Shown to the customer on their own dashboard AND '
  'to staff of businesses they visit, via get_customer_display_name() only — '
  'never through direct table access. Contact details remain business-invisible. '
  'The customer is told about this before entering it '
  '(customerProfile.privacyNote in messages/*.json).';
