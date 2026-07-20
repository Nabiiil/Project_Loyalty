-- ============================================================
-- Loyalty SaaS - Database Schema
-- ============================================================

create extension if not exists "pgcrypto";

-- ============================================================
-- businesses
-- One row per client business (cafe, restaurant, shop).
-- ============================================================
-- How a business earns stamps. MVP only uses per_transaction (one stamp per
-- purchase); per_amount (spend-based) is modelled but not implemented yet.
create type earning_mode as enum ('per_transaction', 'per_amount');

create table businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_email text,
  contact_phone text,
  reward_threshold int not null default 10, -- stamps needed for a free reward
  earning_mode earning_mode not null default 'per_transaction',
  points_per_unit numeric(10,2),            -- reserved for per_amount; unused in MVP
  reward_description text not null default 'Free item', -- shown to customers
  created_at timestamptz not null default now()
);

-- ============================================================
-- staff_users
-- One row per staff login, scoped to a single business.
-- ============================================================
-- owner: founder-onboarded business owner — edits settings, manages staff
-- logins. staff: counter staff — transactions and reward verification only.
-- Default is the least-privileged role; owner is only ever set explicitly
-- (founder onboarding via service role). One owner per business in the MVP.
create type staff_role as enum ('owner', 'staff');

create table staff_users (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  role staff_role not null default 'staff',
  created_at timestamptz not null default now(),
  unique (auth_user_id)
);

-- ============================================================
-- customers
-- Two ways a customer can come into existence:
--
-- 1. QR-scan-first (zero friction): scanning a transaction QR with
--    no existing account silently creates a customer row with only
--    device_token set. No input from the customer at all. They can
--    keep earning/redeeming stamps anonymously like this indefinitely.
--
-- 2. Direct account creation: the customer (or a business on their
--    behalf) creates an account through the app itself, no scan
--    required. This sets auth_user_id/phone/email immediately via
--    Supabase Auth (magic link or OTP), device_token stays null.
--    They can view their dashboard across businesses right away,
--    even with zero enrollments, and enroll later just by scanning
--    a QR at any participating business like anyone else.
--
-- A customer can also move from path 1 to path 2 later (e.g. at
-- redemption time, when claiming a reward prompts them to add
-- phone/email and set up real login).
-- ============================================================
create type signup_source as enum ('qr_scan', 'direct_signup', 'business_referral');

create table customers (
  id uuid primary key default gen_random_uuid(),
  device_token text unique,      -- anonymous identity, set on first scan, null if signed up directly
  phone_number text,
  email text unique,
  auth_user_id uuid references auth.users(id) on delete set null, -- set once they have real login
  claimed_at timestamptz,        -- when phone/email/login was first established
  signup_source signup_source,   -- qr_scan, direct_signup, or business_referral
  created_at timestamptz not null default now(),
  constraint customers_has_identifier check (
    device_token is not null or phone_number is not null or email is not null
  )
);

create index idx_customers_device_token on customers(device_token);

-- ============================================================
-- enrollments
-- One row per (customer, business) pair. Tracks running stamp count.
-- Created lazily on first scan at that business, regardless of
-- whether the customer is anonymous or logged in.
-- ============================================================
create table enrollments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  current_stamps int not null default 0,
  created_at timestamptz not null default now(),
  unique (customer_id, business_id)
);

-- ============================================================
-- transactions
-- One row per QR code generated at the counter (one purchase event).
-- ============================================================
create type transaction_status as enum ('pending', 'scanned', 'expired');

create table transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null, -- null until scanned
  qr_token text not null unique, -- signed, short-lived token encoded in the QR
  amount numeric(10, 2), -- optional, for future points-based model
  status transaction_status not null default 'pending',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  scanned_at timestamptz
);

create index idx_transactions_business_id on transactions(business_id);
create index idx_transactions_qr_token on transactions(qr_token);

-- ============================================================
-- redemptions
-- One row per reward redemption event.
-- ============================================================
create type redemption_status as enum ('pending', 'verified');

