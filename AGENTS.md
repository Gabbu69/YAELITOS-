# AI Handoff Notes for Yaelitos Website

This is a static HTML/CSS/JS customer website with a Supabase booking database, Edge Functions, Auth, and a static staff dashboard. Keep both experiences fast and simple for nontechnical restaurant staff.

## Project Intent

Present Yaelitos as a Filipino comfort food restaurant, private-room venue, catering provider, and celebration place for birthdays, meetings, salo-salo, and family events. The primary conversion is a saved Pending booking request, with optional Facebook Messenger, SMS, and phone follow-up.

## Non-Negotiable Boundaries

- Do not add online ordering, online payment, customer accounts, or booking confirmation automation.
- Do not add POS, inventory, or an AI chatbot. Supabase also stores owner-approved menu, hours, and announcement content for the static site.
- Do not add a live Facebook scraper or automatic social feed.
- Keep the customer pages and dashboard frontend static. Supabase is the approved backend for booking records, staff access, and owner-published website content.
- Do not put developer notes, sales quotes, or owner-only materials on customer pages. Keep local owner materials under the ignored `.owner-private/` folder.
- Do not invent food names, prices, hours, capacity, equipment, packages, policies, testimonials, or service guarantees.

## Canonical Architecture

- `index.html` - Home, story, trust details, highlights, and the gallery section
- `menu.html` - Food highlights
- `private-events.html` - Private room and catering/group meals
- `contact.html` - Visit information, directions, and one guided inquiry form
- `assets/site-config.js` - source of truth for stable business and social details
- `assets/site.js` - navigation, progressive reveal, gallery dialog, configuration binding, mobile actions, and inquiry behavior
- `assets/app-config.js` - public Supabase URL/publishable key and Turnstile site key only
- `assets/styles.css` - visual design and responsive layout
- `assets/media/` - approved, locally served restaurant media
- `staff/` - static invite-only owner/staff dashboard
- `src/` - customer booking and staff dashboard source before bundling
- `supabase/` - migrations, RLS/grants, Cron retention, and Edge Functions
- `scripts/build-deploy.mjs` and `vercel.json` - allowlisted static deployment and public browser configuration from environment values

Preserve these legacy routes as lightweight redirects:

- `about.html` -> `index.html#story`
- `gallery.html` -> `index.html#gallery`
- `vip-room.html` -> `private-events.html#private-room`
- `catering-events.html` -> `private-events.html#catering`

## Configuration Source of Truth

Keep stable repeated facts in `assets/site-config.js` under these sections and keys:

- `business`: `name`, `tagline`, `phoneDisplay`, `phoneHref`, `smsHref`, `address`, `directionsUrl`
- `facebook`: `pageUrl`, `messengerUrl`

Owner-approved menu items and prices, seven-day hours, and one announcement are drafted and published through the owner Content tab. Public pages read published Supabase rows only and show an honest contact fallback when rows are absent or unavailable. Shared contact facts should be changed in the static configuration rather than edited separately on every page. Keep valid HTML fallback text so essential contact information remains usable if JavaScript is unavailable. Do not display stale Facebook follower or recommendation counts.

Current core details are:

- Name: Yaelitos Restaurant
- Tagline: Your Second Home
- Address: Rizal St., Poblacion A, M'lang, Philippines 9402
- Contact number: 0912-059-3992
- Category: Filipino comfort food, private room, catering, and private gatherings

Exact hours, food names/prices, room capacity/features, event inclusions, and policies require owner approval before publication. Google Maps and Facebook currently disagree about opening hours; do not seed either set as fact.

## Inquiry Behavior

There is one guided form for table requests, private gatherings, and catering/group meals. After browser and server validation, it stores a Pending request and offers:

1. A non-sensitive request reference and Pending status
2. Copy details and open Messenger
3. Prefilled SMS as a fallback
4. Click-to-call as a final fallback

Do not clear the customer's input automatically. Provide a manual-copy option when clipboard access fails. Clearly state that the request is only confirmed after Yaelitos replies. Anonymous browsers must not receive direct table access or any secret/service-role key; public writes go through the protected `submit-booking` Edge Function.

## Staff Workflow

Staff use the invite-only `/staff/` dashboard and follow `STAFF-GUIDE.md`. They check Needs reply at opening and before closing, including overdue Pending requests, and can record Messenger, phone, and walk-in inquiries manually. They still reply personally through the appropriate customer channel and record how and when they replied before marking Confirmed or Rejected. The dashboard never sends customer messages. The owner can draft, publish, and withdraw approved menu, hours, and announcement content; ordinary staff cannot edit it. Promotions remain on Facebook by default.

## Design and Content Notes

- Maintain the warm premium palette: ivory/cream, dark ink or espresso, leaf/forest green, restrained gold, clay, and teal accents.
- Use real approved restaurant photos as the main visual signal and exclude identifiable customer faces unless permission is clear.
- Keep claims factual and use "ask about" wording for unconfirmed event details.
- Serve optimized media locally; do not hotlink expiring Facebook CDN URLs.
- Preserve keyboard access, strong focus styles, reduced-motion support, readable contrast, and useful no-JavaScript fallbacks.

## Quick QA Checklist

- Open the four canonical pages and verify all desktop/mobile navigation links.
- Check every legacy redirect and its destination anchor.
- Test at narrow mobile, tablet, and desktop widths with no covered controls or horizontal scrolling.
- Confirm the mobile menu works by keyboard and closes with Escape.
- Confirm the gallery dialog opens, closes, and returns focus.
- Test required fields, invalid/past dates, clipboard failure, Messenger, SMS, and phone fallbacks.
- Confirm shared contact/social values match `assets/site-config.js` and essential fallback content works without JavaScript.
- Confirm all media paths resolve and no Facebook CDN URL is used.
- Confirm anonymous Data API access is denied, active staff RLS works, inactive staff are blocked, and owner-only actions reject staff users.
- Confirm anonymous content reads expose published fields only, drafts stay private, and unpublishing returns the website to its contact fallback.
- Confirm manual intake supports Messenger names without phone numbers, overdue Pending requests stay visible, and Confirmed/Rejected require a recorded reply.
- Test idempotency, Turnstile failure, rate limiting, status conflicts, CSV formula escaping, activity logging, and 12-month anonymization.
- Confirm `/staff/` and `/privacy.html` exist in the allowlisted deployment output; production builds must have a complete public app configuration.
- Check for console errors and broken internal links.
