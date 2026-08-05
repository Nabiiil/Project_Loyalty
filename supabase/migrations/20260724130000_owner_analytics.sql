-- ============================================================
-- Owner analytics + history log (read-only, aggregate in SQL)
-- ============================================================
-- No new tables/columns — everything is derived from transactions, enrollments
-- and redemptions. Two SECURITY DEFINER functions do ALL the aggregation and
-- the union server-side (the guardrail: never pull rows into JS to count them):
--   * get_owner_analytics()  — the four "did this make money?" metrics.
--   * get_business_history() — reverse-chronological transactions + redemptions,
--                              date-range filterable, for dispute resolution.
--
-- Both are owner-only and scoped to the CALLER'S OWN business: the business_id
-- is derived from the caller's staff_users row (auth.uid()), never passed in,
-- so a client can't aim these at another business. This is the RLS-equivalent
-- boundary for SECURITY DEFINER code (RLS is bypassed inside a definer function;
-- the explicit owner + own-business check below is what replaces it).
--
-- Indexes support the scanned_at range scans and the redemptions/enrollments
-- join; written idempotently so this is a no-op on a fresh `db reset` where
-- init_schema.sql already carries the mirrored index definitions.
-- ============================================================

-- Given in the task: speeds the per-business scanned_at range scans that every
-- metric and the history log depend on.
create index if not exists idx_transactions_scanned_at
  on transactions (business_id, scanned_at);

-- Helps the redemptions-by-business join (enrollments is otherwise only indexed
-- by (customer_id, business_id), whose leading column is the wrong one here).
create index if not exists idx_enrollments_business_id
  on enrollments (business_id);

-- ------------------------------------------------------------
-- get_owner_analytics(p_days): the four money-question metrics over a window.
-- Deliberately NO total-scan vanity counter.
-- ------------------------------------------------------------
create or replace function public.get_owner_analytics(
  p_days               int default 30,
  p_staff_auth_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid          uuid := coalesce(auth.uid(), p_staff_auth_user_id);
  v_business_id  uuid;
  v_role         staff_role;
  v_days         int := greatest(1, least(coalesce(p_days, 30), 365));
  v_since        timestamptz := now() - make_interval(days => v_days);
  v_enrolled     int;
  v_visits       int;
  v_repeat_rate  numeric;
  v_avg_gap      numeric;
  v_series       jsonb;
  v_red_issued   int;
  v_red_verified int;
begin
  -- ---- Owner + own-business gate (the security boundary) ----
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select business_id, role into v_business_id, v_role
  from staff_users where auth_user_id = v_uid;

  if v_business_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_staff');
  end if;
  if v_role <> 'owner' then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  -- ---- 1. Repeat visit rate: avg visits per enrolled customer per 30 days ----
  -- A "visit" is a scanned transaction (QR scan OR manual stamp — both mean the
  -- customer earned a stamp). Normalised to a 30-day month over the window.
  select count(*) into v_enrolled
  from enrollments where business_id = v_business_id;

  select count(*) into v_visits
  from transactions
  where business_id = v_business_id
    and status = 'scanned'
    and scanned_at >= v_since;

  v_repeat_rate := case
    when v_enrolled = 0 then 0
    else round((v_visits::numeric / v_enrolled) * (30.0 / v_days), 2)
  end;

  -- ---- 2. New vs returning customers over time (daily, full span) ----
  -- New = a customer's first-EVER visit here falls on that day; returning = they
  -- visited that day but had visited before. First-visit is computed over all
  -- time so a customer whose first visit predates the window counts as returning
  -- throughout it. generate_series fills gaps so the chart has continuous days.
  with first_visit as (
    select customer_id, min(scanned_at) as first_at
    from transactions
    where business_id = v_business_id and status = 'scanned' and customer_id is not null
    group by customer_id
  ),
  daily as (
    select
      date_trunc('day', t.scanned_at)::date as day,
      count(distinct t.customer_id)
        filter (where date_trunc('day', t.scanned_at) = date_trunc('day', fv.first_at)) as new_customers,
      count(distinct t.customer_id)
        filter (where date_trunc('day', t.scanned_at) > date_trunc('day', fv.first_at)) as returning_customers
    from transactions t
    join first_visit fv on fv.customer_id = t.customer_id
    where t.business_id = v_business_id
      and t.status = 'scanned'
      and t.scanned_at >= v_since
      and t.customer_id is not null
    group by 1
  ),
  span as (
    select generate_series(date_trunc('day', v_since)::date, current_date, interval '1 day')::date as day
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'day', s.day,
             'new', coalesce(d.new_customers, 0),
             'returning', coalesce(d.returning_customers, 0)
           ) order by s.day
         ), '[]'::jsonb)
  into v_series
  from span s
  left join daily d using (day);

  -- ---- 3. Redemptions issued vs verified (by issue date, in window) ----
  select
    count(*),
    count(*) filter (where r.status = 'verified')
  into v_red_issued, v_red_verified
  from redemptions r
  join enrollments e on e.id = r.enrollment_id
  where e.business_id = v_business_id
    and r.created_at >= v_since;

  -- ---- 4. Average days between visits per customer (window) ----
  -- Per customer, the mean gap between consecutive visits; then averaged across
  -- customers who have at least two visits.
  with gaps as (
    select
      customer_id,
      extract(epoch from (
        scanned_at - lag(scanned_at) over (partition by customer_id order by scanned_at)
      )) / 86400.0 as gap_days
    from transactions
    where business_id = v_business_id
      and status = 'scanned'
      and customer_id is not null
      and scanned_at >= v_since
  ),
  per_customer as (
    select customer_id, avg(gap_days) as avg_days
    from gaps
    where gap_days is not null
    group by customer_id
  )
  select round(avg(avg_days)::numeric, 1) into v_avg_gap from per_customer;

  return jsonb_build_object(
    'ok',                     true,
    'days',                   v_days,
    'enrolled_customers',     v_enrolled,
    'repeat_visit_rate',      v_repeat_rate,
    'new_vs_returning',       v_series,
    'redemptions_issued',     v_red_issued,
    'redemptions_verified',   v_red_verified,
    'avg_days_between_visits', v_avg_gap  -- null when no customer has 2+ visits
  );
