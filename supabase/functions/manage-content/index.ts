import {
  authenticateStaff,
  isAllowedOrigin,
  jsonResponse,
  preflight
} from "../_shared/common.ts";

const SECTIONS = ["menu", "hours", "announcement"] as const;
type Section = typeof SECTIONS[number];
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function shortText(value: unknown, max: number): string | null {
  if (typeof value !== "string" || value.length > max) return null;
  return value.trim();
}

function safeLink(value: string): boolean {
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function validateContent(section: Section, input: unknown, publish: boolean): {
  content?: Record<string, unknown>; error?: string;
} {
  if (!isObject(input)) return { error: "Content must be an object." };

  if (section === "menu") {
    if (!Array.isArray(input.items) || input.items.length > 40) {
      return { error: "Use at most 40 menu items." };
    }
    if (publish && input.items.length === 0) return { error: "Add an approved menu item before publishing." };
    const items = [];
    for (const raw of input.items) {
      if (!isObject(raw)) return { error: "Invalid menu item." };
      const name = shortText(raw.name, 100);
      const description = shortText(raw.description ?? "", 300);
      if (name === null || description === null || (publish && !name)) {
        return { error: "Each published menu item needs a name within 100 characters and a description within 300 characters." };
      }
      if (typeof raw.available !== "boolean") return { error: "Choose availability for each menu item." };
      const price = raw.pricePesos === "" || raw.pricePesos === undefined ? null : raw.pricePesos;
      if (price !== null && (typeof price !== "number" || !Number.isFinite(price)
        || price <= 0 || price > 100000 || Math.abs(price * 100 - Math.round(price * 100)) > 0.000001)) {
        return { error: "Prices must be positive peso amounts with at most two decimal places, or left blank." };
      }
      items.push({ name, description, pricePesos: price, available: raw.available });
    }
    return { content: { items } };
  }

  if (section === "hours") {
    if (!Array.isArray(input.days) || input.days.length !== 7) {
      return { error: "Enter all seven days of opening hours." };
    }
    const days = [];
    for (let index = 0; index < 7; index += 1) {
      const raw = input.days[index];
      if (!isObject(raw) || raw.day !== DAYS[index] || typeof raw.closed !== "boolean") {
        return { error: "Enter all seven days in Monday-to-Sunday order." };
      }
      const open = raw.open === null || raw.open === "" ? null : shortText(raw.open, 5);
      const close = raw.close === null || raw.close === "" ? null : shortText(raw.close, 5);
      if (open === null && raw.open !== null && raw.open !== "") return { error: `Invalid opening time for ${raw.day}.` };
      if (close === null && raw.close !== null && raw.close !== "") return { error: `Invalid closing time for ${raw.day}.` };
      if (raw.closed) {
        if (open || close) return { error: `Clear the times for closed ${raw.day}.` };
      } else if ((open || close) && (!open || !close || !TIME_PATTERN.test(open) || !TIME_PATTERN.test(close) || open >= close)) {
        return { error: `Enter valid opening and closing times for ${raw.day}.` };
      } else if (publish && (!open || !close)) {
        return { error: `Confirm opening and closing times for ${raw.day} before publishing.` };
      }
      days.push({ day: raw.day, closed: raw.closed, open: raw.closed ? null : open, close: raw.closed ? null : close });
    }
    return { content: { days } };
  }

  if (typeof input.enabled !== "boolean") return { error: "Choose whether the announcement is enabled." };
  const text = shortText(input.text ?? "", 200);
  const label = shortText(input.label ?? "", 40);
  const href = shortText(input.href ?? "", 500);
  if (text === null || label === null || href === null) return { error: "Announcement text, label, or link is too long." };
  if (publish && input.enabled && (!text || !label || !href || !safeLink(href))) {
    return { error: "Enabled announcements need text, a label, and a safe website link." };
  }
  if (href && !safeLink(href)) return { error: "Use an HTTPS link or a website path for the announcement." };
  return { content: { enabled: input.enabled, text, label, href } };
}

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  if (!isAllowedOrigin(req)) return jsonResponse(req, { error: "Origin not allowed." }, 403);
  if (req.method !== "POST") return jsonResponse(req, { error: "Method not allowed." }, 405);
  const auth = await authenticateStaff(req, "owner");
  if ("error" in auth) return auth.error;

  if (Number(req.headers.get("content-length") || 0) > 30000) {
    return jsonResponse(req, { error: "Content is too large." }, 413);
  }
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
    if (!isObject(payload)) throw new Error("Invalid body");
  } catch {
    return jsonResponse(req, { error: "Invalid request body." }, 400);
  }

  const action = String(payload.action || "");
  if (action === "load") {
    const [{ data: drafts, error: draftError }, { data: published, error: publishedError }] = await Promise.all([
      auth.client.from("content_drafts").select("section,content,updated_at"),
      auth.client.from("site_content").select("section,content,published_at")
    ]);
    if (draftError || publishedError) return jsonResponse(req, { error: "Website content could not be loaded." }, 500);
    const sections = Object.fromEntries(SECTIONS.map((section) => [section, {
      draft: (drafts || []).find((row) => row.section === section) || null,
      published: (published || []).find((row) => row.section === section) || null
    }]));
    return jsonResponse(req, { sections });
  }

  const section = String(payload.section || "") as Section;
  if (!SECTIONS.includes(section)) return jsonResponse(req, { error: "Choose menu, hours, or announcement." }, 400);

  if (action === "saveDraft") {
    const validated = validateContent(section, payload.content, false);
    if (!validated.content) return jsonResponse(req, { error: validated.error || "Invalid content." }, 400);
    const { data, error } = await auth.client.from("content_drafts").upsert({
      section, content: validated.content, updated_at: new Date().toISOString(), updated_by: auth.profile.user_id
    }).select("section,content,updated_at").single();
    if (error) {
      console.error("manage-content draft failed", error.code);
      return jsonResponse(req, { error: "The draft could not be saved." }, 500);
    }
    return jsonResponse(req, { section, draft: data });
  }

  if (action === "publish") {
    const { data: draft, error: readError } = await auth.client.from("content_drafts")
      .select("content").eq("section", section).maybeSingle();
    if (readError) return jsonResponse(req, { error: "The draft could not be loaded." }, 500);
    if (!draft) return jsonResponse(req, { error: "Save a draft before publishing." }, 400);
    const validated = validateContent(section, draft.content, true);
    if (!validated.content) return jsonResponse(req, { error: validated.error || "This draft is not ready to publish." }, 400);
    const { data, error } = await auth.client.from("site_content").upsert({
      section, content: validated.content, published_at: new Date().toISOString(), published_by: auth.profile.user_id
    }).select("section,content,published_at").single();
    if (error) {
      console.error("manage-content publish failed", error.code);
      return jsonResponse(req, { error: "The content could not be published." }, 500);
    }
    return jsonResponse(req, { section, published: data });
  }

  if (action === "unpublish") {
    const { data, error } = await auth.client.rpc("unpublish_site_content", {
      p_section: section,
      p_actor_user_id: auth.profile.user_id
    });
    if (error) {
      console.error("manage-content unpublish failed", error.code);
      return jsonResponse(req, { error: "The content could not be withdrawn." }, 500);
    }
    return jsonResponse(req, { section, unpublished: data === true });
  }

  return jsonResponse(req, { error: "Unsupported content action." }, 400);
});
