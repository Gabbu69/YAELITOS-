# AI Handoff Notes for Yaelitos Website

This is a static HTML/CSS/JS website. Keep it simple and staff-friendly.

## Project Intent

Promote Yaelitos as:

- A Filipino comfort food restaurant
- A VIP Room venue
- A catering provider
- A celebration place for birthdays, meetings, salo-salo, and family events

## Rules for Future Changes

- Do not add online ordering.
- Do not add online payment.
- Do not add customer accounts.
- Do not add an admin dashboard.
- Do not add POS or inventory features.
- Do not add an AI chatbot.
- Keep the site static unless the owner explicitly requests a new stack.
- Keep the site customer-facing and avoid public developer or handoff copy.

## File Map

- `assets/styles.css` controls the full visual design and responsive layout.
- `assets/site.js` controls mobile navigation, reveal animations, gallery lightbox, floating call/Messenger buttons, and form behavior.
- `assets/media/` contains the supplied Yaelitos photos and video.
- `contact.html` contains all three inquiry forms.
- `menu.html` contains the first featured menu, based on visible supplied materials.

## Current Business Details

- Name: Yaelitos Restaurant
- Tagline: Your Second Home
- Location: Rizal St., Poblacion A, M'lang, North Cotabato
- Contact number: 0912-059-3992
- Open: Monday-Sunday, 11AM-8PM
- Category: Filipino comfort food, VIP Room, catering, private gatherings

`assets/site.js` currently uses:

```js
const SITE_CONTACT = {
  phoneDisplay: "0912-059-3992",
  phoneHref: "tel:+639120593992",
  smsHref: "sms:+639120593992",
  messengerUrl: "https://m.me/yaelitosrestaurant",
  address: "Rizal St., Poblacion A, M'lang, North Cotabato"
};
```

Update the map embed in `contact.html` only if the restaurant has a more exact Google Maps listing URL.

## Form Behavior

The forms are static. On submit, JavaScript validates required fields, builds a message, copies it when possible, and opens the visitor's SMS app addressed to 0912-059-3992. Visitors can also send the same details through Facebook Messenger or call directly.

## Design Notes

The site uses a warm Filipino restaurant palette: cream, dark ink, leaf green, clay, gold, and teal accents. Avoid turning the whole site into a single-color theme. Use the real restaurant photos as the main visual signal.

## Quick QA Checklist

- Open `index.html`, `menu.html`, `vip-room.html`, `catering-events.html`, `gallery.html`, and `contact.html`.
- Check mobile navigation below 700px wide.
- Confirm floating Call and Messenger buttons are readable.
- Confirm the gallery lightbox opens and closes.
- Confirm all three forms validate required fields.
- Confirm no missing images in `assets/media/`.