end;
$$;

revoke all on function public.get_owner_analytics(int, uuid) from public;
grant execute on function public.get_owner_analytics(int, uuid)
  to authenticated, service_role;

-- ------------------------------------------------------------
-- get_business_history(): reverse-chronological transactions + redemptions,
-- date-range filterable, paginated. The UNION + ORDER + LIMIT all happen here.
-- ------------------------------------------------------------
create or replace function public.get_business_history(
  p_from               timestamptz default null,
  p_to                 timestamptz default null,
  p_limit              int         default 100,
  p_offset             int         default 0,
  p_staff_auth_user_id uuid        default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid         uuid := coalesce(auth.uid(), p_staff_auth_user_id);
  v_business_id uuid;
  v_role        staff_role;
  v_from        timestamptz := coalesce(p_from, '-infinity'::timestamptz);
  v_to          timestamptz := coalesce(p_to, 'infinity'::timestamptz);
  v_limit       int := greatest(1, least(coalesce(p_limit, 100), 500));
  v_offset      int := greatest(0, coalesce(p_offset, 0));
  v_result      jsonb;
begin
  -- ---- Owner + own-business gate ----
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select business_id, role into v_business_id, v_role
  from staff_users where auth_user_id = v_uid;

  if v_business_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_staff');
  end if;
  if v_role <> 'owner' then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  with events as (
    -- Scanned transactions (scan + manual). Only 'scanned' rows are real events;
    -- pending/expired QRs never happened. customer short code is non-PII.
    select
      t.id                                as event_id,
      t.scanned_at                        as event_time,
      case when t.is_manual then 'manual' else 'scan' end as kind,
      upper(left(t.customer_id::text, 8)) as customer_code,
      su.name                             as staff_name,
      t.manual_reason                     as detail,
      t.amount                            as amount
    from transactions t
    left join staff_users su on su.id = t.created_by_staff_id
    where t.business_id = v_business_id
      and t.status = 'scanned'
      and t.scanned_at is not null
      and t.scanned_at >= v_from
      and t.scanned_at <= v_to

    union all

    -- Redemptions (issued / verified), timed at verification when present else
    -- issue. Staff isn't recorded on redemptions, so staff_name is null.
    select
      r.id                                as event_id,
      coalesce(r.verified_at, r.created_at) as event_time,
      'redemption'                        as kind,
      upper(left(e.customer_id::text, 8)) as customer_code,
      null::text                          as staff_name,
      r.status::text                      as detail,
      null::numeric                       as amount
    from redemptions r
    join enrollments e on e.id = r.enrollment_id
    where e.business_id = v_business_id
      and coalesce(r.verified_at, r.created_at) >= v_from
      and coalesce(r.verified_at, r.created_at) <= v_to
  )
  select jsonb_build_object(
    'ok',     true,
    'total',  (select count(*) from events),
    'limit',  v_limit,
    'offset', v_offset,
    'rows', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.event_time desc)
      from (
        select * from events
        order by event_time desc
        limit v_limit offset v_offset
      ) e
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_business_history(timestamptz, timestamptz, int, int, uuid) from public;
grant execute on function public.get_business_history(timestamptz, timestamptz, int, int, uuid)
  to authenticated, service_role;

comment on function public.get_owner_analytics(int, uuid) is
  'Owner-only. Aggregates the four loyalty money-metrics (repeat visit rate, '
  'new vs returning series, redemptions issued/verified, avg days between visits) '
  'over p_days for the caller''s own business. Returns { ok, ... } or { ok:false, error }.';

comment on function public.get_business_history(timestamptz, timestamptz, int, int, uuid) is
  'Owner-only. Reverse-chronological union of scanned transactions and redemptions '
  'for the caller''s own business, date-range filterable + paginated (all in SQL). '
  'Returns { ok, total, rows:[{event_id,event_time,kind,customer_code,staff_name,detail,amount}] }.';
