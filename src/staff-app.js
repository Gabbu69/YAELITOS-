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
const PAGE_SIZE = 25;
const STATUSES = ["pending", "confirmed", "rejected", "completed", "cancelled"];
const state = {
  session: null,
  profile: null,
  page: 0,
  total: 0,
  selectedBooking: null,
  filters: { search: "", status: "", dateFrom: today(), dateTo: "" },
  idleTimer: null,
  lastActivityWrite: 0,
  team: []
};

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
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
  if (status) query = query.eq("status", status);
  if (dateFrom) query = query.gte("requested_date", dateFrom);
  if (dateTo) query = query.lte("requested_date", dateTo);
  const cleaned = cleanSearch(search);
  if (cleaned) {
    const term = `%${cleaned}%`;
    query = query.or(`reference.ilike.${term},customer_name.ilike.${term},contact_number.ilike.${term}`);
  }
  return query;
}

async function loadBookings() {
  const status = $("[data-bookings-status]");
  setStatus(status, "Loading bookings...", "info");
  let query = supabase
    .from("bookings")
    .select("id,reference,inquiry_type,customer_name,contact_number,requested_date,requested_time,guest_count,occasion,notes,status,created_at,updated_at,anonymized_at", { count: "exact" })
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
      <td><strong>${escapeHtml(booking.reference)}</strong><small>${escapeHtml(booking.inquiry_type)}</small></td>
      <td><strong>${escapeHtml(booking.customer_name || "Anonymized")}</strong><small>${escapeHtml(booking.contact_number || "No retained contact")}</small></td>
      <td><strong>${escapeHtml(formatDate(booking.requested_date))}</strong><small>${escapeHtml(formatTime(booking.requested_time))}</small></td>
      <td>${escapeHtml(booking.guest_count)}</td>
      <td>${statusPill(booking.status)}</td>
      <td><button class="button button-secondary button-small" type="button" data-open-booking="${escapeHtml(booking.id)}">Open</button></td>
    </tr>`).join("");
  cards.innerHTML = bookings.map((booking) => `
    <article class="booking-card">
      <div class="booking-card-head"><div><strong>${escapeHtml(booking.reference)}</strong><small>${escapeHtml(booking.inquiry_type)}</small></div>${statusPill(booking.status)}</div>
      <p><strong>${escapeHtml(booking.customer_name || "Anonymized")}</strong><br>${escapeHtml(formatDate(booking.requested_date))} at ${escapeHtml(formatTime(booking.requested_time))} · ${escapeHtml(booking.guest_count)} guest${booking.guest_count === 1 ? "" : "s"}</p>
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
    base().gte("requested_date", current)
  ]);
  $("[data-count-pending]").textContent = pending.count ?? "—";
  $("[data-count-today]").textContent = todayResult.count ?? "—";
  $("[data-count-upcoming]").textContent = upcoming.count ?? "—";
}

async function openBooking(id) {
  const { data: booking, error } = await supabase
    .from("bookings")
    .select("id,reference,inquiry_type,customer_name,contact_number,requested_date,requested_time,guest_count,occasion,notes,status,created_at,updated_at,anonymized_at")
    .eq("id", id)
    .maybeSingle();
  if (error || !booking) {
    setStatus($("[data-bookings-status]"), "That booking could not be opened.", "error");
    return;
  }
  state.selectedBooking = booking;
  const { data: history } = await supabase
    .from("activity_log")
    .select("id,action,actor_user_id,old_status,new_status,created_at")
    .eq("booking_id", id)
    .order("created_at", { ascending: false });
  renderBookingDetail(booking, history || []);
  dialog.showModal();
}

