# Yaelitos Restaurant Website

A premium, mobile-first static website for Yaelitos Restaurant. It introduces the food and event services, then helps customers send a complete inquiry through the restaurant's existing Messenger, SMS, or phone workflow.

## Customer Pages

- `index.html` - Home, restaurant story, trust details, highlights, and gallery
- `menu.html` - Food highlights
- `private-events.html` - Private room and catering/group-meal inquiries
- `contact.html` - Visit information, directions, and the guided booking form

The former About, Gallery, VIP Room, and Catering URLs remain as lightweight redirects so old links still reach the correct content.

## How Inquiries Work

The guided form prepares a readable message from the customer's details. Its main action copies the details and opens Facebook Messenger. SMS and click-to-call remain available as fallbacks.

The website does not receive, store, or confirm the request. A request is confirmed only after Yaelitos replies. The short daily workflow for nontechnical staff is in [`STAFF-GUIDE.md`](STAFF-GUIDE.md).

## Business Information

`assets/site-config.js` is the source of truth for repeated business details. Its sections contain:

- `business` - name, tagline, phone links, address, and directions
- `facebook` - Page and Messenger links plus dated trust labels
- `announcement` - an optional site-wide notice, label, and link

Update this file rather than repeating a new phone number, address, or social link across multiple pages. Page-specific food or event copy stays in its relevant HTML file. Approved restaurant photos belong in `assets/media/`.

Facebook content is a curated, one-time part of the site; there is no live scraper or automatic feed. Day-to-day promotions should continue on Facebook.

## Local Preview

From the project folder, run:

```powershell
python -m http.server 8080 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8080/`. Use another free local port only if port 8080 is already occupied.

## Intentional Boundaries

The project remains plain HTML, CSS, and JavaScript. It has no backend, database, staff dashboard, customer accounts, online ordering, online payment, POS, inventory system, AI chatbot, or live Facebook scraper.
