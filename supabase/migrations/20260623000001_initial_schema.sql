-- =============================================================
-- Migration: initial schema
-- Tables: businesses, staff_users, customers, enrollments,
--         transactions, redemptions
-- =============================================================

-- ── Enum types ───────────────────────────────────────────────

create type transaction_status as enum ('pending', 'scanned', 'expired');
create type redemption_status  as enum ('pending', 'verified');

-- ── businesses ───────────────────────────────────────────────

create table businesses (
  id                uuid        primary key default gen_random_uuid(),
  name              text        not null,
  contact_info      text,
  reward_threshold  int         not null check (reward_threshold > 0),
  created_at        timestamptz not null default now()
);

-- ── staff_users ──────────────────────────────────────────────
-- Each row links a Supabase auth user to a business.
-- Auth credentials live in auth.users; no password stored here.

create table staff_users (
  id           uuid        primary key references auth.users (id) on delete cascade,
  business_id  uuid        not null references businesses (id) on delete cascade,
  name         text        not null,
  created_at   timestamptz not null default now()
);

create index staff_users_business_id_idx on staff_users (business_id);

-- ── customers ────────────────────────────────────────────────
-- Identified by phone number via Supabase phone-OTP auth.

create table customers (
  id            uuid        primary key references auth.users (id) on delete cascade,
  phone_number  text        not null unique,
  created_at    timestamptz not null default now()
);

-- ── enrollments ──────────────────────────────────────────────
-- One row per customer-business pair; tracks current stamps.

create table enrollments (
  id              uuid        primary key default gen_random_uuid(),
  customer_id     uuid        not null references customers (id) on delete cascade,
  business_id     uuid        not null references businesses (id) on delete cascade,
  current_stamps  int         not null default 0 check (current_stamps >= 0),
  created_at      timestamptz not null default now(),
  unique (customer_id, business_id)
);

create index enrollments_customer_id_idx on enrollments (customer_id);
create index enrollments_business_id_idx on enrollments (business_id);

-- ── transactions ─────────────────────────────────────────────
-- Created when staff generates a QR; customer_id filled on scan.

create table transactions (
  id           uuid                primary key default gen_random_uuid(),
  business_id  uuid                not null references businesses (id) on delete cascade,
  customer_id  uuid                references customers (id) on delete set null,
  qr_token     text                not null unique,
  amount       numeric(10, 2),
  status       transaction_status  not null default 'pending',
  created_at   timestamptz         not null default now()
);

create index transactions_business_id_idx on transactions (business_id);
create index transactions_customer_id_idx on transactions (customer_id);
create index transactions_qr_token_idx    on transactions (qr_token);

-- ── redemptions ──────────────────────────────────────────────

create table redemptions (
  id               uuid               primary key default gen_random_uuid(),
  enrollment_id    uuid               not null references enrollments (id) on delete cascade,
  redemption_code  text               not null unique,
  status           redemption_status  not null default 'pending',
  created_at       timestamptz        not null default now(),
  verified_at      timestamptz
);

create index redemptions_enrollment_id_idx on redemptions (enrollment_id);

-- =============================================================
-- Row-Level Security
-- =============================================================

alter table businesses   enable row level security;
alter table staff_users  enable row level security;
alter table customers    enable row level security;
alter table enrollments  enable row level security;
alter table transactions enable row level security;
alter table redemptions  enable row level security;

-- ── Helper: is the calling auth user a staff member of a business? ──

create or replace function is_staff_of(business uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from staff_users
    where id = auth.uid() and business_id = business
  );
$$;

-- ── businesses: readable by staff of that business ───────────

create policy "staff can read own business"
  on businesses for select
  using (is_staff_of(id));

-- ── staff_users: staff can read colleagues in same business ──

create policy "staff can read own business staff"
  on staff_users for select
  using (is_staff_of(business_id));

-- ── customers: customers read/update their own row ───────────

create policy "customer reads own row"
  on customers for select
  using (id = auth.uid());

create policy "customer inserts own row"
  on customers for insert
  with check (id = auth.uid());

-- Staff need to read customers for their business (via enrollments/transactions).
-- Using a join-based policy keeps it tight.
create policy "staff can read customers in their business"
  on customers for select
  using (
    exists (
      select 1 from enrollments e
      where e.customer_id = customers.id
        and is_staff_of(e.business_id)
    )
  );

-- ── enrollments: customer or staff of that business ──────────

create policy "customer reads own enrollments"
  on enrollments for select
  using (customer_id = auth.uid());

create policy "staff reads business enrollments"
  on enrollments for select
  using (is_staff_of(business_id));

create policy "system inserts enrollment"
  on enrollments for insert
  with check (customer_id = auth.uid());

-- ── transactions: staff of that business ─────────────────────

create policy "staff manages transactions"
  on transactions for all
  using (is_staff_of(business_id))
  with check (is_staff_of(business_id));

-- Allow anonymous insert so the scan endpoint can claim a transaction
-- before the customer is authenticated (customer_id filled server-side).
create policy "anon can update pending transaction on scan"
  on transactions for update
  using (status = 'pending');

-- ── redemptions: staff of the business via enrollment ────────

create policy "staff manages redemptions"
  on redemptions for all
  using (
    exists (
      select 1 from enrollments e
      where e.id = redemptions.enrollment_id
        and is_staff_of(e.business_id)
    )
  )
  with check (
    exists (
      select 1 from enrollments e
      where e.id = redemptions.enrollment_id
        and is_staff_of(e.business_id)
    )
  );

create policy "customer reads own redemptions"
  on redemptions for select
  using (
    exists (
      select 1 from enrollments e
      where e.id = redemptions.enrollment_id
        and e.customer_id = auth.uid()
    )
  );
