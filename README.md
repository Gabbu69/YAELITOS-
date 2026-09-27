# Yaelitos Restaurant Website and Booking Dashboard

A mobile-first static customer website with a Supabase-backed booking workflow, private staff desk, and owner-published menu, hours, and announcement content. Customers send Pending requests; staff check availability and reply personally before confirming.

## Customer and Staff Pages

- `index.html` — home, story, trust details, highlights, and gallery
- `menu.html` — food highlights and published, owner-approved menu details
- `private-events.html` — private room and catering/group meals
- `contact.html` — visit details and the booking request form
- `privacy.html` — booking-data notice and 12-month retention summary
- `staff/` — invite-only booking desk and owner Content tab
- `staff/guide.html` — printable English/Filipino one-page shift guide

Legacy About, Gallery, VIP Room, and Catering URLs remain lightweight redirects.

## Booking Workflow

The customer form validates the request, completes a Cloudflare Turnstile check, and calls the public `submit-booking` Supabase Edge Function. The function validates again, applies idempotency and per-IP rate limiting, then stores a Pending record. The browser has no direct anonymous table access.

After saving, the customer sees a request reference and may optionally copy the details into Messenger, send them by SMS, or call. If storage fails, the form input remains and the contact fallbacks are still available. Nothing automatically confirms a booking or sends customer notifications.

Authenticated staff start in **Needs reply**, which includes overdue Pending requests. They can add Messenger, phone, and walk-in requests to the same queue; a Messenger name can be used without a phone number. Staff record the channel and Philippine time of their reply before Confirmed or Rejected is saved. The dashboard never contacts customers automatically. Owners can also manage staff access, export filtered CSV, view activity, anonymize customer details, and draft/publish/unpublish menu, regular hours, or one announcement. See [`STAFF-GUIDE.md`](STAFF-GUIDE.md), [`STAFF-QUICK-START.md`](STAFF-QUICK-START.md), and the printable `/staff/guide.html` page.

Public pages read only published content from Supabase. No current menu prices, hours, capacity, or event package is seeded: the owner must approve those details first. Without approved content or a working connection, the site directs visitors to Messenger or phone rather than guessing.

## Local Setup

Install exact dependencies and build the static bundles:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm check
pnpm check:edge
```

For a local static preview, set the public URL, publishable key, and Turnstile site key in `assets/app-config.js`. It is intentionally blank in Git. Never place a Supabase secret/service-role key in a browser asset. `pnpm build:deploy` writes an allowlisted `dist/` containing the public pages, `/staff/`, `/staff/guide.html`, and browser configuration generated from `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `TURNSTILE_SITE_KEY`. Partial configuration fails the build; all three values are required for a production build.

For the static preview:

```powershell
python -m http.server 8080 --bind 127.0.0.1
```

Open `http://127.0.0.1:8080/` and `http://127.0.0.1:8080/staff/`.

## Supabase Setup and Deployment

The checked-in `supabase/` directory contains the migrations, local configuration, Cron retention job, and Edge Functions. Use a restaurant-owned project for production.

1. Create or select a client-owned Supabase project and link it with the Supabase CLI.
2. Apply both migrations and deploy `submit-booking`, `manage-booking`, `manage-content`, `manage-staff`, and `export-bookings`.
3. Set Edge Function secrets: `ALLOWED_ORIGINS`, `TURNSTILE_SECRET_KEY`, `RATE_LIMIT_SECRET`, and `STAFF_REDIRECT_URL`.
4. Set the production Auth site URL and exact `/staff/` redirect URL. Keep public email signup and anonymous sign-in disabled. Verify that owner/staff invitations and password recovery emails arrive before launch.
5. Create the initial owner in Supabase Auth, then insert its matching `staff_profiles` row with role `owner`.
6. Put the project URL, current publishable key, and Turnstile site key in Vercel project environment variables named `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `TURNSTILE_SITE_KEY`. The committed `vercel.json` runs `pnpm build:deploy` and serves only `dist/`. Do not configure any server-only key in Vercel's browser build.
7. Use a Vercel plan that permits commercial use and a production Supabase plan that will not pause during low activity. The restaurant owns and pays both accounts. Transfer the existing Vercel project to the restaurant team after the live URL and billing are verified.
8. Run Supabase security and performance advisors before launch, then test a safe practice booking on the real URL.

The initial owner profile can be inserted from the SQL editor after creating the Auth user:

```sql
insert into public.staff_profiles (user_id, email, display_name, role)
values ('AUTH_USER_UUID', 'owner@example.com', 'Owner name', 'owner');
```

## Configuration Sources

- `assets/site-config.js` — stable restaurant, contact, and social links
- `assets/app-config.js` — blank tracked template for public Supabase and Turnstile browser configuration
- `site_content` — published menu, regular hours, and one announcement; `content_drafts` is owner-only
- Supabase Edge Function secrets — server-only credentials and allowlists

Approved restaurant photos remain in `assets/media/`. No Facebook CDN URL is used.

## Intentional Boundaries

There are no customer accounts, online ordering, payments, POS, inventory features, automatic capacity decisions, automatic confirmations, live Facebook scraper, or customer-notification automation. Promotions remain on Facebook by default. Staff check Needs reply at opening and before closing; there are no staff email or Messenger alerts.

## Verification

Run:

```powershell
pnpm build
pnpm check
pnpm check:edge
pnpm build:deploy
supabase db reset
```

`supabase db reset` needs a running local Docker engine. After linking a remote project, run security/performance advisors and test the customer-to-dashboard flow, manual intake, owner-only publishing and withdrawal, role restrictions, and invitation/recovery emails with non-production records before launch. Check that `/staff/` and `/privacy.html` return actual pages on the deployed site. The business owner must supply the approved menu, prices, hours, event terms, staff emails, and billing accounts for complete handoff.
