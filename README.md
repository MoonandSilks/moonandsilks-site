# Moon & Silks Circus Co — website and bookings

Astro site for www.moonandsilks.com. The marketing pages (Home, About, Contact) are static. `/book` and `/admin` run as Vercel serverless functions backed by Postgres and Stripe.

- **`/book`:** schedule, then a cart (several participants and/or several Saturdays), then one waiver per participant, then card payment (Stripe). There is no cash option.
- **`/admin`:** Natascha's private page. It has rosters, manual add and cancel, CSV export, waiver PDFs and CSV import.

## Run locally

You need Node 22 and a Postgres database (local, or a free Neon branch).

```bash
npm install
cp .env.example .env     # fill in DATABASE_URL, ADMIN_PASSWORD, AUTH_SECRET (+ Stripe test keys)
npm run db:setup         # creates the tables and the nine 2026 sessions
npm run dev              # http://localhost:4321
```

Other commands:

| Command | What it does |
|---|---|
| `npm run build` | Production build |
| `npm run db:migrate` | Applies SQL migrations in `drizzle/` |
| `npm run db:seed` | Adds or updates the sessions and the waiver wording. Safe to run more than once. |
| `npm run db:generate` | After changing `src/lib/db/schema.ts`, creates a new migration |
| `npm run import:csv -- file.csv` | Imports existing bookings from the command line |
| `TEST_DATABASE_URL=… npm test` | Integration tests. **This wipes the database it's given, so use a throwaway one.** |

### Stripe webhook locally

```bash
stripe listen --forward-to localhost:4321/api/stripe-webhook
```

Put the `whsec_…` secret it prints into `STRIPE_WEBHOOK_SECRET`, then pay with test card `4242 4242 4242 4242`.

## How it works

