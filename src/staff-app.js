import { createClient } from "@supabase/supabase-js";

const config = window.YAELITOS_APP_CONFIG || {};
const supabaseUrl = String(config.supabaseUrl || "").replace(/\/$/, "");
const publishableKey = String(config.supabasePublishableKey || "").trim();
const configured = Boolean(supabaseUrl && publishableKey);
const initialAuthType = new URLSearchParams(location.hash.slice(1)).get("type")
  || new URLSearchParams(location.search).get("type");
let requiresPasswordSetup = ["invite", "recovery"].includes(initialAuthType);
const supabase = configured ? createClient(supabaseUrl, publishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
}) : null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const authScreen = $("[data-auth-screen]");
const dashboard = $("[data-dashboard]");
const dialog = $("[data-booking-dialog]");
const manualDialog = $("[data-manual-dialog]");
const PAGE_SIZE = 25;
const STATUSES = ["pending", "confirmed", "rejected", "completed", "cancelled"];
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const BOOKING_FIELDS = "id,reference,inquiry_type,customer_name,contact_number,messenger_name,source,contact_route,follow_up_notes,requested_date,requested_time,guest_count,occasion,notes,status,created_at,updated_at,anonymized_at";
const state = {
  session: null,
  profile: null,
  page: 0,
  total: 0,
  selectedBooking: null,
  view: "needs-reply",
  filters: { search: "", status: "", dateFrom: "", dateTo: "" },
  idleTimer: null,
  lastActivityWrite: 0,
  team: [],
  content: null
};

