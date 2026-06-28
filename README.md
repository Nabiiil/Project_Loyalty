# Project Loyalty

A SaaS loyalty platform for small businesses (cafés, restaurants, shops). Customers earn stamps by scanning a QR code at the counter — no app download, no account required. Staff generate QR codes from a dashboard. Stamps are tracked per business and viewable in one place.

## Repo structure

```
Project_Loyalty/
├── project_loyalty/   # Next.js app (customer + staff UI)
└── supabase/          # Local Supabase config, migrations, seed data
```

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) — must be running before starting Supabase
- Supabase CLI — no global install needed, use `npx supabase`

## Local setup

### 1. Clone and install dependencies

```bash
git clone <repo-url>
cd Project_Loyalty/project_loyalty
npm install
```

### 2. Start the local Supabase stack

Run from the **repo root** (the folder that contains `supabase/`):

```bash
cd ..   # back to Project_Loyalty/
npx supabase start
```

This starts Postgres, Auth, Storage, and Studio inside Docker and applies the migration automatically. First run downloads the images — takes about a minute.

### 3. Seed the database

```bash
npx supabase db reset
```

This wipes the local DB, re-applies the migration, then runs `supabase/seed.sql`, which creates:
- A test business: **Demo Café** (5-stamp reward)
- A test staff account: **staff@demo.com / password123**

> Run this any time you want a clean slate.

### 4. Configure environment variables

```bash
cd project_loyalty
cp .env.local.example .env.local
```

The example file already has the correct local Supabase keys and a working `QR_TOKEN_SECRET`. No edits needed to get started.

### 5. Start the app

```bash
npm run dev
```

The app is now running at [http://localhost:3000](http://localhost:3000).

---

## Testing the staff flow

1. Go to [http://localhost:3000/staff/login](http://localhost:3000/staff/login)
2. Sign in with `staff@demo.com` / `password123`
3. Enter an optional amount and click **Generate QR code**
4. Click the scan link below the QR code (dev-only shortcut) — or scan it from a phone on the same network (see cross-device section below)
5. The customer lands on the scan page, a stamp is recorded, and they're redirected to their dashboard

## Testing the customer flow

- **Anonymous:** scan a QR link directly — a device token is issued silently, stamps accumulate
- **Sign up:** go to [http://localhost:3000/signup](http://localhost:3000/signup), enter an email, verify the 6-digit code from [Inbucket](http://localhost:54324) (the local email catcher)
- **Sign in:** go to [http://localhost:3000/login](http://localhost:3000/login)
- **Dashboard:** [http://localhost:3000/dashboard](http://localhost:3000/dashboard)

Stamps earned anonymously before signing up are automatically merged into the account on first login.

---

## Cross-device QR testing (scanning from a phone)

By default the QR scan link points to `localhost`, which only works in the same browser. To scan from a phone on the same Wi-Fi network:

1. Find your machine's LAN IP (e.g. `192.168.x.x`)
2. Add it to `.env.local`:
   ```
   NEXT_PUBLIC_APP_URL=http://192.168.x.x:3000
   ```
3. Restart the dev server

The QR code will now encode your LAN IP so a phone camera can reach it.

---

## Useful URLs (local)

| Service | URL |
|---|---|
| App | http://localhost:3000 |
| Staff login | http://localhost:3000/staff/login |
| Customer dashboard | http://localhost:3000/dashboard |
| Supabase Studio | http://localhost:54323 |
| Inbucket (email catcher) | http://localhost:54324 |

## Common commands

```bash
# Stop Supabase containers (preserves data)
npx supabase stop

# Full reset — wipes DB and re-seeds
npx supabase db reset

# Run tests
cd project_loyalty && npm test
```
