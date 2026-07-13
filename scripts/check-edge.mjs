import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  absWorkingDir: projectRoot,
  entryPoints: [
    "supabase/functions/submit-booking/index.ts",
    "supabase/functions/manage-staff/index.ts",
    "supabase/functions/export-bookings/index.ts",
  ],
  bundle: true,
  write: false,
  outdir: "supabase/.temp/check-edge",
  platform: "neutral",
  format: "esm",
  external: ["npm:*"],
});

console.log("Edge Function bundle check passed.");
