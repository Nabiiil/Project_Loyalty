-- ============================================================
-- Tests for business identity (logo_url, brand_color, business-logos bucket)
-- Run: psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/business_identity_test.sql
--
-- Self-contained: builds one business, exercises the brand-color format
-- constraint both ways, and asserts the storage bucket exists with the
-- expected public/size/mime configuration. Safe to re-run (cleans up at
-- the end).
-- ============================================================
\set ON_ERROR_STOP on

insert into businesses (id, name, reward_threshold, reward_description)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbc001', 'Identity Cafe', 10, 'Free item');

-- ============================================================
-- TEST 1: valid identity values accepted
-- ============================================================
do $$
declare v_row businesses%rowtype;
begin
  update businesses
  set brand_color = '#a1b2c3',
      logo_url    = 'https://example.supabase.co/storage/v1/object/public/business-logos/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbc001/logo-1.webp'
  where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbc001';

  select * into v_row from businesses where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbc001';
  assert v_row.brand_color = '#a1b2c3' and v_row.logo_url is not null,
    'FAIL TEST 1: valid brand_color/logo_url did not persist';
  raise notice 'PASS TEST 1: valid identity values accepted';
end;
$$;

-- ============================================================
-- TEST 2: malformed brand colors rejected by the check constraint
-- (the app normalizes to lowercase #rrggbb; anything else must die at the DB)
-- ============================================================
do $$
declare v_rejected boolean;
begin
  -- not a hex code at all
  begin
    update businesses set brand_color = 'red'
    where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbc001';
    v_rejected := false;
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'FAIL TEST 2a: ''red'' should violate businesses_brand_color_format';

  -- uppercase hex — valid color, wrong canonical form
  begin
    update businesses set brand_color = '#A1B2C3'
    where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbc001';
    v_rejected := false;
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'FAIL TEST 2b: uppercase hex should violate businesses_brand_color_format';

  -- shorthand #rgb
  begin
    update businesses set brand_color = '#abc'
    where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbc001';
    v_rejected := false;
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'FAIL TEST 2c: shorthand #rgb should violate businesses_brand_color_format';

  raise notice 'PASS TEST 2: malformed brand colors rejected';
end;
$$;

-- ============================================================
-- TEST 3: identity is optional — both columns clear back to null
-- ============================================================
do $$
declare v_row businesses%rowtype;
begin
  update businesses set brand_color = null, logo_url = null
  where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbc001';

  select * into v_row from businesses where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbc001';
  assert v_row.brand_color is null and v_row.logo_url is null,
    'FAIL TEST 3: clearing brand_color/logo_url failed';
  raise notice 'PASS TEST 3: identity columns clear to null';
end;
$$;

-- ============================================================
-- TEST 4: business-logos bucket exists, public, size/mime capped
-- ============================================================
do $$
declare v_bucket record;
begin
  select public, file_size_limit, allowed_mime_types
  into v_bucket
  from storage.buckets where id = 'business-logos';

  if not found then
    raise exception 'FAIL TEST 4: business-logos bucket does not exist';
  end if;

  assert v_bucket.public, 'FAIL TEST 4: bucket must be public (logos are customer-facing)';
  assert v_bucket.file_size_limit = 512000,
    format('FAIL TEST 4: expected 512000 file_size_limit, got %s', v_bucket.file_size_limit);
  assert v_bucket.allowed_mime_types = array['image/webp', 'image/png', 'image/jpeg'],
    format('FAIL TEST 4: unexpected allowed_mime_types %s', v_bucket.allowed_mime_types);
  raise notice 'PASS TEST 4: business-logos bucket configured correctly';
end;
$$;

-- ============================================================
-- Cleanup
-- ============================================================
delete from businesses where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbc001';