- **Capacity (10 per session) is enforced in the database.** Each booking locks the session rows (`SELECT … FOR UPDATE`) and re-counts confirmed spots plus unexpired holds before it inserts anything, so two people can't take the last spot. This is tested in `tests/booking.test.ts`, which fires 10 bookings at a session with 1 spot left: exactly one succeeds.
- **Online payments:** spots are held for about 30 minutes, then a hosted Stripe Checkout opens.
  - The hold and the Checkout Session expire at the same moment (31 minutes, because Stripe's minimum is 30).
  - Prices are set on the server. Classes and the surcharge are separate line items.
  - Checkout is created with an idempotency key, so a retry can't open a second Checkout.
  - Spots are confirmed **only** by a verified `checkout.session.completed` webhook with `payment_status = paid`.
  - Each Stripe event id is stored, so redelivered events are ignored.
  - Holds are released when the person cancels in Checkout, when Stripe reports the session expired or failed, and lazily whenever someone next loads `/book` or `/admin`.
  - If a payment lands after its hold lapsed and the class has filled in the meantime, the payment is refunded automatically and the order shows as refunded.
  - Payment methods are left to Stripe (dynamic payment methods: cards, Apple Pay, Google Pay, Link). Keep delayed methods such as bank transfers **off** in the Dashboard: they don't fit a 30-minute hold.
- **No cash.** A spot counts as booked only after the Stripe payment succeeds. Unpaid holds lapse after the hold time and never show as booked.
- **Waiver signing is required** to book (checked in the browser and on the server).
- **Card surcharge:** `gross = (net + fixed) / (1 − percent)`, applied once per payment and rounded up to the cent. It is shown as its own line before payment and on the Stripe page.
  - The default is Stripe's AU domestic card rate, 1.65% + A$0.30.
  - International cards cost more; that difference is absorbed, not charged.
- **Waivers:** the full wording lives in `src/lib/waiver-text.ts` and is stored in the database by version and SHA-256. Each signature records the typed names, the time (UTC and Perth), the IP address, every field value and every acknowledgement.
  - If the participant is under 18 on their first class date, the parent/guardian section is required.
  - If the wording ever changes, bump `WAIVER_VERSION` and run `npm run db:seed`. Old signatures keep pointing at the old wording.
- **Health notes** appear only in `/admin`, the admin CSV and the waiver PDFs. They are never on the public confirmation page or in emails.
- **Age groups:** booking outside a session's age group shows a warning but is still allowed. The admin roster flags it.

## Importing existing bookings

The template is `data/existing-bookings-template.csv`; it can also be downloaded from `/admin/import`. **Natascha or Stephanie will supply the filled CSV later. No real data is in this repo.**

- One row = one participant in one session. `session_date` is `2026-11-28`, `2026-12-05` or `2026-12-12`, and `session_time` is `09:00`, `10:00` or `11:00`.
- `waiver_status` is `signed` or `missing`. Imported `signed` rows are labelled **Signed (paper/imported)**. Make sure a real waiver exists for each of them.
- `payment_status` is `paid_card`.
- An empty `health_notes` means "not recorded", which is different from a waiver signed with "None".
- Rows that would push a session over 10 are **rejected and listed**, never squeezed in.
- If the same person (same name and date of birth) is already in that session, the row is **skipped and reported**, so re-running an import does not double-book.

## Setup Natascha does herself

1. **Stripe**
   - Create an account at stripe.com (Australia, for Moon & Silks) and complete Stripe's identity checks.
   - Developers → API keys: in **test mode**, create a **restricted key** (`rk_test_…`) with write access to *Checkout Sessions* and *Refunds*. Put it in `STRIPE_SECRET_KEY`. An `sk_test_…` secret key also works.
   - The publishable key is optional: the site redirects to Stripe's hosted page.
   - Settings → Payment methods: turn on **Link** and leave cards, Apple Pay and Google Pay on. Keep bank transfers and other delayed methods off.
   - Developers → Webhooks → Add endpoint: `https://www.moonandsilks.com/api/stripe-webhook`. Select the events `checkout.session.completed` and `checkout.session.expired`, then copy the signing secret (`whsec_…`). The async payment events are handled too, but are only needed if delayed methods are switched on later.
   - Check your fee on Stripe's pricing page and set `STRIPE_FEE_PERCENT` and `STRIPE_FEE_FIXED` to exactly that cost, **never higher**. The defaults, 1.65% and 0.30, are Stripe's standard AU domestic card rate from stripe.com/au/pricing; confirm they match your account.
   - Leave **Stripe Tax off** unless you are GST-registered. If you are, set up Stripe Tax with an Australian GST registration, keep prices GST-inclusive, and ask for the code to be updated.
   - Occasional family or group invoices are made by hand in the Stripe Dashboard (Invoices → Create), not through `/book`. Add or mark those bookings in `/admin`.
   - Switch to the **live** keys (and a live-mode webhook) only after the go-live check below.
2. **Database**
   - In the Vercel project, open Storage (Marketplace) and add the free **Neon** Postgres integration. It sets `DATABASE_URL` for you.
   - Run the migrations once from a computer with this repo, using the Neon connection string:
     ```bash
     DATABASE_URL="postgres://…neon…" npm run db:setup
     ```
3. **Environment variables**
   - In Vercel → Project → Settings → Environment Variables, add every variable in `.env.example`.
   - Use test Stripe values for Preview, and live ones in Production only when ready.
   - `AUTH_SECRET` must be a random string of 32+ characters (`openssl rand -base64 48`).
   - Resend is optional: add `RESEND_API_KEY` and `EMAIL_FROM` (e.g. `bookings@moonandsilks.com`) only after the domain is verified in Resend.
   - Redeploy after saving.
4. **Admin:** sign in at `https://www.moonandsilks.com/admin` with `ADMIN_PASSWORD`. When the existing-bookings CSV is ready, upload it at `/admin/import`, then check each roster.
5. **Go-live check**
   - Make one test-mode card booking (card `4242 4242 4242 4242`) and one booking with a health note.
   - Confirm it appears on the roster with the right payment status, the health flag shows, and the waiver PDF opens.
   - Only then switch Stripe to live keys.

## Still to add

- **About photo:** add the image to `public/`, then set `photo` at the top of `src/pages/about.astro`.
- **Contact form endpoint:** `PUBLIC_FORM_ENDPOINT`.
- **Business facts** (venue, social links) live in `src/site.ts`.

## Hosting note

Vercel's free Hobby plan is limited to non-commercial use. A business site may need Vercel Pro. The code also runs on other hosts that support Astro server functions, with an adapter swap.
