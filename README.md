# 🐦 Early Bird

**On-site home diagnostics, troubleshooting, and repair** — a marketing site + intake
app that triages a customer's request (LLM-primary, heuristic fallback) and books a
technician into a real availability slot.

Services covered by a skilled, generally non-licensed technician: **plumbing,
electrical, appliances, HVAC & air quality, basic home repair, and internet /
connectivity**. Anything requiring a licensed pro (gas, service panels, refrigerant,
main lines, structural) is flagged up front.

> "The early fix beats the big repair."

---

## What's here

| Area | Path |
| --- | --- |
| Marketing landing page | `app/page.tsx` |
| Multi-step intake → triage → scheduling | `app/intake/page.tsx` |
| Ops dashboard (triage feedback loop) | `app/admin/page.tsx` |
| Admin auth (signed-cookie login) | `lib/auth.ts`, `middleware.ts`, `app/admin/login` |
| Email (confirmations + ops notify) | `lib/notify/*` |
| API routes | `app/api/*` |
| Triage engine (heuristic + LLM + feedback loop) | `lib/triage/*` |
| Scheduling / availability | `lib/scheduling/availability.ts` |
| Storage abstraction (JSON now, Postgres-swappable) | `lib/store/*` |
| Heuristic rules (data-driven, iterable) | `data/heuristic-config.seed.json` |
| Slot templates | `data/slots.seed.json` |

## Quick start

```bash
npm install
cp .env.example .env.local   # optional: add ANTHROPIC_API_KEY for LLM triage
npm run dev                  # http://localhost:3000
```

Build / verify:

```bash
npm run typecheck
npm run build
npm start
```

With no `ANTHROPIC_API_KEY`, everything still works — triage falls back to the
rule-based heuristic.

---

## Running the three sides locally

All three run in the same app. Set a couple of env vars in `.env.local`, start the
server, and open each surface:

```bash
# .env.local (minimum to exercise all three sides locally)
ADMIN_PASSWORD=change-me-admin      # unlocks the admin side
TECH_PASSCODE=change-me-invite      # invite code to create technician accounts
# optional: ANTHROPIC_API_KEY, RESEND_API_KEY, TWILIO_*, GEOCODER, STRIPE_* …
npm run dev
```

| Side | URL | How to use |
| --- | --- | --- |
| **Client** | `/` and `/intake` | Describe an issue → triage → pick a slot → book. No auth. |
| **Technician** | `/tech` | First visit `/tech/register`, enter the `TECH_PASSCODE` invite code + your details. Then go on duty (allow location), work the queue, claim a job, commit an ETA, record a charge. Password reset at `/tech/forgot`. |
| **Admin** | `/admin` and `/admin/dispatch` | Sign in with `ADMIN_PASSWORD`. Dashboard shows submissions + the triage feedback loop; **Dispatch board** shows the live queue, technicians (on-duty/location/assignments), and the map. |

In dev, emails and SMS print to the **server console** unless `RESEND_API_KEY` /
`TWILIO_*` are set — including the technician password-reset link.

## Testing

```bash
npm test         # unit + integration + API-handler tests (fast, hermetic)
npm run test:e2e # end-to-end HTTP flow (builds first via test:all, or run `npm run build`)
npm run test:all # test → build → e2e (what CI runs)
npm run test:watch
```

Tests are **hermetic** — no network or API keys required. Geocoding is disabled and the
breach-password check degrades gracefully, so the suite is deterministic offline. Each
test runs against an isolated JSON data dir (`.test-data` / `.e2e-data`).

Coverage spans all three sides:

- **Client** — intake validation + `POST /api/intake` (creates a queued job), triage
  heuristic (classification, urgency, safety/scope flags), slot generation & booking.
- **Technician** — password hashing (scrypt) + policy, account register/login, the
  OWASP reset flow (single-use token, old password invalidated), atomic **claim (only
  one wins)**, ETA + customer notification, billing (manual provider).
- **Admin** — dispatch aggregation (queue + technicians + presence), session tokens,
  rate limiting, and CSRF/same-origin checks.
- **End-to-end** (`tests/e2e`) spawns the built server and runs the whole cross-side
  path over HTTP with real cookies/middleware: register → intake → queue → claim →
  409 on a second claim → ETA → charge → heartbeat → admin board → auth 401 → CSRF 403
  → password reset.

CI (`.github/workflows/ci.yml`) runs type-check → build → `npm test` → `npm run test:e2e`
on every push and PR.

