-- Seed data for local development.
-- Applied automatically on: npx supabase db reset
--
-- Gives you a ready-to-use staff account out of the box:
--   URL:      http://localhost:3000/staff/login
--   Email:    staff@demo.com
--   Password: password123

-- ─── Test business ────────────────────────────────────────────────────────────
insert into public.businesses (id, name, contact_email, reward_threshold)
values (
  'a0000000-0000-0000-0000-000000000001',
  'Demo Café',
  'demo@example.com',
  5   -- 5 stamps → free reward
);

-- ─── Staff auth user ──────────────────────────────────────────────────────────
insert into auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  aud,
  role,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values (
  'b0000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'staff@demo.com',
  crypt('password123', gen_salt('bf')),
  now(),
  'authenticated',
  'authenticated',
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now()
);

-- Identity row required by GoTrue for email/password sign-in
insert into auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  provider_id,
  last_sign_in_at,
  created_at,
  updated_at
) values (
  'b0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001',
  '{"sub":"b0000000-0000-0000-0000-000000000001","email":"staff@demo.com","email_verified":true}',
  'email',
  'staff@demo.com',
  now(),
  now(),
  now()
);

-- ─── Link staff user to business ──────────────────────────────────────────────
insert into public.staff_users (business_id, auth_user_id, name)
values (
  'a0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001',
  'Demo Staff'
);
