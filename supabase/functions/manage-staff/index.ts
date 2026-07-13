import {
  authenticateStaff,
  isAllowedOrigin,
  jsonResponse,
  preflight,
  requestOrigin
} from "../_shared/common.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  if (!isAllowedOrigin(req)) return jsonResponse(req, { error: "Origin not allowed." }, 403);
  if (req.method !== "POST") return jsonResponse(req, { error: "Method not allowed." }, 405);

  const auth = await authenticateStaff(req, "owner");
  if ("error" in auth) return auth.error;

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(req, { error: "Invalid request body." }, 400);
  }

  const action = String(payload.action || "");
  if (action === "invite") {
    const email = String(payload.email || "").trim().toLowerCase();
    const displayName = String(payload.displayName || "").trim();
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      return jsonResponse(req, { error: "Enter a valid staff email address." }, 400);
    }
    if (!displayName || displayName.length > 100) {
      return jsonResponse(req, { error: "Enter a staff name up to 100 characters." }, 400);
    }

    const redirectTo = (Deno.env.get("STAFF_REDIRECT_URL") || `${requestOrigin(req)}/staff/`).trim();
    const { data, error } = await auth.client.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { display_name: displayName }
    });
    if (error || !data.user) {
      return jsonResponse(req, { error: error?.message || "The invitation could not be sent." }, 400);
    }

    const { error: profileError } = await auth.client.from("staff_profiles").upsert({
      user_id: data.user.id,
      email,
      display_name: displayName,
      role: "staff",
      active: true
    });
    if (profileError) {
      console.error("manage-staff profile upsert failed", profileError.code);
      return jsonResponse(req, { error: "The account was invited, but its staff profile needs attention." }, 500);
    }

    await auth.client.from("activity_log").insert({
      action: "staff_invited",
      actor_user_id: auth.profile.user_id,
      target_user_id: data.user.id,
      metadata: { role: "staff" }
    });

    return jsonResponse(req, { ok: true, userId: data.user.id }, 201);
  }

  if (action === "deactivate" || action === "reactivate") {
    const userId = String(payload.userId || "");
    if (!UUID_PATTERN.test(userId) || userId === auth.profile.user_id) {
      return jsonResponse(req, { error: "Choose a valid staff account." }, 400);
    }

    const { data: target } = await auth.client
      .from("staff_profiles")
      .select("user_id,role,active")
      .eq("user_id", userId)
      .maybeSingle();
    if (!target || target.role !== "staff") {
      return jsonResponse(req, { error: "Only staff accounts can be changed here." }, 400);
    }

    const active = action === "reactivate";
    const { error } = await auth.client
      .from("staff_profiles")
      .update({ active })
      .eq("user_id", userId);
    if (error) return jsonResponse(req, { error: "The staff account could not be updated." }, 500);

    await auth.client.from("activity_log").insert({
      action: active ? "staff_reactivated" : "staff_deactivated",
      actor_user_id: auth.profile.user_id,
      target_user_id: userId,
      metadata: { role: "staff" }
    });

    return jsonResponse(req, { ok: true });
  }

  return jsonResponse(req, { error: "Unsupported staff action." }, 400);
});
