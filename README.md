# Yaelitos Restaurant Website

Premium static website for Yaelitos Restaurant, promoting dine-in service, the VIP room, catering, and celebration bookings.

## Pages

- `index.html` - Home page
- `about.html` - About Yaelitos
- `menu.html` - Featured menu
- `vip-room.html` - VIP room promotion
- `catering-events.html` - Catering and events
- `gallery.html` - Photo gallery and celebration gallery
- `contact.html` - Contact, map, reservation form, VIP inquiry form, and catering inquiry form

## Update These Before Launch

- Phone number
- Messenger link
- Email address for inquiry forms
- Final operating hours
- Official Google Maps link
- Final menu prices and availability

## Staff Edits

Most common updates are simple text edits:

- Contact details: `assets/site.js`
- Operating hours: `contact.html`
- Menu items and prices: `menu.html`
- Gallery photos: `gallery.html` and `assets/media/`
- Colors and layout: `assets/styles.css`

## What Is Intentionally Not Included

This website does not include online ordering, payments, accounts, admin tools, POS, inventory, or chatbot features.

## Local Preview

From this folder, run:

```bash
python -m http.server 8080
```

Then open:

```text
http://127.0.0.1:8080/index.html
```
