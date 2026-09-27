import {
  adminClient,
  clientIp,
  hmacSha256,
  isAllowedOrigin,
  jsonResponse,
  preflight,
  requestOrigin
} from "../_shared/common.ts";

const INQUIRY_TYPES = new Set(["table", "private", "catering"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

type BookingInput = {
  submissionId?: unknown;
  inquiryType?: unknown;
  name?: unknown;
  contactNumber?: unknown;
  date?: unknown;
  time?: unknown;
  guestCount?: unknown;
  occasion?: unknown;
  notes?: unknown;
  turnstileToken?: unknown;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function manilaDate(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function validate(payload: BookingInput): { value?: Record<string, unknown>; fields?: Record<string, string> } {
  const submissionId = text(payload.submissionId);
  const inquiryType = text(payload.inquiryType);
  const name = text(payload.name);
  const contactNumber = text(payload.contactNumber);
  const date = text(payload.date);
  const time = text(payload.time);
  const occasion = text(payload.occasion);
  const notes = text(payload.notes);
  const guestCount = Number(payload.guestCount);
  const fields: Record<string, string> = {};

  if (!UUID_PATTERN.test(submissionId)) fields.submissionId = "Invalid submission identifier.";
  if (!INQUIRY_TYPES.has(inquiryType)) fields.inquiryType = "Choose a valid inquiry type.";
  if (!name || name.length > 100) fields.name = "Enter a name up to 100 characters.";
  if (!contactNumber || contactNumber.length > 30) fields.contactNumber = "Enter a contact number up to 30 characters.";
  if (!DATE_PATTERN.test(date) || date < manilaDate()) fields.date = "Choose today or a future date.";
  if (!TIME_PATTERN.test(time)) fields.time = "Choose a valid time.";
  if (!Number.isSafeInteger(guestCount) || guestCount < 1 || guestCount > 2147483647) {
    fields.guestCount = "Enter a valid positive guest count.";
  }
  if (occasion.length > 100) fields.occasion = "Keep the occasion within 100 characters.";
  if (notes.length > 1000) fields.notes = "Keep notes within 1,000 characters.";

  if (Object.keys(fields).length) return { fields };
  return {
    value: {
      submission_id: submissionId,
      inquiry_type: inquiryType,
      customer_name: name,
      contact_number: contactNumber,
      source: "web",
      contact_route: "phone",
      requested_date: date,
      requested_time: time,
      guest_count: guestCount,
      occasion: occasion || null,
      notes: notes || null
    }
  };
}

async function verifyTurnstile(req: Request, token: string): Promise<boolean> {
  const secret = (Deno.env.get("TURNSTILE_SECRET_KEY") || "").trim();
  const localBypass = (Deno.env.get("ALLOW_INSECURE_LOCAL_DEV") || "") === "true"
    && requestOrigin(req).startsWith("http://")
    && token === "local-development";
  if (localBypass) return true;
  if (!secret || !token) return false;

  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  body.append("remoteip", clientIp(req));

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body
  });
  if (!response.ok) return false;
  const result = await response.json() as { success?: boolean; action?: string; hostname?: string };
  const originHost = new URL(requestOrigin(req)).hostname;
  return result.success === true
    && result.action === "booking_request"
    && result.hostname === originHost;
}

function bookingReference(date: string): string {
  const random = crypto.getRandomValues(new Uint8Array(4));
  const suffix = Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `YAE-${date.replaceAll("-", "")}-${suffix}`;
}

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  if (!isAllowedOrigin(req)) return jsonResponse(req, { error: "Origin not allowed." }, 403);
  if (req.method !== "POST") return jsonResponse(req, { error: "Method not allowed." }, 405);

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 12000) return jsonResponse(req, { error: "Request is too large." }, 413);

  let payload: BookingInput;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(req, { error: "Invalid request body." }, 400);
  }

  const validated = validate(payload);
  if (!validated.value) {
    return jsonResponse(req, {
      error: "Please correct the highlighted fields.",
      fields: validated.fields || {}
    }, 400);
  }

  const client = adminClient();
  const submissionId = String(validated.value.submission_id);
  const { data: existing } = await client
    .from("bookings")
    .select("reference,status,created_at")
    .eq("submission_id", submissionId)
    .maybeSingle();

  if (existing) {
    return jsonResponse(req, {
      reference: existing.reference,
      status: existing.status,
      receivedAt: existing.created_at
    });
  }

  if (!await verifyTurnstile(req, text(payload.turnstileToken))) {
    return jsonResponse(req, { error: "Please complete the security check and try again." }, 403);
  }

  const rateSecret = (Deno.env.get("RATE_LIMIT_SECRET") || "").trim();
  if (!rateSecret) return jsonResponse(req, { error: "Booking service is not configured." }, 503);
  const ipHash = await hmacSha256(clientIp(req), rateSecret);
  const { data: allowed, error: rateError } = await client.rpc("consume_submission_quota", {
    p_ip_hash: ipHash
  });
  if (rateError) return jsonResponse(req, { error: "Booking service is temporarily unavailable." }, 503);
  if (!allowed) return jsonResponse(req, { error: "Too many attempts. Please wait 15 minutes and try again." }, 429);

  const reference = bookingReference(String(validated.value.requested_date));
  const { data: booking, error: insertError } = await client
    .from("bookings")
    .insert({ ...validated.value, reference })
    .select("reference,status,created_at")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      const { data: duplicate } = await client
        .from("bookings")
        .select("reference,status,created_at")
        .eq("submission_id", submissionId)
        .maybeSingle();
      if (duplicate) {
        return jsonResponse(req, {
          reference: duplicate.reference,
          status: duplicate.status,
          receivedAt: duplicate.created_at
        });
      }
    }
    console.error("submit-booking insert failed", insertError.code);
    return jsonResponse(req, { error: "We could not save this request. Please try again or contact Yaelitos directly." }, 500);
  }

  return jsonResponse(req, {
    reference: booking.reference,
    status: booking.status,
    receivedAt: booking.created_at
  }, 201);
});
