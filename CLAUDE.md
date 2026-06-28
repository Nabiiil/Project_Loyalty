# CLAUDE.md

This file gives Claude Code the context it needs to work on this project. Read it fully before making changes.

## Project overview

A SaaS platform that centralizes loyalty programs for small businesses (cafes, restaurants, shops). Customers join a business's loyalty program by scanning a QR code generated at the time of purchase, no app download, no signup form, no separate account per business.

The core insight: customers hate friction. Identity is based on an anonymous device token (not a phone number upfront), recognized everywhere, stamps/points tracked per business but viewable in one place. Contact info is only collected later, at the moment it benefits the customer to share it.

## MVP scope (lock this, resist scope creep)

Building a stamp-card model first (buy N, get 1 free), not a full points/currency system. Faster to build, easier for business owners to understand and pitch.

In scope for MVP:
- Business account + staff login (manual onboarding by founder for now, no self-serve signup yet)
- Staff dashboard: generate a QR code per transaction
- Customer flow: scan QR -> mobile web page -> silent device token generated, no input required -> stamp recorded
- Returning customers recognized automatically via that same device token, every visit, no input at all
- Customer view: stamps/points across all enrolled businesses in one place
- Reward redemption: threshold reached -> redemption code -> staff verifies and resets counter -> AT this point (and only this point), the business asks for phone and/or email. Unlike before, this now also creates a real, recoverable login (Supabase Auth magic link or phone OTP) so the customer can check their points dashboard from any device going forward, not just the device that earned them.
- Customer-facing web app: a login-gated dashboard (web-based for now, native later) showing points/stamps across all enrolled businesses. Anonymous (unclaimed) customers can still view their own balance without logging in, scoped purely by device token. Claimed customers can additionally log in from any device via phone/email.
- **Second entry point: direct signup.** A customer can create a claimed account from day one via a public signup page in the app itself, reachable through ads, a business-shared link, or just knowing about the app, no QR scan required first. This account has `auth_user_id`/`phone`/`email` set immediately, skipping the anonymous device-token stage entirely. It starts with zero enrollments; those get created lazily the first time they scan a transaction QR at any participating business, same as anyone else.
- **Identity resolution on every scan**, in priority order: (1) is there an active Supabase Auth session? If so, attribute the stamp to that logged-in customer via `auth_user_id`, regardless of any device_token cookie present. (2) Else, is there a device_token cookie? Use/create the anonymous customer tied to it. (3) Else, this is a brand-new anonymous customer, issue a fresh device_token. This ordering is critical: a logged-in customer's stamps must never get scattered into a separate anonymous identity just because they're scanning from a browser that also happens to carry an old device_token cookie.
- Basic business analytics: enrolled customers, redemptions, repeat visit rate

Explicitly out of scope until v2: multi-location chains, push/WhatsApp notifications, POS integrations, NFC, white-labeling, marketing/segmentation tools, self-serve business signup, payment billing automation.

If a task seems to require something in the "out of scope" list, stop and flag it rather than building it.

## Tech stack