function today() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function manilaDateTimeLocal(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

function cleanSearch(value) {
  return String(value || "").trim().slice(0, 80).replace(/[^\p{L}\p{N}\s+'-]/gu, "");
}

function setStatus(element, message, type = "info") {
  if (!element) return;
  element.textContent = message;
  element.dataset.status = type;
  element.classList.toggle("show", Boolean(message));
}

function formatDate(value) {
  if (!value) return "—";
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("en-PH", {
    year: "numeric", month: "short", day: "numeric"
  }).format(parsed);
}

function formatTime(value) {
  if (!value) return "—";
  const parsed = new Date(`2000-01-01T${value}`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("en-PH", {
    hour: "numeric", minute: "2-digit"
  }).format(parsed);
}

function formatTimestamp(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
  }).format(new Date(value));
}

function statusPill(status) {
  return `<span class="status-pill status-${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function safePhone(number) {
  const cleaned = String(number || "").replace(/[^\d+]/g, "");
  return /^\+?\d{7,15}$/.test(cleaned) ? cleaned : "";
}

async function invokeEdge(name, body) {
  const { data: authData } = await supabase.auth.getSession();
  if (!authData.session) throw new Error("Session expired. Sign in again.");
  let response;
  try {
    response = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": publishableKey,
        "Authorization": `Bearer ${authData.session.access_token}`
      },
      body: JSON.stringify(body)
    });
  } catch {
    throw new Error("Connection failed. Check the internet and try again.");
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fieldDetails = result.fields && typeof result.fields === "object" ? Object.values(result.fields).join(" ") : "";
    const error = new Error(`${result.error || `Request failed (${response.status}).`}${fieldDetails ? ` ${fieldDetails}` : ""}`);
    error.status = response.status;
    throw error;
  }
  return result;
}

function showAuthPanel(name) {
  $$("[data-login-panel],[data-recovery-panel],[data-password-panel]").forEach((panel) => { panel.hidden = true; });
  const target = $(`[data-${name}-panel]`);
  if (target) target.hidden = false;
  authScreen.hidden = false;
  dashboard.hidden = true;
}

function isPasswordFlow() {
  return requiresPasswordSetup;
}

async function loadProfile() {
  const { data, error } = await supabase
    .from("staff_profiles")
    .select("user_id,email,display_name,role,active")
    .eq("user_id", state.session.user.id)
    .maybeSingle();
  if (error || !data || !data.active) throw new Error("This account does not have active staff access.");
  state.profile = data;
}

function startIdleTimer() {
  clearTimeout(state.idleTimer);
  const minutes = Number(config.idleMinutes || 30);
  const duration = Math.max(1, minutes) * 60 * 1000;
  const lastActivity = Number(localStorage.getItem("yaelitosStaffLastActivity") || Date.now());
  const remaining = duration - (Date.now() - lastActivity);
  if (remaining <= 0) {
    idleSignOut();
    return;
  }
  state.idleTimer = setTimeout(idleSignOut, remaining);
}

function recordActivity() {
  if (!state.session) return;
  const now = Date.now();
  if (now - state.lastActivityWrite > 30000) {
    localStorage.setItem("yaelitosStaffLastActivity", String(now));
    state.lastActivityWrite = now;
  }
  startIdleTimer();
}

async function idleSignOut() {
  if (!state.session) return;
  await supabase.auth.signOut({ scope: "local" });
  resetDashboard();
  showAuthPanel("login");
  setStatus($("[data-login-status]"), "You were signed out after 30 minutes of inactivity.", "info");
}

function resetDashboard() {
  state.session = null;
  state.profile = null;
  state.selectedBooking = null;
  clearTimeout(state.idleTimer);
  localStorage.removeItem("yaelitosStaffLastActivity");
}

async function enterDashboard(session) {
  state.session = session;
  await loadProfile();
  if (isPasswordFlow()) {
    showAuthPanel("password");
    return;
  }

  authScreen.hidden = true;
  dashboard.hidden = false;
  $("[data-staff-name]").textContent = state.profile.display_name;
  $("[data-staff-role]").textContent = state.profile.role;
  $$('[data-owner-only]').forEach((element) => { element.hidden = state.profile.role !== "owner"; });
  localStorage.setItem("yaelitosStaffLastActivity", String(Date.now()));
  startIdleTimer();
  await Promise.all([loadBookings(), loadCounts()]);
}

function applyBookingFilters(query) {
  const { search, status, dateFrom, dateTo } = state.filters;
  if (state.view === "needs-reply") query = query.eq("status", "pending");
  if (state.view === "today") query = query.eq("requested_date", today());
  if (state.view === "upcoming") query = query.gt("requested_date", today()).in("status", ["pending", "confirmed"]);
  if (status && state.view === "all") query = query.eq("status", status);
  if (dateFrom) query = query.gte("requested_date", dateFrom);
  if (dateTo) query = query.lte("requested_date", dateTo);
  const cleaned = cleanSearch(search);
  if (cleaned) {
    const term = `%${cleaned}%`;
    query = query.or(`reference.ilike.${term},customer_name.ilike.${term},contact_number.ilike.${term},messenger_name.ilike.${term}`);
  }
  return query;
}

async function loadBookings() {
  const status = $("[data-bookings-status]");
  setStatus(status, "Loading bookings...", "info");
  let query = supabase
    .from("bookings")
    .select(BOOKING_FIELDS, { count: "exact" })
    .order("requested_date", { ascending: true })
    .order("requested_time", { ascending: true })
    .range(state.page * PAGE_SIZE, state.page * PAGE_SIZE + PAGE_SIZE - 1);
  query = applyBookingFilters(query);
  const { data, error, count } = await query;
  if (error) {
    setStatus(status, "Bookings could not be loaded. Refresh or sign in again.", "error");
    return;
  }
  state.total = count || 0;
  renderBookings(data || []);
  const totalPages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
  $("[data-page-label]").textContent = `Page ${state.page + 1} of ${totalPages} · ${state.total} record${state.total === 1 ? "" : "s"}`;
  $("[data-page-prev]").disabled = state.page === 0;
  $("[data-page-next]").disabled = state.page + 1 >= totalPages;
  setStatus(status, "", "info");
}

function renderBookings(bookings) {
  const rows = $("[data-booking-rows]");
  const cards = $("[data-booking-cards]");
  rows.innerHTML = bookings.map((booking) => `
    <tr>
      <td><strong>${escapeHtml(booking.reference)}</strong><small>${escapeHtml(booking.inquiry_type)} · ${escapeHtml(sourceLabel(booking.source))}</small></td>
      <td><strong>${escapeHtml(booking.customer_name || "Anonymized")}</strong><small>${escapeHtml(booking.contact_number || booking.messenger_name || "No retained contact")}</small></td>
      <td><strong>${escapeHtml(formatDate(booking.requested_date))}</strong><small>${escapeHtml(formatTime(booking.requested_time))}</small></td>
      <td>${escapeHtml(booking.guest_count)}</td>
      <td>${statusPill(booking.status)} ${isOverdue(booking) ? '<span class="overdue-label">Date passed</span>' : ""}</td>
      <td><button class="button button-secondary button-small" type="button" data-open-booking="${escapeHtml(booking.id)}">Open</button></td>
    </tr>`).join("");
  cards.innerHTML = bookings.map((booking) => `
    <article class="booking-card">
      <div class="booking-card-head"><div><strong>${escapeHtml(booking.reference)}</strong><small>${escapeHtml(booking.inquiry_type)} · ${escapeHtml(sourceLabel(booking.source))}</small></div>${statusPill(booking.status)}</div>
      <p><strong>${escapeHtml(booking.customer_name || "Anonymized")}</strong><br>${escapeHtml(formatDate(booking.requested_date))} at ${escapeHtml(formatTime(booking.requested_time))} · ${escapeHtml(booking.guest_count)} guest${booking.guest_count === 1 ? "" : "s"}</p>
      ${isOverdue(booking) ? '<span class="overdue-label">Date passed · reply needed</span>' : ""}
      <button class="button button-secondary" type="button" data-open-booking="${escapeHtml(booking.id)}">Open details</button>
    </article>`).join("");
  $("[data-booking-empty]").hidden = bookings.length > 0;
}

async function loadCounts() {
  const current = today();
  const base = () => supabase.from("bookings").select("id", { count: "exact", head: true });
  const [pending, todayResult, upcoming] = await Promise.all([
    base().eq("status", "pending"),
    base().eq("requested_date", current),
    base().gt("requested_date", current).in("status", ["pending", "confirmed"])
  ]);
  $("[data-count-pending]").textContent = pending.count ?? "—";
  $("[data-count-today]").textContent = todayResult.count ?? "—";
  $("[data-count-upcoming]").textContent = upcoming.count ?? "—";
}

function isOverdue(booking) {
  if (booking.status !== "pending") return false;
  if (booking.requested_date < today()) return true;
  if (booking.requested_date > today()) return false;
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).format(new Date());
  return String(booking.requested_time || "").slice(0, 5) < clock;
}

function sourceLabel(source) {
  return ({ web: "Website", messenger: "Messenger", phone: "Phone", walk_in: "Walk-in" })[source] || "Website";
}

async function openBooking(id) {
  const { data: booking, error } = await supabase
    .from("bookings")
    .select(BOOKING_FIELDS)
    .eq("id", id)
    .maybeSingle();
  if (error || !booking) {
    setStatus($("[data-bookings-status]"), "That booking could not be opened.", "error");
    return;
  }
  state.selectedBooking = booking;
  const [{ data: history }, { data: replies }] = await Promise.all([
    supabase.from("activity_log").select("id,action,actor_user_id,old_status,new_status,created_at").eq("booking_id", id).order("created_at", { ascending: false }),
    supabase.from("booking_replies").select("id,channel,replied_at,note,created_at").eq("booking_id", id).order("replied_at", { ascending: false })
  ]);
  renderBookingDetail(booking, history || [], replies || []);
  dialog.showModal();
}

function renderBookingDetail(booking, history, replies) {
  const anonymized = Boolean(booking.anonymized_at);
  const phone = safePhone(booking.contact_number);
  const messengerUrl = window.YAELITOS_CONFIG?.facebook?.messengerUrl;
  const replyDefault = manilaDateTimeLocal();
  $("[data-booking-detail]").innerHTML = `
    <div class="detail-shell">
      <header class="detail-header"><p class="detail-reference">${escapeHtml(booking.reference)}</p><h1>${escapeHtml(booking.customer_name || "Anonymized booking")}</h1>${statusPill(booking.status)}</header>
      ${anonymized ? '<p class="overdue-banner">Customer details have been anonymized. This record can no longer be edited.</p>' : ""}
      ${isOverdue(booking) ? '<p class="overdue-banner">The requested date has passed and this request still needs a reply. Contact the customer before recording an outcome.</p>' : ""}
      <div class="detail-grid">
        <div><span>Phone</span><strong>${escapeHtml(booking.contact_number || (anonymized ? "Removed after anonymization" : "No phone recorded"))}</strong></div>
        <div><span>Messenger name</span><strong>${escapeHtml(booking.messenger_name || "Not provided")}</strong></div>
        <div><span>Source</span><strong>${escapeHtml(sourceLabel(booking.source))}</strong></div>
        <div><span>Contact route</span><strong>${escapeHtml(booking.contact_route || "Phone")}</strong></div>
        <div><span>Inquiry</span><strong>${escapeHtml(booking.inquiry_type)}</strong></div>
        <div><span>Date</span><strong>${escapeHtml(formatDate(booking.requested_date))}</strong></div>
        <div><span>Time</span><strong>${escapeHtml(formatTime(booking.requested_time))}</strong></div>
        <div><span>Guests</span><strong>${escapeHtml(booking.guest_count)}</strong></div>
        <div><span>Occasion</span><strong>${escapeHtml(booking.occasion || "Not provided")}</strong></div>
        <div class="detail-full"><span>Notes</span><strong>${escapeHtml(booking.notes || "No notes")}</strong></div>
        <div class="detail-full"><span>Received</span><strong>${escapeHtml(formatTimestamp(booking.created_at))}</strong></div>
      </div>
      <div class="contact-actions" aria-label="Contact customer">
        ${phone ? `<a class="button button-secondary button-small" href="tel:${escapeHtml(phone)}">Call customer</a><a class="button button-secondary button-small" href="sms:${escapeHtml(phone)}">Send SMS</a>` : ""}
        ${booking.contact_route === "messenger" && messengerUrl ? `<a class="button button-secondary button-small" href="${escapeHtml(messengerUrl)}" target="_blank" rel="noopener noreferrer">Open restaurant Messenger inbox ↗</a>` : ""}
        ${!phone && booking.contact_route !== "messenger" ? "<p>No phone contact recorded. Use the route shown above.</p>" : ""}
      </div>
      <form class="follow-up-form" data-follow-up-form>
        <h2>Internal follow-up</h2><p>Only staff can see this note.</p>
        <label>Next action or question<textarea name="followUpNotes" maxlength="1000">${escapeHtml(booking.follow_up_notes || "")}</textarea></label>
        <button class="button button-secondary button-small" type="submit">Save follow-up note</button>
        <p class="status" data-follow-up-status role="status" aria-live="polite"></p>
      </form>
      <section class="reply-section"><h2>Customer replies</h2>
        <form data-reply-form>
          <div class="form-grid">
            <label>How did you reply?<select name="replyChannel" required><option value="">Choose a channel</option><option value="phone">Phone call</option><option value="sms">SMS</option><option value="messenger">Messenger</option><option value="in_person">In person</option></select></label>
            <label>When did you reply? (Philippine time)<input name="repliedAt" type="datetime-local" value="${replyDefault}" required></label>
            <label class="form-full">Brief reply note (optional)<input name="replyNote" maxlength="500" placeholder="What did the customer say?"></label>
          </div>
          <button class="button button-secondary button-small" type="submit">Log reply only</button>
          <p class="status" data-reply-status role="status" aria-live="polite"></p>
        </form>
        <div class="reply-list">${replies.length ? replies.map((item) => `<div class="history-item"><p>${escapeHtml(item.channel.replaceAll("_", " "))} · ${escapeHtml(item.note || "Reply recorded")}</p><small>${escapeHtml(formatTimestamp(item.replied_at))}</small></div>`).join("") : "<p>No reply recorded yet.</p>"}</div>
      </section>
      <form class="detail-controls" data-status-form>
        <h2>Record outcome</h2><p>For Confirmed or Rejected, record how and when you informed the customer.</p>
        <label>Booking status<select name="status">${STATUSES.map((status) => `<option value="${status}"${status === booking.status ? " selected" : ""}>${status[0].toUpperCase() + status.slice(1)}</option>`).join("")}</select></label>
        <div class="form-grid" data-outcome-reply>
          <label>Reply channel<select name="replyChannel"><option value="">Choose a channel</option><option value="phone">Phone call</option><option value="sms">SMS</option><option value="messenger">Messenger</option><option value="in_person">In person</option></select></label>
          <label>When customer was informed (Philippine time)<input name="repliedAt" type="datetime-local" value="${replyDefault}"></label>
          <label class="form-full">Reply note (optional)<input name="replyNote" maxlength="500"></label>
        </div>
        <button class="button button-primary" type="submit">Save status</button>
      </form>
      <p class="status" data-detail-status role="status" aria-live="polite"></p>
      <section class="history"><h2>Request activity</h2>${history.length ? history.map((item) => `<div class="history-item"><p>${escapeHtml(activityText(item))}</p><small>${escapeHtml(formatTimestamp(item.created_at))}</small></div>`).join("") : "<p>No activity recorded.</p>"}</section>
      ${state.profile.role === "owner" && !anonymized ? `<div class="danger-zone"><h2>Privacy action</h2><p>Remove the customer's name, contact, occasion, and notes now. This cannot be undone.</p><button class="button button-danger" type="button" data-anonymize-booking>Anonymize customer details</button></div>` : ""}
    </div>`;

  if (anonymized) {
    for (const selector of [".contact-actions", "[data-follow-up-form]", "[data-reply-form]", "[data-status-form]"]) {
      $(selector, dialog).hidden = true;
    }
  }
  $("[data-status-form]", dialog)?.addEventListener("submit", updateBookingStatus);
  $("[data-status-form] select[name='status']", dialog)?.addEventListener("change", updateOutcomeFields);
  updateOutcomeFields();
  $("[data-reply-form]", dialog)?.addEventListener("submit", recordBookingReply);
  $("[data-follow-up-form]", dialog)?.addEventListener("submit", saveFollowUp);
  $("[data-anonymize-booking]", dialog)?.addEventListener("click", anonymizeSelectedBooking);
}

function activityText(item) {
  const label = String(item.action || "activity").replaceAll("_", " ");
  if (item.action === "booking_status_changed") return `Status changed from ${item.old_status} to ${item.new_status}.`;
  if (item.action === "booking_created") return "Pending request created.";
  if (item.action === "booking_reply_recorded") return "Customer reply recorded.";
  if (item.action === "booking_follow_up_updated") return "Internal follow-up updated.";
  if (item.action === "booking_anonymized") return "Customer details anonymized.";
  return `${label[0]?.toUpperCase() || ""}${label.slice(1)}.`;
}

async function updateBookingStatus(event) {
  event.preventDefault();
  const detailStatus = $("[data-detail-status]", dialog);
  const values = new FormData(event.currentTarget);
  const status = String(values.get("status") || "");
  if (!STATUSES.includes(status) || status === state.selectedBooking.status) {
    setStatus(detailStatus, status === state.selectedBooking.status ? "No status change was made." : "Choose a valid status.", "info");
    return;
  }
  let reply = {};
  if (["confirmed", "rejected"].includes(status)) {
    try { reply = readReplyFields(values); }
    catch (error) { setStatus(detailStatus, error.message, "error"); return; }
  }
  if (!confirm(`Change this booking from ${state.selectedBooking.status} to ${status}?`)) return;
  setStatus(detailStatus, "Saving status...", "info");
  const selected = state.selectedBooking;
  try {
    await invokeEdge("manage-booking", { action: "setStatus", bookingId: selected.id, expectedUpdatedAt: selected.updated_at, status, ...reply });
  } catch (error) {
    setStatus(detailStatus, error.status === 409 ? "Another staff member changed this request. Close and reopen it to see the latest record." : error.message, "error");
    return;
  }
  dialog.close();
  await Promise.all([loadBookings(), loadCounts()]);
  setStatus($("[data-bookings-status]"), `Request ${selected.reference} changed to ${status}.`, "success");
}

function updateOutcomeFields() {
  const form = $("[data-status-form]", dialog);
  if (!form) return;
  const required = ["confirmed", "rejected"].includes(form.elements.namedItem("status").value);
  $("[data-outcome-reply]", form).hidden = !required;
  form.elements.namedItem("replyChannel").required = required;
  form.elements.namedItem("repliedAt").required = required;
}

function readReplyFields(values) {
  const replyChannel = String(values.get("replyChannel") || "");
  const localTime = String(values.get("repliedAt") || "");
  const parsed = new Date(`${localTime}+08:00`);
  if (!["phone", "sms", "messenger", "in_person"].includes(replyChannel)) throw new Error("Choose how you replied to the customer.");
  if (!localTime || Number.isNaN(parsed.getTime()) || parsed.getTime() > Date.now() + 60000) throw new Error("Enter a valid reply time that has already passed.");
  return { replyChannel, repliedAt: parsed.toISOString(), replyNote: String(values.get("replyNote") || "").trim().slice(0, 500) };
}

async function recordBookingReply(event) {
  event.preventDefault();
  const status = $("[data-reply-status]", dialog);
  let reply;
  try { reply = readReplyFields(new FormData(event.currentTarget)); }
  catch (error) { setStatus(status, error.message, "error"); return; }
  setStatus(status, "Saving reply...", "info");
  try {
    await invokeEdge("manage-booking", { action: "recordReply", bookingId: state.selectedBooking.id, ...reply });
    const id = state.selectedBooking.id;
    dialog.close();
    await openBooking(id);
    setStatus($("[data-reply-status]", dialog), "Reply recorded.", "success");
  } catch (error) { setStatus(status, error.message, "error"); }
}

async function saveFollowUp(event) {
  event.preventDefault();
  const status = $("[data-follow-up-status]", dialog);
  setStatus(status, "Saving note...", "info");
  try {
    const result = await invokeEdge("manage-booking", {
      action: "saveFollowUp",
      bookingId: state.selectedBooking.id,
      expectedUpdatedAt: state.selectedBooking.updated_at,
      followUpNotes: String(new FormData(event.currentTarget).get("followUpNotes") || "").trim()
    });
    state.selectedBooking = result.booking;
    setStatus(status, "Follow-up note saved.", "success");
  } catch (error) {
    setStatus(status, error.status === 409 ? "Another staff member changed this request. Reopen it before saving." : error.message, "error");
  }
}

async function anonymizeSelectedBooking() {
  if (!confirm("Permanently remove this customer's identifying details? This cannot be undone.")) return;
  const detailStatus = $("[data-detail-status]", dialog);
  setStatus(detailStatus, "Anonymizing customer details...", "info");
  const { data, error } = await supabase.rpc("anonymize_booking", { p_booking_id: state.selectedBooking.id });
  if (error || !data) {
    setStatus(detailStatus, "The booking could not be anonymized.", "error");
    return;
  }
  dialog.close();
  await loadBookings();
  setStatus($("[data-bookings-status]"), "Customer details were anonymized.", "success");
}

async function loadTeam() {
  if (state.profile.role !== "owner") return;
  const { data, error } = await supabase
    .from("staff_profiles")
    .select("user_id,email,display_name,role,active,created_at")
    .order("role", { ascending: true })
    .order("display_name", { ascending: true });
  if (error) return;
  state.team = data || [];
  $("[data-team-list]").innerHTML = state.team.map((member) => `
    <div class="team-member"><div><strong>${escapeHtml(member.display_name)}</strong><span>${escapeHtml(member.email)} · ${escapeHtml(member.role)} · ${member.active ? "active" : "inactive"}</span></div>${member.role === "staff" ? `<button class="button ${member.active ? "button-danger" : "button-secondary"} button-small" type="button" data-team-action="${member.active ? "deactivate" : "reactivate"}" data-user-id="${escapeHtml(member.user_id)}">${member.active ? "Deactivate" : "Reactivate"}</button>` : ""}</div>`).join("");
}

async function manageStaff(action, userId) {
  const member = state.team.find((item) => item.user_id === userId);
  if (!member || !confirm(`${action === "deactivate" ? "Deactivate" : "Reactivate"} ${member.display_name}?`)) return;
  const { error } = await supabase.functions.invoke("manage-staff", { body: { action, userId } });
  if (error) {
    alert("The staff account could not be updated.");
    return;
  }
  await loadTeam();
}

async function loadActivity() {
  if (state.profile.role !== "owner") return;
  const { data, error } = await supabase
    .from("activity_log")
    .select("id,action,actor_user_id,booking_id,target_user_id,old_status,new_status,metadata,created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return;
  const names = new Map(state.team.map((member) => [member.user_id, member.display_name]));
  $("[data-activity-list]").innerHTML = (data || []).map((item) => `
    <div class="activity-item"><strong>${escapeHtml(activityText(item))}</strong><span>${escapeHtml(names.get(item.actor_user_id) || (item.actor_user_id ? "Staff member" : "System"))}</span><small>${escapeHtml(formatTimestamp(item.created_at))}</small></div>`).join("") || "<p>No activity recorded.</p>";
}

async function exportCsv() {
  const button = $("[data-export]");
  button.disabled = true;
  button.textContent = "Preparing...";
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const response = await fetch(`${supabaseUrl}/functions/v1/export-bookings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": publishableKey,
        "Authorization": `Bearer ${sessionData.session.access_token}`
      },
      body: JSON.stringify(state.filters)
    });
    if (!response.ok) throw new Error("Export failed");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `yaelitos-bookings-${today()}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch {
    setStatus($("[data-bookings-status]"), "The CSV export could not be prepared.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Export CSV";
  }
}

function switchTab(name) {
  if (["team", "activity", "content"].includes(name) && state.profile?.role !== "owner") return;
  $$('[data-tab]').forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
  $$('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== name; });
  if (name === "team") loadTeam();
  if (name === "activity") loadTeam().then(loadActivity);
  if (name === "content") loadContent();
}

function switchBookingView(view) {
  if (!["needs-reply", "today", "upcoming", "all"].includes(view)) return;
  state.view = view;
  state.page = 0;
  $("[data-filter-form]").reset();
  state.filters = { search: "", status: "", dateFrom: "", dateTo: "" };
  $$('[data-booking-view]').forEach((button) => {
    const active = button.dataset.bookingView === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const statusFilter = $("[data-filter-form] select[name='status']");
  statusFilter.disabled = view !== "all";
  return loadBookings();
}

function syncManualSource() {
  const form = $("[data-manual-form]");
  const source = form.elements.namedItem("source").value;
  $("[data-messenger-name]", form).hidden = source !== "messenger";
  $("[data-contact-number]", form).querySelector("input").required = source === "phone";
  $("[data-contact-number]", form).querySelector("input").placeholder = source === "phone" ? "Required for a phone request" : "Optional";
}

async function createManualBooking(event) {
  event.preventDefault();
  const status = $("[data-manual-status]", manualDialog);
  const values = new FormData(event.currentTarget);
  const source = String(values.get("source"));
  const name = String(values.get("name") || "").trim();
  const contactNumber = String(values.get("contactNumber") || "").trim();
  const messengerName = source === "messenger" ? String(values.get("messengerName") || "").trim() || name : "";
  const body = {
    action: "create",
    inquiryType: String(values.get("inquiryType")),
    name,
    source,
    contactRoute: ({ messenger: "messenger", phone: "phone", walk_in: "in_person" })[source],
    contactNumber,
    messengerName,
    date: String(values.get("date")),
    time: String(values.get("time")),
    guestCount: Number(values.get("guestCount")),
    occasion: String(values.get("occasion") || "").trim(),
    notes: String(values.get("notes") || "").trim(),
    followUpNotes: String(values.get("followUpNotes") || "").trim()
  };
  setStatus(status, "Saving Pending request...", "info");
  try {
    const result = await invokeEdge("manage-booking", body);
    event.currentTarget.reset();
    syncManualSource();
    manualDialog.close();
    await switchBookingView("needs-reply");
    await loadCounts();
    setStatus($("[data-bookings-status]"), `Pending request ${result.booking?.reference || ""} saved.`, "success");
  } catch (error) { setStatus(status, error.message, "error"); }
}

function menuItemHtml(item = {}) {
  return `<div class="menu-edit-item" data-menu-item>
    <label>Food name<input name="name" maxlength="100" value="${escapeHtml(item.name || "")}"></label>
    <label>Description<input name="description" maxlength="300" value="${escapeHtml(item.description || "")}"></label>
    <label>Price in pesos (optional)<input name="pricePesos" type="number" min="0.01" max="100000" step="0.01" value="${item.pricePesos == null ? "" : escapeHtml(item.pricePesos)}"></label>
    <label class="checkbox-label"><input name="available" type="checkbox" ${item.available !== false ? "checked" : ""}> Available</label>
    <button class="button button-secondary button-small" type="button" data-remove-menu-item>Remove item</button>
  </div>`;
}

function contentFormHtml(section, record) {
  const draft = record?.draft?.content || record?.published?.content;
  const publishedAt = record?.published?.published_at;
  const publishedLabel = publishedAt ? `Published ${formatTimestamp(publishedAt)}` : "Nothing published yet";
  const draftLabel = record?.draft?.updated_at ? `Draft saved ${formatTimestamp(record.draft.updated_at)}` : "No draft saved";
  let fields = "";
  if (section === "menu") {
    fields = `<p>Add only owner-approved names and prices. Incomplete drafts can be saved; publication requires complete item names.</p><div data-menu-items>${(draft?.items || []).map(menuItemHtml).join("")}</div><button class="button button-secondary button-small" type="button" data-add-menu-item>Add food item</button>`;
  } else if (section === "hours") {
    fields = `<p>Set each day. Mark a day closed, or enter both opening and closing times before publishing.</p><div class="hours-edit-list">${DAYS.map((day) => {
      const value = draft?.days?.find((entry) => entry.day === day) || {};
      return `<div class="hours-edit-day" data-hours-day="${day}"><strong>${day[0].toUpperCase() + day.slice(1)}</strong><label class="checkbox-label"><input name="closed" type="checkbox" ${value.closed ? "checked" : ""}> Closed</label><label>Opens<input name="open" type="time" value="${escapeHtml(value.open || "")}"></label><label>Closes<input name="close" type="time" value="${escapeHtml(value.close || "")}"></label></div>`;
    }).join("")}</div>`;
  } else {
    fields = `<p>Show one approved message on the website.</p><label class="checkbox-label"><input name="enabled" type="checkbox" ${draft?.enabled ? "checked" : ""}> Show announcement</label><label>Message<input name="text" maxlength="200" value="${escapeHtml(draft?.text || "")}"></label><label>Button label (optional)<input name="label" maxlength="40" value="${escapeHtml(draft?.label || "")}"></label><label>Button link (optional)<input name="href" maxlength="500" value="${escapeHtml(draft?.href || "")}" placeholder="https://... or /contact.html"></label>`;
  }
  return `<form class="panel-card content-card" data-content-form="${section}"><h2>${section === "menu" ? "Menu" : section === "hours" ? "Opening hours" : "Announcement"}</h2><p class="content-meta">${escapeHtml(publishedLabel)} · ${escapeHtml(draftLabel)}</p>${fields}<div class="content-actions"><button class="button button-secondary" type="submit">Save draft</button><button class="button button-primary" type="button" data-publish-section="${section}" ${record?.draft ? "" : "disabled"}>Publish saved draft</button>${record?.published ? `<button class="button button-danger" type="button" data-unpublish-section="${section}">Unpublish</button>` : ""}</div><p class="status" data-content-form-status role="status" aria-live="polite"></p></form>`;
}

async function loadContent() {
  const status = $("[data-content-status]");
  setStatus(status, "Loading content...", "info");
  try {
    const result = await invokeEdge("manage-content", { action: "load" });
    state.content = result.sections;
    $("[data-content-editor]").innerHTML = ["menu", "hours", "announcement"].map((section) => contentFormHtml(section, state.content[section])).join("");
    syncHoursInputs();
    setStatus(status, "", "info");
  } catch (error) { setStatus(status, error.message, "error"); }
}

function syncHoursInputs() {
  $$('[data-hours-day]').forEach((row) => {
    const closed = row.querySelector('[name="closed"]').checked;
    for (const name of ["open", "close"]) {
      const input = row.querySelector(`[name="${name}"]`);
      input.disabled = closed;
      input.required = false;
    }
  });
}

function readContentForm(form) {
  const section = form.dataset.contentForm;
  if (section === "menu") return { items: $$('[data-menu-item]', form).map((row) => {
    const price = row.querySelector('[name="pricePesos"]').value;
    return {
      name: row.querySelector('[name="name"]').value.trim(),
      description: row.querySelector('[name="description"]').value.trim(),
      pricePesos: price === "" ? null : Number(price),
      available: row.querySelector('[name="available"]').checked
    };
  }) };
  if (section === "hours") return { days: $$('[data-hours-day]', form).map((row) => {
    const closed = row.querySelector('[name="closed"]').checked;
    return { day: row.dataset.hoursDay, closed, open: closed ? null : row.querySelector('[name="open"]').value || null, close: closed ? null : row.querySelector('[name="close"]').value || null };
  }) };
  return {
    enabled: form.querySelector('[name="enabled"]').checked,
    text: form.querySelector('[name="text"]').value.trim(),
    label: form.querySelector('[name="label"]').value.trim(),
    href: form.querySelector('[name="href"]').value.trim()
  };
}

async function saveContentDraft(event) {
  event.preventDefault();
  const form = event.target.closest('[data-content-form]');
  const section = form.dataset.contentForm;
  const status = $("[data-content-form-status]", form);
  setStatus(status, "Saving draft...", "info");
  try {
    await invokeEdge("manage-content", { action: "saveDraft", section, content: readContentForm(form) });
    await loadContent();
    setStatus($("[data-content-form-status]", $(`[data-content-form="${section}"]`)), "Draft saved. Review it before publishing.", "success");
  } catch (error) { setStatus(status, error.message, "error"); }
}

async function publishContent(section) {
  const form = $(`[data-content-form="${section}"]`);
  const status = $("[data-content-form-status]", form);
  if (!confirm(`Publish the saved ${section} draft to the customer website?`)) return;
  setStatus(status, "Publishing...", "info");
  try {
    await invokeEdge("manage-content", { action: "publish", section });
    await loadContent();
    setStatus($("[data-content-form-status]", $(`[data-content-form="${section}"]`)), "Published on the website.", "success");
  } catch (error) { setStatus(status, error.message, "error"); }
}

async function unpublishContent(section) {
  const form = $(`[data-content-form="${section}"]`);
  const status = $("[data-content-form-status]", form);
  if (!confirm(`Remove the published ${section} from the customer website? Its saved draft will stay available.`)) return;
  setStatus(status, "Unpublishing...", "info");
  try {
    await invokeEdge("manage-content", { action: "unpublish", section });
    await loadContent();
    setStatus($("[data-content-form-status]", $(`[data-content-form="${section}"]`)), "Removed from the website. The draft is still saved.", "success");
  } catch (error) { setStatus(status, error.message, "error"); }
}

$("[data-login-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = $("[data-login-status]");
  if (!configured) {
    setStatus(status, "Supabase has not been configured for this deployment.", "error");
    return;
  }
  const fields = new FormData(event.currentTarget);
  setStatus(status, "Signing in...", "info");
  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(fields.get("email") || "").trim(),
    password: String(fields.get("password") || "")
  });
  if (error || !data.session) {
    setStatus(status, "Email or password was not accepted.", "error");
    return;
  }
  try {
    await enterDashboard(data.session);
  } catch (profileError) {
    await supabase.auth.signOut({ scope: "local" });
    setStatus(status, profileError.message || "This account does not have staff access.", "error");
  }
});

$("[data-recovery-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = $("[data-recovery-status]");
  if (!configured) return setStatus(status, "Supabase has not been configured.", "error");
  const email = String(new FormData(event.currentTarget).get("email") || "").trim();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${location.origin}${location.pathname}`
  });
  setStatus(status, error ? "The recovery email could not be sent." : "If this is an active staff account, a recovery link has been sent.", error ? "error" : "success");
});