---

## How triage works (LLM-primary, self-improving heuristic)

Every intake runs through **two** engines:

1. **Heuristic** (`lib/triage/heuristic.ts`) — a deterministic, data-driven
   classifier. It scores the request against keyword weights per category, derives
   urgency from urgency rules, and flags out-of-scope / safety terms. It always runs.
2. **Claude** (`lib/triage/llm.ts`) — when `ANTHROPIC_API_KEY` is set, Claude is the
   **primary** engine. It classifies, gauges urgency, decides non-licensed scope,
   returns safe troubleshooting steps, **and critiques the heuristic**, proposing
   concrete config changes (new keywords, weight tweaks, urgency/scope rules).

The orchestrator (`lib/triage/index.ts`) surfaces the LLM result to the customer,
records a **comparison** of the two, and stores any proposed heuristic changes.

### The feedback loop (this is the "iterate the heuristic" part)

- Each triage writes a `FeedbackRecord` capturing heuristic vs. LLM agreement and the
  LLM's proposed config changes.
- The **admin dashboard** (`/admin`) shows agreement rates and a queue of **pending
  proposals** — changes the LLM keeps suggesting that aren't yet reflected in the
  rules. "Pending" is derived from data (a proposal is pending if applying it would
  actually change the config), so there's no separate applied-state to maintain.
- Clicking **Apply** (or `POST /api/heuristic`) folds proposals into
  `heuristic-config.live.json` and **bumps the config version**. No code changes — the
  heuristic's behavior is entirely its data.
- Optional **auto-apply**: set `HEURISTIC_AUTO_APPLY=true`; a proposal the LLM repeats
  `AUTO_APPLY_THRESHOLD` times is applied automatically.

So the heuristic measurably converges toward the LLM's judgement over time, and keeps
working (for free, offline) as the fast path / fallback.

---

## Scheduling

`data/slots.seed.json` defines window templates (label, hours, capacity, served
weekdays, horizon). The availability engine expands these into concrete dated slots.
Booking reserves capacity **atomically** in both storage drivers, so a slot can never
be booked past its capacity (no double-booking). Regenerating the schedule preserves
existing bookings.

---

## Storage — "flip of a switch"

All persistence goes through one interface (`lib/store/types.ts`). The active driver
is chosen by a single env var; **no app code imports a concrete driver**.

```bash
STORE_DRIVER=json       # default — local JSON files under ./data (dev / MVP)
STORE_DRIVER=postgres   # hosted Postgres (Vercel Postgres / Neon / Supabase)
```

To migrate to Postgres:

1. `npm install pg`
2. Set `STORE_DRIVER=postgres` and `DATABASE_URL=postgres://…`
3. Deploy. `init()` creates the tables and seeds the heuristic config on first run.

The Postgres driver (`lib/store/postgresStore.ts`) implements the exact same contract
as the JSON driver, including atomic slot reservation via a conditional `UPDATE`. `pg`
is imported lazily, so it isn't required in JSON mode.

---

## API

| Method & path | Purpose |
| --- | --- |
| `POST /api/intake` | Submit intake, triage it, return submission + availability |
| `GET /api/availability` | Current open slots |
| `POST /api/book` | Reserve a slot for a submission (atomic) |
| `GET /api/submissions` | Recent submissions (admin) |
| `GET /api/feedback` | Feedback records + agreement stats |
| `GET /api/heuristic` | Current config + pending proposals |
| `POST /api/heuristic` | Apply pending (or specific) proposals; bumps version |
| `POST /api/admin/login` | Exchange admin password for a session cookie |
| `POST /api/admin/logout` | Clear the admin session |

The admin page and the `submissions` / `feedback` / `heuristic` APIs are gated;
the customer-facing `intake` / `availability` / `book` APIs are public.

---

## Admin authentication

`/admin` and the admin APIs are protected by `middleware.ts`. Sign-in exchanges a
shared `ADMIN_PASSWORD` for an HMAC-signed, HTTP-only session cookie (8-hour TTL);
the signing runs on the Web Crypto API so the same verification works in Edge
middleware and Node route handlers.

- **No `ADMIN_PASSWORD` set:** open in development (so the dashboard works out of the
  box), locked in production (redirects to a setup notice). **Set it before deploying.**
- Optionally set `ADMIN_SESSION_SECRET` to sign sessions independently of the password.
- This is a single-operator scheme; swap in a real identity provider for multi-user.

