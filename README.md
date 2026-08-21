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
| Multi-step intake → triage → scheduling → payment | `app/intake/page.tsx` |
| Customer arrival tracker ("Where's my tech?") | `app/track/[id]/page.tsx`, `components/TechTracker.tsx`, `lib/tracking.ts` |
| Issue catalog (category → item → symptom) | `lib/services.ts` |
| Room / floor / photo capture | `lib/rooms.ts`, `lib/photoUpload.ts` |
| Visit-fee pricing + checkout | `lib/pricing.ts`, `lib/checkout.ts`, `lib/card.ts` |
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

## Intake — what we ask, and why

The form narrows the problem down instead of leaning on the description box:

- **Three-level issue picker** (`lib/services.ts`): **area** (Plumbing) → **item**
  (Faucet) → **symptom** (Drips when shut off). Each level is optional after the
  first — a category alone still triages — and the selection is flattened into the
  `affectedServices` strings the heuristic and the Issues Matrix already score
  against (`describeSelection`).
- **Room + floor** (`lib/rooms.ts`): the address says which house; these say which
  door and how many flights of stairs. Rooms are chips that pre-fill a free-text
  field (people have workshops and nurseries); floors are a **closed set**, because
  they drive access and equipment decisions and have to be comparable.
- **Photos** (`lib/photoUpload.ts`): `capture="environment"` puts the camera one tap
  away on a phone, with the library still available. Each pick is drawn to a canvas,
  downscaled to a 1400px edge and re-encoded as JPEG **in the browser** before upload
  — which keeps a driveway-LTE upload quick and strips EXIF (including GPS) on the
  way. Limits (6 photos, 1.5 MB each, 6 MB total) are enforced again server-side.
  Image bytes live in their own store collection, never on the `Submission`, so
  queues, dispatch boards and admin lists don't drag them around. The claiming
  technician sees them on the job card.

---

## Checkout — the visit fee

Booking is **hold → pay → confirm**:

1. The customer picks a window; `POST /api/book` with `hold: true` reserves it
   (atomically) and leaves the booking `requested`.
2. `POST /api/checkout` prices the held slot, charges the fee through the configured
   payment provider, and records it on the submission.
3. Only then is the booking `confirmed` and the confirmation email sent.

Holding first means nobody pays for a window that filled up while they typed a card;
paying before confirming means a confirmed booking is always a paid one. Checkout is
**idempotent** — a double-tap returns the existing receipt rather than charging twice.

| Window starts | Tier | Fee |
| --- | --- | --- |
| 8:00am – 3:59pm | Daytime | **$99** |
| 4:00pm – 8:59pm | Evening | **$135** |

A window is priced by the hour it **starts**, so the 2pm–5pm window is a $99 daytime
visit even though it runs past 4pm — the customer is quoted on arrival time, not on
the tail. Pricing lives in `lib/pricing.ts` and runs **server-side only**: the API
attaches a fee to every slot it offers, and `/api/checkout` re-prices the held slot
rather than trusting anything the browser sends, so a client in another timezone (or
a tampered request) can't change what is charged.

**Card handling.** The card number is validated in the browser (Luhn, brand, expiry —
`lib/card.ts`) and stops there. Only the brand, last four digits and expiry reach the
server, for the receipt. Money movement is the payment provider's job: the default
`manual` provider writes a ledger entry, and `PAYMENTS_PROVIDER=stripe` swaps in a
real processor with no caller changes.

---

## "Where's my tech?" (`/track/[id]`)

Once a technician accepts a job and commits an ETA, the customer gets a live arrival
view — linked from the confirmation screen, the confirmation email, and the
assignment email/SMS:

- **Stage timeline**: Booked → Tech assigned → On the way → Arriving.
- **Countdown** to the committed ETA, anchored to the **server clock** (the payload
  carries `serverNow`, so a device with a skewed clock still counts down correctly)
  and ticking locally between 15-second polls.
- **Proximity map**: a Samsara-style relative plot — home at the center, the
  technician offset toward their real bearing, with an accuracy halo — plus "about
  3.5 mi away, coming from the north-west".

Two limits keep this from becoming employee surveillance (`lib/tracking.ts`):

1. **Coarse only.** Coordinates are snapped to a fixed ~1 mile grid *on the server*
   before they are ever published. Snapping to a fixed grid (rather than jittering)
   also means repeated polls of a parked vehicle return the identical cell, so the
   noise can't be averaged back into a precise fix.
2. **Only while en route.** Location is published only for a job that technician has
   claimed, while they are on duty with a fresh heartbeat, and only until the visit
   ends. Off duty, stale, completed, or unassigned ⇒ no location at all.

The payload carries the technician's **first name only** and no customer contact
details.

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

To migrate to Postgres (the "flip of a switch"):

1. Set `STORE_DRIVER=postgres` and `DATABASE_URL=postgres://…`
2. Deploy. `init()` creates the tables and seeds the heuristic config on first run.

