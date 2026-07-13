import { build } from "esbuild";

const shared = {
  bundle: true,
  minify: true,
  sourcemap: false,
  target: ["es2020"],
  platform: "browser",
  legalComments: "none"
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ["src/customer-booking.js"],
    outfile: "assets/customer-booking.js",
    format: "iife"
  }),
  build({
    ...shared,
    entryPoints: ["src/staff-app.js"],
    outfile: "assets/staff-app.js",
    format: "iife"
  })
]);

console.log("Built customer booking and staff dashboard bundles.");
