import {
  authenticateStaff,
  isAllowedOrigin,
  jsonResponse,
  preflight
} from "../_shared/common.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const SOURCES = new Set(["messenger", "phone", "walk_in"]);
const CONTACT_ROUTES = new Set(["messenger", "phone", "in_person"]);
const INQUIRIES = new Set(["table", "private", "catering"]);
const REPLY_CHANNELS = new Set(["messenger", "phone", "sms", "in_person"]);
const STATUSES = new Set(["pending", "confirmed", "rejected", "completed", "cancelled"]);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function manilaDate(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function validDate(value: string): boolean {
  return DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function reference(date: string): string {
  const random = crypto.getRandomValues(new Uint8Array(4));
  const suffix = Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `YAE-${date.replaceAll("-", "")}-${suffix}`;
}

function replyTime(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp) || timestamp > Date.now() + 10 * 60_000) return null;
  return new Date(timestamp).toISOString();
}

function validateCreate(payload: Record<string, unknown>): {
  value?: Record<string, unknown>;
  fields?: Record<string, string>;
} {
  const inquiryType = text(payload.inquiryType);
  const name = text(payload.name);
  const source = text(payload.source);
  const contactRoute = text(payload.contactRoute);
  const contactNumber = text(payload.contactNumber);
  const messengerName = text(payload.messengerName);
  const date = text(payload.date);
  const time = text(payload.time);
  const occasion = text(payload.occasion);
  const notes = text(payload.notes);
  const followUpNotes = text(payload.followUpNotes);
  const guestCount = Number(payload.guestCount);
  const fields: Record<string, string> = {};

  if (!INQUIRIES.has(inquiryType)) fields.inquiryType = "Choose table, private gathering, or catering.";
  if (!name || name.length > 100) fields.name = "Enter a name up to 100 characters.";
  if (!SOURCES.has(source)) fields.source = "Choose Messenger, phone, or walk-in.";
  if (!CONTACT_ROUTES.has(contactRoute)) fields.contactRoute = "Choose a contact route.";
  if (contactRoute === "phone" && !contactNumber) fields.contactNumber = "Enter a phone number for phone follow-up.";
  if (contactNumber.length > 30) fields.contactNumber = "Keep the phone number within 30 characters.";
  if (contactRoute === "messenger" && !messengerName) fields.messengerName = "Enter the Messenger contact name.";
  if (messengerName.length > 100) fields.messengerName = "Keep the Messenger name within 100 characters.";
  if (!validDate(date) || date < manilaDate()) fields.date = "Choose today or a future date.";
  if (!TIME_PATTERN.test(time)) fields.time = "Choose a valid time.";
  if (!Number.isSafeInteger(guestCount) || guestCount < 1 || guestCount > 2147483647) {
    fields.guestCount = "Enter a valid positive guest count.";
  }
  if (occasion.length > 100) fields.occasion = "Keep the occasion within 100 characters.";
  if (notes.length > 1000) fields.notes = "Keep notes within 1,000 characters.";
  if (followUpNotes.length > 1000) fields.followUpNotes = "Keep follow-up notes within 1,000 characters.";
  if (Object.keys(fields).length) return { fields };

  return { value: {
    submission_id: crypto.randomUUID(),
    inquiry_type: inquiryType,
    customer_name: name,
    source,
    contact_route: contactRoute,
    contact_number: contactNumber || null,
    messenger_name: messengerName || null,
    requested_date: date,
    requested_time: time,
    guest_count: guestCount,
    occasion: occasion || null,
    notes: notes || null,
    follow_up_notes: followUpNotes || null
  } };
}