$("[data-password-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = $("[data-password-status]");
  const values = new FormData(event.currentTarget);
  const password = String(values.get("password") || "");
  const confirmation = String(values.get("confirmation") || "");
  if (password !== confirmation) return setStatus(status, "The passwords do not match.", "error");
  if (password.length < 10 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return setStatus(status, "Use at least 10 characters with uppercase, lowercase, and a number.", "error");
  }
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return setStatus(status, "The password could not be saved.", "error");
  requiresPasswordSetup = false;
  history.replaceState(null, "", location.pathname);
  setStatus(status, "Password saved. Opening the dashboard...", "success");
  await enterDashboard(state.session);
});

$("[data-show-recovery]")?.addEventListener("click", () => showAuthPanel("recovery"));
$("[data-show-login]")?.addEventListener("click", () => showAuthPanel("login"));
$("[data-logout]")?.addEventListener("click", async () => {
  await supabase.auth.signOut({ scope: "local" });
  resetDashboard();
  showAuthPanel("login");
});
$("[data-refresh]")?.addEventListener("click", () => Promise.all([loadBookings(), loadCounts()]));
$("[data-new-booking]")?.addEventListener("click", () => {
  const date = $("[data-manual-form] input[name='date']");
  date.min = today();
  if (!date.value) date.value = today();
  manualDialog.showModal();
});
$("[data-manual-close]")?.addEventListener("click", () => manualDialog.close());
$("[data-manual-form]")?.addEventListener("submit", createManualBooking);
$("[data-manual-form] select[name='source']")?.addEventListener("change", syncManualSource);
$("[data-content-editor]")?.addEventListener("submit", (event) => {
  const form = event.target.closest('[data-content-form]');
  if (form) saveContentDraft(event);
});
$("[data-content-editor]")?.addEventListener("change", (event) => {
  if (event.target.matches('[name="closed"]')) syncHoursInputs();
});
$("[data-content-editor]")?.addEventListener("input", (event) => {
  const form = event.target.closest('[data-content-form]');
  if (!form) return;
  const button = $('[data-publish-section]', form);
  if (button) button.disabled = true;
  setStatus($('[data-content-form-status]', form), "Unsaved changes. Save the draft before publishing.", "info");
});
$("[data-export]")?.addEventListener("click", exportCsv);
$("[data-refresh-activity]")?.addEventListener("click", loadActivity);
$("[data-page-prev]")?.addEventListener("click", () => { if (state.page > 0) { state.page -= 1; loadBookings(); } });
$("[data-page-next]")?.addEventListener("click", () => { if ((state.page + 1) * PAGE_SIZE < state.total) { state.page += 1; loadBookings(); } });
$("[data-clear-filters]")?.addEventListener("click", () => {
  const form = $("[data-filter-form]");
  form.reset();
  state.filters = { search: "", status: "", dateFrom: "", dateTo: "" };
  state.page = 0;
  loadBookings();
});
$("[data-filter-form]")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const values = new FormData(event.currentTarget);
  state.filters = {
    search: cleanSearch(values.get("search")),
    status: String(values.get("status") || ""),
    dateFrom: String(values.get("date-from") || ""),
    dateTo: String(values.get("date-to") || "")
  };
  state.page = 0;
  loadBookings();
});
$("[data-invite-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = $("[data-invite-status]");
  const values = new FormData(event.currentTarget);
  setStatus(status, "Sending invitation...", "info");
  const { error } = await supabase.functions.invoke("manage-staff", {
    body: {
      action: "invite",
      displayName: String(values.get("display-name") || "").trim(),
      email: String(values.get("email") || "").trim()
    }
  });
  if (error) return setStatus(status, "The invitation could not be sent. The email may already be registered.", "error");
  event.currentTarget.reset();
  setStatus(status, "Invitation sent. The staff member must use the email link to set a password.", "success");
  await loadTeam();
});

