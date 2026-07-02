-- Seed data for local development.
-- Applied automatically on: npx supabase db reset
--
-- After reset, run the setup script to create the staff auth account:
--   node supabase/setup-dev.mjs

-- ─── QR token signing secret (Vault) ─────────────────────────────────────────
-- Must match QR_TOKEN_SECRET in .env.local.
select vault.create_secret(
  'test-hmac-secret-32-chars-minimum!!',
  'qr_token_secret',
  'HMAC secret for signing QR transaction tokens'
);

-- ─── Test business ────────────────────────────────────────────────────────────
insert into public.businesses (id, name, contact_email, reward_threshold)
values (
  'a0000000-0000-0000-0000-000000000001',
  'Demo Café',
  'demo@example.com',
  5
);