create table redemptions (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references enrollments(id) on delete cascade,
  redemption_code text not null unique,
  status redemption_status not null default 'pending',
  created_at timestamptz not null default now(),
  verified_at timestamptz
);

create index idx_redemptions_enrollment_id on redemptions(enrollment_id);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table businesses enable row level security;
alter table staff_users enable row level security;
alter table customers enable row level security;
alter table enrollments enable row level security;
alter table transactions enable row level security;
alter table redemptions enable row level security;

-- is_business_owner(): does the current auth.uid() hold an owner staff_users
-- row for this business? SECURITY DEFINER because (1) a policy on staff_users
-- cannot subquery staff_users itself (infinite RLS recursion) and (2) it keeps
-- the owner test in one place for every owner-gated object.
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

-- Staff: scoped to their own business only.
create policy staff_select_own_business on businesses
  for select using (
    id in (select business_id from staff_users where auth_user_id = auth.uid())
  );

-- Settings writes are owner-only; counter staff can read but never edit.
create policy owner_update_own_business on businesses
  for update
  using (public.is_business_owner(id))
  with check (public.is_business_owner(id));

create policy staff_select_own_staff_row on staff_users
  for select using (auth_user_id = auth.uid());

-- Owners see every staff row of their own business (staff management list).
-- No write policies and no write grants for authenticated: adding/removing
-- staff happens server-side via the service role only.
create policy owner_select_business_staff on staff_users
  for select using (public.is_business_owner(business_id));

create policy staff_select_own_business_transactions on transactions
  for select using (
    business_id in (select business_id from staff_users where auth_user_id = auth.uid())
  );

create policy staff_insert_own_business_transactions on transactions
  for insert with check (
    business_id in (select business_id from staff_users where auth_user_id = auth.uid())
  );

create policy staff_update_own_business_transactions on transactions
  for update using (
    business_id in (select business_id from staff_users where auth_user_id = auth.uid())
  );

create policy staff_select_own_business_enrollments on enrollments
  for select using (
    business_id in (select business_id from staff_users where auth_user_id = auth.uid())
  );

create policy staff_select_own_business_redemptions on redemptions
  for select using (
    enrollment_id in (
      select id from enrollments
      where business_id in (select business_id from staff_users where auth_user_id = auth.uid())
    )
  );

-- Customers: these policies only protect claimed/logged-in customers
-- (auth.uid() exists). Anonymous customers have no Supabase Auth
-- session, so reads for them must go through a server-side route
-- using the service role key, keyed by device_token.
create policy customer_select_own_row on customers
  for select using (auth_user_id = auth.uid());

create policy customer_select_own_enrollments on enrollments
  for select using (
    customer_id in (select id from customers where auth_user_id = auth.uid())
  );

create policy customer_select_own_transactions on transactions
  for select using (
    customer_id in (select id from customers where auth_user_id = auth.uid())
  );

create policy customer_select_own_redemptions on redemptions
  for select using (
    enrollment_id in (
      select id from enrollments
      where customer_id in (select id from customers where auth_user_id = auth.uid())
    )
  );

-- ============================================================
-- Role privileges
-- RLS policies are a second gate; the role needs base table
-- privileges first. anon/authenticated are Supabase's built-in
-- roles for unauthenticated and authenticated API callers.
-- service_role bypasses RLS and doesn't need explicit grants here.
-- ============================================================
grant usage on schema public to anon, authenticated;

grant select on businesses   to anon, authenticated;
grant update on businesses   to authenticated;  -- owners edit own settings (RLS-scoped to role = owner)
grant select on staff_users  to authenticated;
grant select, insert, update on transactions to authenticated;
grant select on enrollments  to authenticated;
grant select on customers    to authenticated;
grant select on redemptions  to authenticated;

-- service_role is used server-side (Route Handlers, Server Components) to bypass RLS.
-- In Supabase production this role has implicit all-table access, but locally we must
-- grant it explicitly because it has NOINHERIT and no default privileges on our tables.
grant all on businesses   to service_role;
grant all on staff_users  to service_role;
grant all on customers    to service_role;
grant all on enrollments  to service_role;
grant all on transactions to service_role;
grant all on redemptions  to service_role;
