import { access, cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(root, "dist");
if (path.dirname(output) !== root || path.basename(output) !== "dist") {
  throw new Error("Deployment output must be the project dist directory.");
}

await import("./build.mjs");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const entry of await readdir(root, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".html")) {
    await cp(path.join(root, entry.name), path.join(output, entry.name));
  }
}
await cp(path.join(root, "assets"), path.join(output, "assets"), { recursive: true });
await mkdir(path.join(output, "staff"), { recursive: true });
await cp(path.join(root, "staff", "index.html"), path.join(output, "staff", "index.html"));
await cp(path.join(root, "staff", "guide.html"), path.join(output, "staff", "guide.html"));

const configNames = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "TURNSTILE_SITE_KEY"];
const missing = configNames.filter((name) => !process.env[name]?.trim());
const supplied = configNames.filter((name) => process.env[name]?.trim());
if ((process.env.VERCEL_ENV === "production" || supplied.length > 0) && missing.length > 0) {
  throw new Error(`Missing browser configuration: ${missing.join(", ")}`);
}

const supabaseUrl = process.env.SUPABASE_URL?.trim() || "";
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || "";
const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY?.trim() || "";
if (supabaseUrl && !/^https:\/\/[^/]+\.supabase\.co\/?$/.test(supabaseUrl)) {
  throw new Error("SUPABASE_URL must be a hosted Supabase HTTPS project URL.");
}
if (/sb_secret_|service[_-]?role/i.test(publishableKey)) {
  throw new Error("SUPABASE_PUBLISHABLE_KEY must not contain a secret or service-role key.");
}

const browserConfig = {
  supabaseUrl,
  supabasePublishableKey: publishableKey,
  turnstileSiteKey,
  staffPath: "/staff/",
  idleMinutes: 30
};
const appConfig = `(function exposeYaelitosAppConfig() {\n  "use strict";\n  window.YAELITOS_APP_CONFIG = Object.freeze(${JSON.stringify(browserConfig, null, 2)});\n})();\n`;
await writeFile(path.join(output, "assets", "app-config.js"), appConfig, "utf8");

for (const required of [
  "index.html",
  "menu.html",
  "contact.html",
  "privacy.html",
  "staff/index.html",
  "staff/guide.html",
  "assets/customer-booking.js",
  "assets/staff-app.js",
  "assets/app-config.js"
]) {
  await access(path.join(output, required));
}

console.log("Prepared allowlisted static deployment in dist/.");
