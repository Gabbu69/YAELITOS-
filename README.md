# Yaelitos Restaurant Website and Booking Dashboard

A mobile-first static customer website with a Supabase-backed booking workflow and private staff dashboard. Customers can send complete requests; Yaelitos staff organize and update them without online ordering or automatic booking confirmation.

## Customer and Staff Pages

- `index.html` — home, story, trust details, highlights, and gallery
- `menu.html` — food highlights
- `private-events.html` — private room and catering/group meals
- `contact.html` — visit details and the booking request form
- `privacy.html` — booking-data notice and 12-month retention summary
- `staff/` — invite-only owner/staff booking dashboard

Legacy About, Gallery, VIP Room, and Catering URLs remain lightweight redirects.

## Booking Workflow

The customer form validates the request, completes a Cloudflare Turnstile check, and calls the public `submit-booking` Supabase Edge Function. The function validates again, applies idempotency and per-IP rate limiting, then stores a Pending record. The browser has no direct anonymous table access.

After saving, the customer sees a request reference and may optionally copy the details into Messenger, send them by SMS, or call. If storage fails, the form input remains and the contact fallbacks are still available. Nothing automatically confirms a booking or sends customer notifications.

Authenticated staff can view records and update statuses. Owners can also manage staff access, export filtered CSV, view full activity, and anonymize customer details. See [`STAFF-GUIDE.md`](STAFF-GUIDE.md).

## Local Setup

Install exact dependencies and build the static bundles:

```powershell
pnpm install --frozen-lockfile
pnpm build
```

Copy `.env.example` values into `assets/app-config.js` for the intended environment. Only the Supabase URL, publishable key, and Turnstile site key belong in browser assets. Never place a Supabase secret/service-role key in the website.

For the static preview:

```powershell
python -m http.server 8080 --bind 127.0.0.1
```

Open `http://127.0.0.1:8080/` and `http://127.0.0.1:8080/staff/`.

## Supabase Setup and Deployment

The checked-in `supabase/` directory contains the migration, local configuration, Cron retention job, and Edge Functions.

1. Create or select a client-owned Supabase project and link it with the Supabase CLI.
2. Apply the migration and deploy `submit-booking`, `manage-staff`, and `export-bookings`.
3. Set Edge Function secrets: `ALLOWED_ORIGINS`, `TURNSTILE_SECRET_KEY`, `RATE_LIMIT_SECRET`, and `STAFF_REDIRECT_URL`.
4. Set the production Auth site URL and exact `/staff/` redirect URL. Keep public email signup and anonymous sign-in disabled.
5. Create the initial owner in Supabase Auth, then insert its matching `staff_profiles` row with role `owner`.
6. Put the project URL, current publishable key, and Turnstile site key in `assets/app-config.js`; rebuild and deploy the static site.
7. Run Supabase security and performance advisors before launch.

The initial owner profile can be inserted from the SQL editor after creating the Auth user:

```sql
insert into public.staff_profiles (user_id, email, display_name, role)
values ('AUTH_USER_UUID', 'owner@example.com', 'Owner name', 'owner');
```

## Configuration Sources

- `assets/site-config.js` — repeated restaurant, contact, social, and announcement details
- `assets/app-config.js` — public Supabase and Turnstile browser configuration
- Supabase Edge Function secrets — server-only credentials and allowlists

Approved restaurant photos remain in `assets/media/`. No Facebook CDN URL is used.

## Intentional Boundaries

There are no customer accounts, online ordering, payments, POS, inventory features, automatic capacity decisions, automatic confirmations, live Facebook scraper, or customer-notification automation. Promotions remain on Facebook by default.

## Verification

Run:

```powershell
pnpm build
pnpm check
supabase db reset
```

After linking a remote project, also run security/performance advisors and test the full customer-to-dashboard flow with non-production records before launch.