`pg` ships as a dependency, so no extra install is needed — this is the driver you want
on serverless hosts (e.g. Vercel), whose filesystem is read-only and can't back the JSON
store. The Postgres driver (`lib/store/postgresStore.ts`) implements the exact same
contract as the JSON driver, including atomic slot reservation via a conditional `UPDATE`.
`pg` is imported lazily, so JSON mode never opens a connection.

---

## API

| Method & path | Purpose |
| --- | --- |
| `POST /api/intake` | Submit intake (incl. room, floor, photos), triage it, return submission + priced availability |
| `GET /api/availability` | Current open slots, each with its visit fee |
| `POST /api/book` | Reserve a slot for a submission (atomic); `hold: true` reserves without confirming |
| `POST /api/checkout` | Charge the visit fee for a held slot, confirm the booking, send the confirmation |
| `GET /api/track/:id` | Customer arrival tracker: stage, countdown, coarse technician location |
| `GET /api/submissions` | Recent submissions (admin) |
| `GET /api/feedback` | Feedback records + agreement stats |
| `GET /api/heuristic` | Current config + pending proposals |
| `POST /api/heuristic` | Apply pending (or specific) proposals; bumps version |
| `POST /api/admin/login` | Exchange admin password for a session cookie |
| `POST /api/admin/logout` | Clear the admin session |

The admin page and the `submissions` / `feedback` / `heuristic` APIs are gated;
the customer-facing `intake` / `availability` / `book` / `checkout` / `track` APIs are
public. `track` is a capability link — the unguessable submission id is the credential,
and it's rate-limited so the id space can't be swept.

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
  **NIST 800-63B** (length-first, no composition rules). For local testing you can set
  `AUTH_PASSWORD_POLICY=relaxed` to allow short, simple passwords (4+ chars, no blocklist
  or breach check) — leave it `strict` (the default) in production. **Forgot-password**
  follows the **OWASP** guidance: single-use, hashed, time-limited (30 min) tokens emailed
  out of band; no account-existence disclosure. Sessions are **bound to the tech id** in
  the signed cookie, so a caller can only ever act as themselves.
- **Live queue**: every submission enters the queue. Technicians sort by **recency**,
  **client-reported urgency**, or **proximity** (browser geolocation + geocoded job
  addresses, haversine). Contact PII is withheld until a job is claimed.
- **Claim-to-lock**: `claimJob` is atomic in both store drivers (a conditional update
  guarded on `dispatchStatus = 'queued'`), so two technicians can never claim the same
  job — the loser gets a 409 and the queue updates live for everyone (polling).
- **Committed ETA** in 30-minute increments → the customer is notified a technician is
  assigned, by **email** and (if they opted in) **SMS**, both carrying a link to the
  live **"Where's my tech?"** tracker.
- **Job context**: the claimed job card shows the **room and floor** and the customer's
  **intake photos**, so the technician knows what they're walking into before they load
  the van.
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

**Technician history** — each technician on the board links to a detail view
(`/admin/technician/[id]`) showing their **duty history** (clock-in/out sessions with
durations, retained up to **5 years**) and **every job they've worked** with full
details. Duty sessions are logged automatically from the on-duty/off-duty heartbeats.

## Portal security

Both staff portals are hardened (`lib/security.ts`, `middleware.ts`, `next.config.js`):
rate-limited logins with exponential backoff, same-origin (CSRF) checks on every
state-changing request, `SameSite=Strict` HTTP-only session cookies, `no-store` on
authenticated responses, and security headers (`X-Frame-Options`, `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy`, HSTS in production).

**Two-factor (TOTP).** A dependency-free RFC 6238 implementation (`lib/auth/totp.ts`):

- **Admin** — set `ADMIN_TOTP_SECRET` (generate one with `npm run gen:totp`) and admin
  login also requires a 6-digit authenticator code.
- **Technicians** — opt-in per account at `/tech/security`: scan/enter the key, verify a
  code to enable, and thereafter a code is required at sign-in. Disable requires a
  current code.

**Non-obvious admin path.** Set `ADMIN_BASENAME` to a secret slug (e.g. `ops-7f3a`) and
the console is served from `/<slug>` while the literal `/admin` returns 404, so it can't
be found by scanning. The admin's own links derive the base from the URL at runtime, so
the slug never ships in a public bundle. **Set `ADMIN_BASENAME` at build time** — the
rewrite is baked during `next build`, not read only at runtime.

---

## Environment variables

See `.env.example`. Key ones: `ANTHROPIC_API_KEY`, `TRIAGE_MODEL` (default
`claude-sonnet-5`), `STORE_DRIVER`, `DATABASE_URL`; technician portal
`TECH_PASSCODE`/`TECH_SESSION_SECRET`; `GEOCODER`; SMS `TWILIO_*`; billing
`PAYMENTS_PROVIDER`/`STRIPE_SECRET_KEY`; email `RESEND_API_KEY`/`EMAIL_FROM`/`EMAIL_OPS`;
`APP_BASE_URL` (absolute base for tracker links in emails/SMS).

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
