import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.110.2";

export type StaffProfile = {
  user_id: string;
  email: string;
  display_name: string;
  role: "owner" | "staff";
  active: boolean;
};

function env(name: string): string {
  return (Deno.env.get(name) || "").trim();
}

export function adminClient(): SupabaseClient {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase server credentials are unavailable.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export function allowedOrigins(): Set<string> {
  const configured = env("ALLOWED_ORIGINS")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);

  return new Set(configured.length ? configured : [
    "http://127.0.0.1:8080",
    "http://localhost:8080"
  ]);
}

export function requestOrigin(req: Request): string {
  return (req.headers.get("origin") || "").replace(/\/$/, "");
}

export function isAllowedOrigin(req: Request): boolean {
  const origin = requestOrigin(req);
  return Boolean(origin) && allowedOrigins().has(origin);
}

export function corsHeaders(req: Request): HeadersInit {
  const origin = requestOrigin(req);
  return {
    "Access-Control-Allow-Origin": allowedOrigins().has(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

export function jsonResponse(
  req: Request,
  body: Record<string, unknown>,
  status = 200
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export function preflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  if (!isAllowedOrigin(req)) return jsonResponse(req, { error: "Origin not allowed." }, 403);
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export function bearerToken(req: Request): string {
  const value = req.headers.get("authorization") || "";
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : "";
}

export async function authenticateStaff(
  req: Request,
  requiredRole?: "owner"
): Promise<{ client: SupabaseClient; profile: StaffProfile } | { error: Response }> {
  const token = bearerToken(req);
  if (!token) return { error: jsonResponse(req, { error: "Sign in required." }, 401) };

  const client = adminClient();
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) {
    return { error: jsonResponse(req, { error: "Your session is no longer valid." }, 401) };
  }

  const { data: profile, error: profileError } = await client
    .from("staff_profiles")
    .select("user_id,email,display_name,role,active")
    .eq("user_id", userData.user.id)
    .maybeSingle<StaffProfile>();

  if (profileError || !profile || !profile.active) {
    return { error: jsonResponse(req, { error: "This staff account is inactive." }, 403) };
  }

  if (requiredRole && profile.role !== requiredRole) {
    return { error: jsonResponse(req, { error: "Owner access required." }, 403) };
  }

  return { client, profile };
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown")
    .split(",")[0]
    .trim();
}

export async function hmacSha256(value: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function cleanSearch(value: unknown): string {
  return String(value || "")
    .trim()
    .slice(0, 80)
    .replace(/[^\p{L}\p{N}\s+'-]/gu, "");
}
