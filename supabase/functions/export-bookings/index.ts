import {
  authenticateStaff,
  cleanSearch,
  corsHeaders,
  isAllowedOrigin,
  jsonResponse,
  preflight
} from "../_shared/common.ts";

const STATUSES = new Set(["pending", "confirmed", "rejected", "completed", "cancelled"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function safeCsv(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function csv(rows: Record<string, unknown>[]): string {
  const headings = [
    "Reference", "Inquiry type", "Customer name", "Contact number", "Requested date",
    "Requested time", "Guest count", "Occasion", "Notes", "Status", "Received at"
  ];
  const lines = rows.map((row) => [
    row.reference,
    row.inquiry_type,
    row.customer_name,
    row.contact_number,
    row.requested_date,
    row.requested_time,
    row.guest_count,
    row.occasion,
    row.notes,
    row.status,
    row.created_at
  ].map(safeCsv).join(","));
  return `\uFEFF${headings.map(safeCsv).join(",")}\r\n${lines.join("\r\n")}\r\n`;
}

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  if (!isAllowedOrigin(req)) return jsonResponse(req, { error: "Origin not allowed." }, 403);
  if (req.method !== "POST") return jsonResponse(req, { error: "Method not allowed." }, 405);

  const auth = await authenticateStaff(req, "owner");
  if ("error" in auth) return auth.error;

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(req, { error: "Invalid export filters." }, 400);
  }

  const search = cleanSearch(payload.search);
  const status = String(payload.status || "");
  const dateFrom = String(payload.dateFrom || "");
  const dateTo = String(payload.dateTo || "");
  if (status && !STATUSES.has(status)) return jsonResponse(req, { error: "Invalid status filter." }, 400);
  if (dateFrom && !DATE_PATTERN.test(dateFrom)) return jsonResponse(req, { error: "Invalid start date." }, 400);
  if (dateTo && !DATE_PATTERN.test(dateTo)) return jsonResponse(req, { error: "Invalid end date." }, 400);

  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < 10000; from += 1000) {
    let query = auth.client
      .from("bookings")
      .select("reference,inquiry_type,customer_name,contact_number,requested_date,requested_time,guest_count,occasion,notes,status,created_at")
      .order("requested_date", { ascending: true })
      .order("requested_time", { ascending: true })
      .range(from, from + 999);
    if (status) query = query.eq("status", status);
    if (dateFrom) query = query.gte("requested_date", dateFrom);
    if (dateTo) query = query.lte("requested_date", dateTo);
    if (search) {
      const term = `%${search}%`;
      query = query.or(`reference.ilike.${term},customer_name.ilike.${term},contact_number.ilike.${term}`);
    }

    const { data, error } = await query;
    if (error) return jsonResponse(req, { error: "The booking export could not be prepared." }, 500);
    const page = (data || []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < 1000) break;
  }

  await auth.client.from("activity_log").insert({
    action: "csv_exported",
    actor_user_id: auth.profile.user_id,
    metadata: {
      row_count: rows.length,
      status: status || null,
      date_from: dateFrom || null,
      date_to: dateTo || null
    }
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv(rows), {
    status: 200,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="yaelitos-bookings-${stamp}.csv"`,
      "Cache-Control": "no-store"
    }
  });
});
