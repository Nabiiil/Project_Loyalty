-- ============================================================
-- Realtime: publish transactions changes (staff scan confirmation)
-- ============================================================
-- The staff New-transaction screen subscribes to postgres_changes on
-- transactions to show a live "✓ scanned" confirmation the moment the
-- customer's phone hits /api/scan (which flips status pending -> scanned).
--
-- No new tables/columns and no new policies. Adding the table to the
-- supabase_realtime publication is the only change: Supabase Realtime
-- (postgres_changes) enforces the SUBSCRIBER's row-level SELECT policies, so
-- the existing staff_select_own_business_transactions policy is what scopes
-- the stream — a staff login physically cannot receive another business's
-- transaction events, regardless of what filter their client asks for.
-- (customer_select_own_transactions likewise limits a customer session to its
-- own rows; the anon role has no transactions SELECT grant and receives
-- nothing.)
--
-- Realtime is confirmation only, never a dependency: nothing in the scan or
-- QR-generation path reads from this publication.
--
-- Idempotent (duplicate_object guard) so it is a no-op wherever the table is
-- already published.
-- ============================================================

do $$ begin
  alter publication supabase_realtime add table transactions;
exception when duplicate_object then null;
end $$;