- **Framework**: Next.js (App Router, TypeScript) — single repo for the customer-facing scan/dashboard pages and the business dashboard.
- **Database + Auth**: Supabase (Postgres), using built-in row-level security. Anonymous customers are NOT in Supabase Auth, they're identified purely by device_token. Once a customer claims their account (provides phone/email at redemption), a real Supabase Auth identity (magic link for email, or OTP for phone) is created and linked via `customers.auth_user_id`, this is what powers cross-device login afterward. Staff_users always go through real Supabase Auth (email/password).
- **Hosting**: Vercel (app), Supabase Cloud (DB).
- **QR generation**: `qrcode` npm package. Each QR encodes a short-lived signed token (JWT or HMAC) containing `{business_id, transaction_value, timestamp, expiry}`.
- **Device token**: a long-lived, signed random token (JWT or UUID + HMAC) set as a cookie (readable client-side, since it's not a security credential, just an anonymous identity pointer) on first scan. This token is the customer's primary key until they claim their account.
- **Contact capture + claim flow (redemption-time only)**: a form shown after a reward threshold is hit, collecting phone and/or email. Submitting this form both fills in `customers.phone_number`/`email` AND triggers Supabase Auth to send a magic link (email) or OTP (phone) so the customer can set up real login on the spot. Anonymous reads (pre-claim) go through a server-side route using the service role key, keyed by device_token as a bearer-style identifier, since RLS can't apply without an `auth.uid()`.

Do not introduce additional infrastructure (Redis, separate microservices, additional cloud providers) without discussing it first. The goal is one deployable app, kept simple.

## Data model

Canonical reference: `supabase/migrations/20260625235806_init_schema.sql` — this is the single source of truth for the actual schema (tables, types, indexes, RLS policies). The filename follows Supabase migration naming convention (timestamp prefix). The summary below is just for quick orientation, if it ever drifts from that file, the SQL file wins.

Core tables:
- `businesses` (id, name, contact info, reward_threshold, created_at)
- `staff_users` (id, business_id, name, login credentials)
- `customers` (id, device_token UNIQUE nullable, phone_number nullable, email UNIQUE nullable, auth_user_id nullable FK to auth.users, claimed_at nullable, signup_source nullable enum, created_at) — two entry points populate this differently: a QR-scan-first customer starts with only device_token set, everything else fills in later at redemption; a direct-signup customer has auth_user_id/phone/email/claimed_at set immediately and device_token stays null
- `enrollments` (id, customer_id, business_id, current_stamps, created_at) — one row per customer-business pair
- `transactions` (id, business_id, customer_id nullable until scanned, qr_token, amount, status: pending/scanned/expired, created_at)
- `redemptions` (id, enrollment_id, redemption_code, status: pending/verified, created_at, verified_at)

Keep schema changes as deliberate, reviewed edits to `supabase/migrations/20260625235806_init_schema.sql`, not silent drift between that file and the live database.

## What we are deliberately NOT solving in the MVP

- **No identity verification before claiming.** Device tokens are unverified. A customer who clears browser storage or switches devices before claiming their account loses their stamp history with no recovery path, this is accepted, not a bug.
- **Claiming is opt-in, not forced.** A customer can keep redeeming rewards anonymously by device token alone if they decline to share contact info; the claim/login flow is an incentive-driven upsell at redemption time, never a gate on basic use.
- **No fraud-proofing beyond QR single-use/expiry.** Someone could theoretically enroll twice at the same business from two devices before claiming. For a free-coffee-tier reward this is low-stakes and intentionally not engineered against in v1.

## QR token security rules (important, do not skip)

- Every QR token must be signed (HMAC/JWT) and include an expiry (suggest 10-15 minutes).
- A token must be single-use: once scanned and recorded, mark the transaction as `scanned` so a screenshot or reused QR cannot be scanned twice.
- Validate `business_id` and `expiry` server-side on every scan, never trust client input alone.
- Redemption codes follow the same single-use rule.

## Staff dashboard delivery: PWA, not native

The staff-facing dashboard must be a Progressive Web App (PWA), not a native iOS/Android app. This is a deliberate decision, do not propose native apps for the MVP.

Why: on-premise tablets at target businesses (cafes, small restaurants, shops) are a mix of Android tablets, iPads, and occasionally old Windows touchscreens. A PWA runs in any of these browsers with zero install friction, the founder opens the dashboard URL once during onboarding and adds it to the home screen, no app store, no separate codebases, no update delays.

Requirements for the PWA:
- Add a `manifest.json` (app name, icons, theme color, `display: standalone` so it opens without browser chrome after being added to the home screen).
- Add a basic service worker for offline tolerance, the dashboard should not fully break if the business wifi drops mid-shift. At minimum, cache the app shell and gracefully queue/retry QR generation if the network call fails.
- Keep the UI lightweight: large tap targets, minimal JS, fast load. Assume the tablet is old, possibly cracked, and on mediocre wifi. Do not assume good hardware.
- Test on actual Android Chrome and iPad Safari "Add to Home Screen" flows before considering this done, the two browsers handle PWA install slightly differently.
- Do not build native apps, submit to app stores, or introduce React Native/Flutter for this. The web app is the product here.

## Conventions

- TypeScript strict mode on.
- Mobile-first for the customer-facing scan page; assume the customer is on a phone camera, on the business's wifi or mobile data, possibly in poor light/rushed (cafe counter context). Keep that page extremely fast and minimal.
- Business dashboard can be a normal responsive web app, used by staff on a tablet or laptop at the counter.
- Prefer Supabase's built-in auth and RLS over hand-rolled auth logic.
- Write tests for anything touching the points/stamp engine and QR token validation. These are the two areas where bugs directly cost the business money or break trust.
- Keep commits scoped and descriptive; this is a small team, commit history is the project memory.

## Team context

- Founder (Nabil): product decisions, pitch/business side, QA, final say on scope.
- Dev 1: backend — schema, QR token logic, points/stamp engine, OTP integration.
- Dev 2: frontend — customer scan page, business dashboard UI.
- 3rd team member (if staffed): QA/DevOps, fraud edge cases, CI.

When picking up a task, check which of these areas it falls under and stay within that lane unless asked to cross over.

## Current milestone

Week-by-week plan (6-8 weeks total):
1. Scope lock, wireframes, schema design, repo/Supabase/Vercel setup.
2. Backend core: accounts, QR token gen/validation, transaction recording, stamp engine.
3. Customer flow: device-token generation, scan landing page, multi-business balance view, redemption-time contact capture form (parallel with backend).
4. Business dashboard: QR generation UI, redemption verification, basic analytics.
5. Fraud edge cases: QR expiry, one-time use, device-token tampering checks. UI polish. End-to-end testing.
6. Pilot with 1-2 real businesses, fix what breaks under real use.
7. Buffer week: incorporate pilot feedback, prep onboarding flow for next cohort.

Always check with the founder before marking a milestone area "done" — pilot feedback may reshape earlier work.

## What Claude Code should NOT do without asking

- Do not add new third-party services or paid infrastructure.
- Do not change the core data model in a way that breaks `supabase/migrations/20260625235806_init_schema.sql` without flagging it first.
- Do not expand MVP scope (see explicitly out-of-scope list above) even if it seems like a small addition.
- Do not commit secrets, API keys, or `.env` files.
