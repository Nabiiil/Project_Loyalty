# CLAUDE.md

This file gives Claude Code the context it needs to work on this project. Read it fully before making changes.

## Project overview

A SaaS platform that centralizes loyalty programs for small businesses (cafes, restaurants, shops). Customers join a business's loyalty program by scanning a QR code generated at the time of purchase, no app download, no signup form, no separate account per business.

The core insight: customers hate friction. One phone-number-based identity, recognized everywhere, stamps/points tracked per business but viewable in one place.

## MVP scope (lock this, resist scope creep)

Building a stamp-card model first (buy N, get 1 free), not a full points/currency system. Faster to build, easier for business owners to understand and pitch.

In scope for MVP:
- Business account + staff login (manual onboarding by founder for now, no self-serve signup yet)
- Staff dashboard: generate a QR code per transaction
- Customer flow: scan QR -> mobile web page -> phone number + SMS OTP (first time only) -> stamp recorded
- Returning customers recognized via device/session token, no repeat OTP
- Customer view: stamps/points across all enrolled businesses in one place
- Reward redemption: threshold reached -> redemption code -> staff verifies and resets counter
- Basic business analytics: enrolled customers, redemptions, repeat visit rate

Explicitly out of scope until v2: multi-location chains, push/WhatsApp notifications, POS integrations, NFC, white-labeling, marketing/segmentation tools, self-serve business signup, payment billing automation.

If a task seems to require something in the "out of scope" list, stop and flag it rather than building it.

## Tech stack

- **Framework**: Next.js (App Router, TypeScript) — single repo for both the customer-facing scan page and the business dashboard.
- **Database + Auth**: Supabase (Postgres), using built-in row-level security and phone-OTP auth.
- **Hosting**: Vercel (app), Supabase Cloud (DB).
- **QR generation**: `qrcode` npm package. Each QR encodes a short-lived signed token (JWT or HMAC) containing `{business_id, transaction_value, timestamp, expiry}`.
- **SMS OTP**: Twilio (or local Morocco-compatible alternative, confirm pricing/coverage before committing in code).

Do not introduce additional infrastructure (Redis, separate microservices, additional cloud providers) without discussing it first. The goal is one deployable app, kept simple.

## Data model (starting point, expect migrations as we go)

Core tables:
- `businesses` (id, name, contact info, reward_threshold, created_at)
- `staff_users` (id, business_id, name, login credentials)
- `customers` (id, phone_number, created_at)
- `enrollments` (id, customer_id, business_id, current_stamps, created_at) — one row per customer-business pair
- `transactions` (id, business_id, customer_id nullable until scanned, qr_token, amount, status: pending/scanned/expired, created_at)
- `redemptions` (id, enrollment_id, redemption_code, status: pending/verified, created_at, verified_at)

Adjust this as the real schema evolves, but keep changes as explicit migrations, not silent edits.

## QR token security rules (important, do not skip)

- Every QR token must be signed (HMAC/JWT) and include an expiry (suggest 10-15 minutes).
- A token must be single-use: once scanned and recorded, mark the transaction as `scanned` so a screenshot or reused QR cannot be scanned twice.
- Validate `business_id` and `expiry` server-side on every scan, never trust client input alone.
- Redemption codes follow the same single-use rule.

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
3. Customer flow: OTP signup/login, scan landing page, multi-business balance view (parallel with backend).
4. Business dashboard: QR generation UI, redemption verification, basic analytics.
5. Fraud edge cases: QR expiry, one-time use, OTP rate limiting. UI polish. End-to-end testing.
6. Pilot with 1-2 real businesses, fix what breaks under real use.
7. Buffer week: incorporate pilot feedback, prep onboarding flow for next cohort.

Always check with the founder before marking a milestone area "done" — pilot feedback may reshape earlier work.

## What Claude Code should NOT do without asking

- Do not add new third-party services or paid infrastructure.
- Do not change the core data model in a way that breaks existing migrations without flagging it.
- Do not expand MVP scope (see explicitly out-of-scope list above) even if it seems like a small addition.
- Do not commit secrets, API keys, or `.env` files.