function renderBookingDetail(booking, history) {
  const anonymized = Boolean(booking.anonymized_at);
  $("[data-booking-detail]").innerHTML = `
    <div class="detail-shell">
      <header class="detail-header"><p class="detail-reference">${escapeHtml(booking.reference)}</p><h1>${escapeHtml(booking.customer_name || "Anonymized booking")}</h1>${statusPill(booking.status)}</header>
      <div class="detail-grid">
        <div><span>Contact</span><strong>${escapeHtml(booking.contact_number || "Removed after anonymization")}</strong></div>
        <div><span>Inquiry</span><strong>${escapeHtml(booking.inquiry_type)}</strong></div>
        <div><span>Date</span><strong>${escapeHtml(formatDate(booking.requested_date))}</strong></div>
        <div><span>Time</span><strong>${escapeHtml(formatTime(booking.requested_time))}</strong></div>
        <div><span>Guests</span><strong>${escapeHtml(booking.guest_count)}</strong></div>
        <div><span>Occasion</span><strong>${escapeHtml(booking.occasion || "Not provided")}</strong></div>
        <div class="detail-full"><span>Notes</span><strong>${escapeHtml(booking.notes || "No notes")}</strong></div>
        <div class="detail-full"><span>Received</span><strong>${escapeHtml(formatTimestamp(booking.created_at))}</strong></div>
      </div>
      <form class="detail-controls" data-status-form>
        <label>Booking status<select name="status">${STATUSES.map((status) => `<option value="${status}"${status === booking.status ? " selected" : ""}>${status[0].toUpperCase() + status.slice(1)}</option>`).join("")}</select></label>
        <button class="button button-primary" type="submit">Save status</button>
      </form>
      <p class="status" data-detail-status role="status" aria-live="polite"></p>
      <section class="history"><h2>Status history</h2>${history.length ? history.map((item) => `<div class="history-item"><p>${escapeHtml(activityText(item))}</p><small>${escapeHtml(formatTimestamp(item.created_at))}</small></div>`).join("") : "<p>No activity recorded.</p>"}</section>
      ${state.profile.role === "owner" && !anonymized ? `<div class="danger-zone"><h2>Privacy action</h2><p>Remove the customer's name, contact, occasion, and notes now. This cannot be undone.</p><button class="button button-danger" type="button" data-anonymize-booking>Anonymize customer details</button></div>` : ""}
    </div>`;

  $("[data-status-form]", dialog)?.addEventListener("submit", updateBookingStatus);
  $("[data-anonymize-booking]", dialog)?.addEventListener("click", anonymizeSelectedBooking);
}

function activityText(item) {
  const label = String(item.action || "activity").replaceAll("_", " ");
  if (item.action === "booking_status_changed") return `Status changed from ${item.old_status} to ${item.new_status}.`;
  if (item.action === "booking_created") return "Pending request created.";
  if (item.action === "booking_anonymized") return "Customer details anonymized.";
  return `${label[0]?.toUpperCase() || ""}${label.slice(1)}.`;
}

async function updateBookingStatus(event) {
  event.preventDefault();
  const detailStatus = $("[data-detail-status]", dialog);
  const status = String(new FormData(event.currentTarget).get("status") || "");
  if (!STATUSES.includes(status) || status === state.selectedBooking.status) {
    setStatus(detailStatus, status === state.selectedBooking.status ? "No status change was made." : "Choose a valid status.", "info");
    return;
  }
  if (!confirm(`Change this booking from ${state.selectedBooking.status} to ${status}?`)) return;
  setStatus(detailStatus, "Saving status...", "info");
  const { data, error } = await supabase
    .from("bookings")
    .update({ status })
    .eq("id", state.selectedBooking.id)
    .eq("updated_at", state.selectedBooking.updated_at)
    .select("id")
    .maybeSingle();
  if (error) {
    setStatus(detailStatus, "The status could not be saved.", "error");
    return;
  }
  if (!data) {
    setStatus(detailStatus, "Another staff member changed this booking. Close and reopen it to see the latest record.", "error");
    return;
  }
  dialog.close();
  await Promise.all([loadBookings(), loadCounts()]);
  setStatus($("[data-bookings-status]"), `Booking ${state.selectedBooking.reference} changed to ${status}.`, "success");
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
  $$('[data-tab]').forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
  $$('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== name; });
  if (name === "team") loadTeam();
  if (name === "activity") loadTeam().then(loadActivity);
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
$("[data-export]")?.addEventListener("click", exportCsv);
$("[data-refresh-activity]")?.addEventListener("click", loadActivity);
$("[data-page-prev]")?.addEventListener("click", () => { if (state.page > 0) { state.page -= 1; loadBookings(); } });
$("[data-page-next]")?.addEventListener("click", () => { if ((state.page + 1) * PAGE_SIZE < state.total) { state.page += 1; loadBookings(); } });
$("[data-clear-filters]")?.addEventListener("click", () => {
  const form = $("[data-filter-form]");
  form.reset();
  form.elements.namedItem("date-from").value = today();
  state.filters = { search: "", status: "", dateFrom: today(), dateTo: "" };
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
  const teamAction = event.target.closest("[data-team-action]");
  if (teamAction) manageStaff(teamAction.dataset.teamAction, teamAction.dataset.userId);
});
$("[data-dialog-close]")?.addEventListener("click", () => dialog.close());
dialog?.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });

for (const eventName of ["pointerdown", "keydown", "touchstart", "scroll"]) {
  document.addEventListener(eventName, recordActivity, { passive: true });
}

async function start() {
  const dateFrom = $("[data-filter-form]")?.elements.namedItem("date-from");
  if (dateFrom) dateFrom.value = today();
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