document.addEventListener("click", (event) => {
  const openButton = event.target.closest("[data-open-booking]");
  if (openButton) openBooking(openButton.dataset.openBooking);
  const tab = event.target.closest("[data-tab]");
  if (tab) switchTab(tab.dataset.tab);
  const view = event.target.closest("[data-booking-view]");
  if (view) switchBookingView(view.dataset.bookingView);
  const addItem = event.target.closest("[data-add-menu-item]");
  if (addItem) {
    $('[data-menu-items]', addItem.closest('form')).insertAdjacentHTML("beforeend", menuItemHtml());
    addItem.closest('form').dispatchEvent(new Event("input", { bubbles: true }));
  }
  const removeItem = event.target.closest("[data-remove-menu-item]");
  if (removeItem) {
    const form = removeItem.closest('form');
    removeItem.closest('[data-menu-item]').remove();
    form.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const publish = event.target.closest('[data-publish-section]');
  if (publish && !publish.disabled) publishContent(publish.dataset.publishSection);
  const unpublish = event.target.closest('[data-unpublish-section]');
  if (unpublish) unpublishContent(unpublish.dataset.unpublishSection);
  const teamAction = event.target.closest("[data-team-action]");
  if (teamAction) manageStaff(teamAction.dataset.teamAction, teamAction.dataset.userId);
});
$("[data-dialog-close]")?.addEventListener("click", () => dialog.close());
dialog?.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
manualDialog?.addEventListener("click", (event) => { if (event.target === manualDialog) manualDialog.close(); });

for (const eventName of ["pointerdown", "keydown", "touchstart", "scroll"]) {
  document.addEventListener(eventName, recordActivity, { passive: true });
}

async function start() {
  $("[data-filter-form] select[name='status']").disabled = true;
  $("[data-manual-form] input[name='date']").min = today();
  $("[data-manual-form] input[name='date']").value = today();
  syncManualSource();
  if (!configured) {
    showAuthPanel("login");
    setStatus($("[data-login-status]"), "Supabase has not been configured for this deployment.", "error");
    return;
  }
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    showAuthPanel("login");
    return;
  }
  try {
    await enterDashboard(data.session);
  } catch (error) {
    await supabase.auth.signOut({ scope: "local" });
    showAuthPanel("login");
    setStatus($("[data-login-status]"), error.message || "This account does not have staff access.", "error");
  }
}

start();
