-- ============================================================
-- customers.display_name — optional name (visibility: see 20260808140000)
-- ============================================================
-- One nullable column, deliberately. A display name has a concrete use: the
-- customer's own dashboard greets them by it instead of by an email address.
-- Nothing else was added — birthday, address, preferences and the rest have no
-- stated use in the product, and a column with no reader is just a liability
-- under GDPR and a migration to undo later.
--
-- ---- VISIBILITY DECISION: SUPERSEDED --------------------------------------
-- This migration originally made display_name customer-facing only. That was
-- REVERSED in 20260808140000_staff_read_display_name.sql, which is now the
-- authority on visibility. In short: a display name is not a contact detail,
-- so the "no customer details to businesses" principle in CLAUDE.md does not
-- cover it, and staff greeting a regular by name is the point of the scan
-- confirmation.
--
-- What holds today:
--   * Staff read the name through get_customer_display_name() and nothing else.
--     That function returns `text`, is scoped by auth.uid() to the caller's own
--     business, and cannot reach email, phone_number, device_token,
--     auth_user_id or claimed_at.
--   * The customers SELECT policy below is UNCHANGED and still own-row-only.
--     Staff have no direct table access to customer rows — that is what keeps
--     contact details business-invisible while the name crosses over.
--   * The customer is told, before typing anything, that businesses will see
--     this name (customerProfile.privacyNote in messages/*.json).
--
-- The write path described below was not affected by the reversal.
-- ============================================================

alter table customers
  add column if not exists display_name text;

comment on column customers.display_name is
  'Optional self-chosen name, shown only to the customer on their own '
  'dashboard. Never exposed to business staff — see the visibility decision in '
  'migration 20260808120000 and customerProfile.privacyNote in messages/*.json.';

-- Empty input is stored as NULL, never as ''. Enforced here so "unset" has
-- exactly one representation in the data rather than depending on every writer
-- remembering to normalise. The trim check keeps padded values out for the same
-- reason, and the cap stops a pasted essay from reaching the dashboard.
alter table customers
  drop constraint if exists customers_display_name_shape;

alter table customers
  add constraint customers_display_name_shape check (
    display_name is null
    or (
      char_length(display_name) between 1 and 60
      and display_name = btrim(display_name)
    )
  );

-- ---- Write access ---------------------------------------------------------
-- The profile form saves through the customer's OWN authenticated session, so
-- these two are the real gate rather than app-level checks:
--
--   * The column grant means `authenticated` can write display_name and
--     nothing else. Even a compromised client cannot rewrite email,
--     phone_number, device_token, claimed_at or auth_user_id through this path.
--   * The policy scopes it to their own row. `using` picks the rows they may
--     touch; `with check` stops the update itself from handing the row to
--     someone else. Anonymous customers have auth_user_id null, and null =
--     auth.uid() is null (not true), so unclaimed rows are unwritable here —
--     which is what keeps a device-token visitor out of the profile form.
grant update (display_name) on customers to authenticated;

drop policy if exists customer_update_own_row on customers;

create policy customer_update_own_row on customers
  for update
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());
