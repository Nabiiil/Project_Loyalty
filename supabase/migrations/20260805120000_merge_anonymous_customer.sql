-- ============================================================
-- merge_anonymous_customer(): single-use transfer of an anonymous
-- device-token customer into a claimed account
-- ============================================================
-- When a browser carrying an anonymous `device_token` identity signs in as an
-- account that ALREADY has its own customer row, the anonymous row's loyalty
-- history is folded into that account (the 'merge-into-existing' branch of
-- lib/customer-claim.decideClaimAction). This used to run as a loop of separate
-- PostgREST calls from /auth/complete, which left two holes:
--
--   1. Not atomic. A failure between "add the anon stamps to the account" and
--      "drop the anon row" left the stamps counted on the account while the row
--      (and therefore the device token) was still live — a retry summed them a
--      second time. Every write now lands in ONE transaction.
--   2. Not single-use. Two concurrent completions (a double-tapped magic link,
--      a browser retry of the redirect) both read the same anonymous row and
--      both merged it. The `for update` gate below serialises them: the second
--      one blocks, then finds the row already retired and no-ops.
--
-- Retiring the row by DELETE is deliberately what makes the merge unrepeatable:
-- the unique `customers.device_token` disappears with it, so a stale cookie can
-- never resolve back to an already-merged identity. A later scan on that stale
-- token falls through to scan_transaction's "brand new anonymous customer"
-- branch and starts a fresh card — new stamps, never the transferred ones.
--
-- Runs SECURITY DEFINER for the same reason as scan_transaction(): the rows
-- being moved belong to an anonymous customer with no auth.uid(), so the
-- customers/enrollments RLS policies would block the writes. Callable only by
-- service_role — the claim flow is server-side only.
-- ============================================================

create or replace function public.merge_anonymous_customer(
  p_anon_customer_id   uuid,
  p_target_customer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_summed int := 0;
  v_moved  int := 0;
begin
  if p_anon_customer_id is null or p_target_customer_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_request');
  end if;

  if p_anon_customer_id = p_target_customer_id then
    -- Same identity on both sides: nothing to transfer, and definitely nothing
    -- to delete. Reported as a successful no-op so a caller that raced into
    -- this state does not treat it as a failure.
    return jsonb_build_object('ok', true, 'merged', false, 'reason', 'same_customer');
  end if;

  -- ---- 1. Single-use gate ----
  -- Lock the anonymous row and require it to still be UNCLAIMED. A concurrent
  -- or retried merge waits here and then sees either no row (already retired)
  -- or a claimed one, and returns without moving anything a second time.
  perform 1
  from customers
  where id = p_anon_customer_id
    and auth_user_id is null
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'merged', false, 'reason', 'already_merged');
  end if;

  -- ---- 2. Pin the destination ----
  -- Lock ordering is safe: a merge source always has auth_user_id null and a
  -- merge target always has it set, so two merges can never hold each other's
  -- rows in the opposite order.
  perform 1 from customers where id = p_target_customer_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'target_not_found');
  end if;

  -- ---- 3. Overlap: both sides hold a card at the same business ----
  -- Redemption codes move first. They hang off enrollments with ON DELETE
  -- CASCADE, and the anonymous side's overlapping enrollments are dropped in
  -- step 6 once their stamps are summed across — so a code already handed to
  -- the customer would otherwise vanish mid-merge.
  update redemptions r
  set enrollment_id = t.id
  from enrollments a
  join enrollments t
    on t.customer_id = p_target_customer_id
   and t.business_id = a.business_id
  where a.customer_id  = p_anon_customer_id
    and r.enrollment_id = a.id;

  update enrollments t
  set current_stamps = t.current_stamps + a.current_stamps
  from enrollments a
  where a.customer_id = p_anon_customer_id
    and t.customer_id = p_target_customer_id
    and t.business_id = a.business_id;

  get diagnostics v_summed = row_count;

  -- ---- 4. No overlap: hand the card over as-is ----
  -- `unique (customer_id, business_id)` means the anonymous side holds at most
  -- one enrollment per business, so this cannot collide with step 3's rows.
  update enrollments e
  set customer_id = p_target_customer_id
  where e.customer_id = p_anon_customer_id
    and not exists (
      select 1
      from enrollments t
      where t.customer_id = p_target_customer_id
        and t.business_id = e.business_id
    );

  get diagnostics v_moved = row_count;

  -- ---- 5. Carry the scan history ----
  -- transactions.customer_id is ON DELETE SET NULL, so without this the delete
  -- below would silently anonymise every scan the customer made before signing
  -- in. Reassigning keeps their history attributed to the surviving account.
  update transactions
  set customer_id = p_target_customer_id
  where customer_id = p_anon_customer_id;

  -- ---- 6. Retire the anonymous identity ----
  -- The overlapping enrollments left over from step 3 (already summed into the
  -- target) cascade away with the row.
  delete from customers where id = p_anon_customer_id;

  return jsonb_build_object(
    'ok',                 true,
    'merged',             true,
    'enrollments_summed', v_summed,
    'enrollments_moved',  v_moved
  );
end;
$$;

revoke all on function public.merge_anonymous_customer(uuid, uuid) from public;
grant execute on function public.merge_anonymous_customer(uuid, uuid) to service_role;

comment on function public.merge_anonymous_customer(uuid, uuid) is
  'Atomically folds an anonymous device-token customer''s enrollments, scans and '
  'redemption codes into a claimed account, then retires the anonymous row so it '
  'can never be merged again. Idempotent: a repeat call returns '
  '{ ok:true, merged:false, reason:"already_merged" } without moving anything.';
