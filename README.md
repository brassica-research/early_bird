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

## Environment variables

See `.env.example`. Key ones: `ANTHROPIC_API_KEY`, `TRIAGE_MODEL` (default
`claude-sonnet-5`), `STORE_DRIVER`, `DATABASE_URL`, `HEURISTIC_AUTO_APPLY`,
`AUTO_APPLY_THRESHOLD`.

## Deploying to Vercel

The app is a standard Next.js App Router project and deploys to Vercel as-is. For
production, switch `STORE_DRIVER=postgres` (the JSON driver relies on a writable local
filesystem, which is ephemeral on serverless).

## Notes / next steps

- Email confirmations are wired (Resend + console fallback). SMS is a natural next
  add — same `lib/notify` pattern.
- A future mobile **app** can consume the same `/api/*` routes; the domain types in
  `lib/types.ts` are the shared contract.
- `/admin` is gated by a shared password. For multiple operators, swap the
  single-password scheme in `lib/auth.ts` for a real identity provider.
