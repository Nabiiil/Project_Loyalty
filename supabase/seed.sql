-- Seed data for local development.
-- Applied automatically on: npx supabase db reset
--
-- After reset, run the setup script to create the staff auth account:
--   node supabase/setup-dev.mjs

-- ─── Test business ────────────────────────────────────────────────────────────
insert into public.businesses (id, name, contact_email, reward_threshold)
values (
  'a0000000-0000-0000-0000-000000000001',
  'Demo Café',
  'demo@example.com',
  5
);
