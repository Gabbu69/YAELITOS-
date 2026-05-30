# AI Handoff Notes for Yaelitos Website

This is a static HTML/CSS/JS website. Keep it simple and staff-friendly.

## Project Intent

Promote Yaelitos as:

- A Filipino comfort food restaurant
- A VIP room venue
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
- Keep contact details easy for non-technical staff to update.

## File Map

- `assets/styles.css` controls the full visual design and responsive layout.
- `assets/site.js` controls mobile navigation, reveal animations, gallery lightbox, floating call/Messenger buttons, and form behavior.
- `assets/media/` contains the supplied Yaelitos photos and video.
- `contact.html` contains all three inquiry forms.
- `menu.html` contains the first featured menu, based on visible supplied materials.

## Important Placeholders

Update `assets/site.js`:

```js
const SITE_CONTACT = {
  phoneDisplay: "Replace with phone number",
  phoneHref: "tel:+630000000000",
  messengerUrl: "https://m.me/yaelitosrestaurant",
  email: "reservations@yaelitos.example",
  address: "Rizal St., Poblacion A, M'lang, North Cotabato"
};
```

Update `contact.html` for final operating hours and exact map embed if the restaurant has an official Google Maps listing.

## Form Behavior

The forms are static. On submit, JavaScript validates required fields, builds a message, and opens the visitor's email app with a prepared inquiry. This avoids server setup while still being usable for staff.

## Design Notes

The site uses a warm Filipino restaurant palette: cream, dark ink, leaf green, clay, gold, and teal accents. Avoid turning the whole site into a single-color theme. Use the real restaurant photos as the main visual signal.

## Quick QA Checklist

- Open `index.html`, `menu.html`, `vip-room.html`, `catering-events.html`, `gallery.html`, and `contact.html`.
- Check mobile navigation below 700px wide.
- Confirm floating Call and Messenger buttons are readable.
- Confirm the gallery lightbox opens and closes.
- Confirm all three forms validate required fields.
- Confirm no missing images in `assets/media/`.
