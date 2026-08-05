-- ============================================================
-- Business identity: name is already there — this adds logo + accent color
-- ============================================================
-- Customers see a cross-business list on their dashboard; each card must be
-- recognizable at a glance (name + logo), never a bare UUID. Adds to the
-- (already live) businesses table:
--   * logo_url    — public URL of the processed logo in Supabase Storage
--   * brand_color — optional lowercase hex accent for the customer card
-- and creates the public `business-logos` storage bucket the logos live in.
--
-- Written idempotently (`if not exists` columns + drop/add constraint +
-- upsert on storage.buckets) so it is a no-op on a fresh `db reset` where
-- init_schema.sql already carries the mirrored column definitions, while
-- still applying cleanly to the live database that predates them.
-- ============================================================

alter table businesses
  add column if not exists logo_url text,
  add column if not exists brand_color text;

-- The app normalizes to lowercase #rrggbb before writing; the constraint is
-- the DB-level guarantee no malformed value ever reaches a customer's page.
alter table businesses drop constraint if exists businesses_brand_color_format;
alter table businesses add constraint businesses_brand_color_format
  check (brand_color is null or brand_color ~ '^#[0-9a-f]{6}$');

-- ------------------------------------------------------------
-- Storage bucket for processed logos.
--
-- public = true: logos are shown to every customer of the business, there is
-- nothing to protect — reads go through the public-object endpoint, which
-- does not consult RLS.
--
-- Writes: intentionally NO storage.objects policies for anon/authenticated.
-- The only write path is the owner-gated server route
-- (app/api/business-logo/route.ts) using the service role, which validates
-- file type, re-encodes with sharp, and enforces the size cap before upload.
-- The bucket-level file_size_limit / allowed_mime_types are defense-in-depth
-- should any other service-role code path ever try to upload here.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'business-logos',
  'business-logos',
  true,
  512000, -- ~500 KB; processed logos land far below this
  array['image/webp', 'image/png', 'image/jpeg']
)
on conflict (id) do update
  set public            = excluded.public,
      file_size_limit   = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