## Email

Booking confirmations go to the customer and an optional ops notification goes to
`EMAIL_OPS`, via `lib/notify`. With `RESEND_API_KEY` set they send through Resend
(direct HTTP, no SDK dependency); without it they're logged to the server console so
the flow works in dev. Email failures are caught and never fail a booking — the slot
is already reserved and the customer sees an on-screen confirmation. Swapping
providers (SendGrid/Postmark/SES/SMTP) is a single branch in `lib/notify/email.ts`.

---

## Technician dispatch (`/tech`)

A mobile-first technician app (shares the same API; a native app can consume the same
routes later). Requires `TECH_PASSCODE` — the **invite code** for creating accounts.

- **Accounts + reset** (`lib/tech-auth.ts`, `lib/auth/*`): per-technician accounts,
  gated at sign-up by the invite code. Passwords are **scrypt**-hashed and screened
  against known-breached passwords (local list + HIBP k-anonymity); policy follows
  **NIST 800-63B** (length-first, no composition rules). **Forgot-password** follows
  the **OWASP** guidance: single-use, hashed, time-limited (30 min) tokens emailed out
  of band; no account-existence disclosure. Sessions are **bound to the tech id** in
  the signed cookie, so a caller can only ever act as themselves.
- **Live queue**: every submission enters the queue. Technicians sort by **recency**,
  **client-reported urgency**, or **proximity** (browser geolocation + geocoded job
  addresses, haversine). Contact PII is withheld until a job is claimed.
- **Claim-to-lock**: `claimJob` is atomic in both store drivers (a conditional update
  guarded on `dispatchStatus = 'queued'`), so two technicians can never claim the same
  job — the loser gets a 409 and the queue updates live for everyone (polling).
- **Committed ETA** in 30-minute increments → the customer is notified a technician is
  assigned, by **email** and (if they opted in) **SMS**.
- **Billing** (`lib/payments/*`): technicians record charges against a job through a
  provider abstraction — **manual ledger** by default, **Stripe**-ready by setting
  `PAYMENTS_PROVIDER=stripe` (+ `npm i stripe`, `STRIPE_SECRET_KEY`).
- **Presence**: on-duty technicians heartbeat their status + location, feeding the
  admin board.

## Admin dispatch board (`/admin/dispatch`)

The owner's live operational picture: all queued jobs (full detail), every technician
with on-duty status / last-seen / location and current assignments, and a **map** of
technician (and geocoded job) locations. The map is a self-contained SVG plot — swap in
Leaflet/Mapbox for a street basemap; the data is already lat/lng.

## Portal security

Both staff portals are hardened (`lib/security.ts`, `middleware.ts`, `next.config.js`):
rate-limited logins with exponential backoff, same-origin (CSRF) checks on every
state-changing request, `SameSite=Strict` HTTP-only session cookies, `no-store` on
authenticated responses, and security headers (`X-Frame-Options`, `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy`, HSTS in production).

---

## Environment variables

See `.env.example`. Key ones: `ANTHROPIC_API_KEY`, `TRIAGE_MODEL` (default
`claude-sonnet-5`), `STORE_DRIVER`, `DATABASE_URL`; technician portal
`TECH_PASSCODE`/`TECH_SESSION_SECRET`; `GEOCODER`; SMS `TWILIO_*`; billing
`PAYMENTS_PROVIDER`/`STRIPE_SECRET_KEY`; email `RESEND_API_KEY`/`EMAIL_FROM`/`EMAIL_OPS`.

## Deploying to Vercel

The app is a standard Next.js App Router project and deploys to Vercel as-is. For
production, switch `STORE_DRIVER=postgres` (the JSON driver relies on a writable local
filesystem, which is ephemeral on serverless).

## Notes / next steps

- Email + opt-in SMS are wired (Resend / Twilio, each with a console fallback).
- A native mobile **app** can consume the same `/api/*` routes; the domain types in
  `lib/types.ts` are the shared contract.
- The live queue and dispatch board update via polling; swap to SSE/WebSockets for
  instant push if desired.
- The rate limiter is per-process (fine for one instance); back it with Redis for a
  multi-instance deployment. `PAYMENTS_PROVIDER=stripe` and a Stripe key light up
  real charges; the dispatch map can take a Leaflet/Mapbox basemap.
- The customer slot-booking and the on-demand dispatch queue currently coexist — a
  future pass could converge them (urgent jobs → dispatch, scheduled → slots).