function validReply(payload: Record<string, unknown>, required: boolean): {
  value?: { channel: string | null; repliedAt: string | null; note: string | null };
  error?: string;
} {
  const channel = text(payload.replyChannel);
  const rawTime = text(payload.repliedAt);
  const note = text(payload.replyNote);
  if (required || channel || rawTime) {
    if (!REPLY_CHANNELS.has(channel) || !replyTime(rawTime)) {
      return { error: "Record how and when you informed the customer." };
    }
  }
  if (note.length > 500) return { error: "Keep the reply note within 500 characters." };
  return { value: { channel: channel || null, repliedAt: rawTime ? replyTime(rawTime) : null, note: note || null } };
}

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  if (!isAllowedOrigin(req)) return jsonResponse(req, { error: "Origin not allowed." }, 403);
  if (req.method !== "POST") return jsonResponse(req, { error: "Method not allowed." }, 405);
  const auth = await authenticateStaff(req);
  if ("error" in auth) return auth.error;

  if (Number(req.headers.get("content-length") || 0) > 12000) {
    return jsonResponse(req, { error: "Request is too large." }, 413);
  }
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid body");
  } catch {
    return jsonResponse(req, { error: "Invalid request body." }, 400);
  }

  const action = text(payload.action);
  if (action === "create") {
    const validated = validateCreate(payload);
    if (!validated.value) return jsonResponse(req, {
      error: "Please correct the highlighted fields.", fields: validated.fields || {}
    }, 400);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { data, error } = await auth.client.from("bookings")
        .insert({ ...validated.value, reference: reference(String(validated.value.requested_date)), created_by: auth.profile.user_id })
        .select("*").single();
      if (!error) return jsonResponse(req, { booking: data }, 201);
      if (error.code !== "23505") {
        console.error("manage-booking create failed", error.code);
        return jsonResponse(req, { error: "The request could not be saved." }, 500);
      }
    }
    return jsonResponse(req, { error: "Please try saving this request again." }, 503);
  }

  const bookingId = text(payload.bookingId);
  if (!UUID_PATTERN.test(bookingId)) return jsonResponse(req, { error: "Choose a valid booking." }, 400);

  if (action === "recordReply") {
    const reply = validReply(payload, true);
    if (!reply.value) return jsonResponse(req, { error: reply.error || "Invalid reply." }, 400);
    const { data: booking, error: lookupError } = await auth.client.from("bookings")
      .select("id,created_at,anonymized_at").eq("id", bookingId).maybeSingle();
    if (lookupError) return jsonResponse(req, { error: "The booking could not be loaded." }, 500);
    if (!booking) return jsonResponse(req, { error: "Booking not found." }, 404);
    if (booking.anonymized_at) return jsonResponse(req, { error: "This booking has been anonymized." }, 400);
    if (Date.parse(reply.value.repliedAt!) < Date.parse(booking.created_at) - 30 * 86400_000) {
      return jsonResponse(req, { error: "Reply time is outside this request." }, 400);
    }
    const { data, error } = await auth.client.from("booking_replies")
      .insert({
        booking_id: bookingId,
        actor_user_id: auth.profile.user_id,
        channel: reply.value.channel,
        replied_at: reply.value.repliedAt,
        note: reply.value.note
      }).select("*").single();
    if (error) {
      console.error("manage-booking reply failed", error.code);
      return jsonResponse(req, { error: "The reply could not be recorded." }, 500);
    }
    return jsonResponse(req, { reply: data }, 201);
  }

  const expectedUpdatedAt = text(payload.expectedUpdatedAt);
  if (!expectedUpdatedAt || Number.isNaN(Date.parse(expectedUpdatedAt))) {
    return jsonResponse(req, { error: "Refresh this booking before saving." }, 400);
  }

  if (action === "setStatus") {
    const status = text(payload.status);
    if (!STATUSES.has(status)) return jsonResponse(req, { error: "Choose a valid status." }, 400);
    const reply = validReply(payload, status === "confirmed" || status === "rejected");
    if (!reply.value) return jsonResponse(req, { error: reply.error || "Invalid reply." }, 400);
    const { data, error } = await auth.client.rpc("transition_booking", {
      p_booking_id: bookingId,
      p_expected_updated_at: expectedUpdatedAt,
      p_status: status,
      p_actor_user_id: auth.profile.user_id,
      p_reply_channel: reply.value.channel,
      p_replied_at: reply.value.repliedAt,
      p_reply_note: reply.value.note
    });
    if (error) {
      if (error.code === "40001") return jsonResponse(req, { error: "Another staff member changed this booking. Refresh it and try again." }, 409);
      if (error.code === "P0002") return jsonResponse(req, { error: "Booking not found." }, 404);
      if (error.code === "22023") return jsonResponse(req, { error: error.message }, 400);
      if (error.code === "42501") return jsonResponse(req, { error: "Active staff access required." }, 403);
      console.error("manage-booking status failed", error.code);
      return jsonResponse(req, { error: "The status could not be saved." }, 500);
    }
    return jsonResponse(req, { booking: data });
  }

  if (action === "saveFollowUp") {
    const followUpNotes = text(payload.followUpNotes);
    if (followUpNotes.length > 1000) {
      return jsonResponse(req, { error: "Keep follow-up notes within 1,000 characters." }, 400);
    }
    const { data, error } = await auth.client.from("bookings")
      .update({ follow_up_notes: followUpNotes || null, updated_by: auth.profile.user_id })
      .eq("id", bookingId).eq("updated_at", expectedUpdatedAt).is("anonymized_at", null)
      .select("*").maybeSingle();
    if (error) {
      console.error("manage-booking follow-up failed", error.code);
      return jsonResponse(req, { error: "Follow-up notes could not be saved." }, 500);
    }
    if (!data) return jsonResponse(req, { error: "Another staff member changed this booking. Refresh it and try again." }, 409);
    return jsonResponse(req, { booking: data });
  }

  return jsonResponse(req, { error: "Unsupported booking action." }, 400);
});
