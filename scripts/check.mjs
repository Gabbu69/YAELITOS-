import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const pages = [
  "index.html",
  "menu.html",
  "private-events.html",
  "contact.html",
  "privacy.html",
  "staff/index.html",
  "about.html",
  "gallery.html",
  "vip-room.html",
  "catering-events.html"
];
const errors = [];

for (const page of pages) {
  const absolute = resolve(root, page);
  let html = "";
  try {
    html = await readFile(absolute, "utf8");
  } catch {
    errors.push(`Missing page: ${page}`);
    continue;
  }

  if (/fbcdn\.net|scontent[^"']*facebook/i.test(html)) {
    errors.push(`Expiring Facebook CDN URL found in ${page}`);
  }

  const attributes = [...html.matchAll(/\s(?:href|src)=["']([^"'#?]+)["']/g)].map((match) => match[1]);
  for (const target of attributes) {
    if (/^(?:https?:|mailto:|tel:|sms:|data:|\/\/)/i.test(target)) continue;
    const localPath = resolve(dirname(absolute), target);
    try {
      await access(localPath);
    } catch {
      errors.push(`Broken local reference in ${page}: ${target}`);
    }
  }
}

for (const required of [
  "assets/customer-booking.js",
  "assets/staff-app.js",
  "assets/app-config.js",
  "supabase/config.toml"
]) {
  try {
    await access(resolve(root, required));
  } catch {
    errors.push(`Missing required build artifact: ${required}`);
  }
}

const appConfig = await readFile(resolve(root, "assets/app-config.js"), "utf8");
if (/service[_-]?role|sb_secret_/i.test(appConfig)) {
  errors.push("A secret Supabase key appears in assets/app-config.js");
}

const migration = await readFile(
  resolve(root, "supabase/migrations/20260713093210_booking_dashboard.sql"),
  "utf8"
);
for (const required of [
  "enable row level security",
  "Active staff can read bookings",
  "consume_submission_quota",
  "anonymize_expired_bookings"
]) {
  if (!migration.includes(required)) errors.push(`Migration is missing: ${required}`);
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Static QA passed for ${pages.length} pages.`);
}
