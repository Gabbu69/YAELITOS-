(function initYaelitosSite() {
  "use strict";

  const CONFIG = window.YAELITOS_CONFIG || {};
  const root = document.documentElement;
  root.classList.add("js");

  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const slowUpdateQuery = window.matchMedia("(update: slow)");
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const deviceMemory = Number(navigator.deviceMemory || 0);
  const processorCount = Number(navigator.hardwareConcurrency || 0);
  const limitedHardware = (deviceMemory > 0 && deviceMemory <= 2) || (processorCount > 0 && processorCount <= 2);
  const useLiteMotion = reducedMotionQuery.matches || slowUpdateQuery.matches || Boolean(connection?.saveData) || limitedHardware;
  const useRichMotion = !useLiteMotion && deviceMemory > 4 && processorCount > 4;
  const useLiteVisuals = useLiteMotion || (deviceMemory > 0 && deviceMemory <= 4) || (processorCount > 0 && processorCount <= 4);
  root.classList.add(useLiteMotion ? "motion-lite" : useRichMotion ? "motion-rich" : "motion-standard");
  root.classList.add(useLiteVisuals ? "visuals-lite" : "visuals-full");
  if (!useLiteMotion) root.classList.add("motion-capable");

  function updateMotionVisibility() {
    root.classList.toggle("motion-paused", document.hidden);
  }

  document.addEventListener("visibilitychange", updateMotionVisibility);
  updateMotionVisibility();

  const iconPaths = {
    phone: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.32 1.77.59 2.61a2 2 0 0 1-.45 2.11L8 9.69a16 16 0 0 0 6.31 6.31l1.25-1.25a2 2 0 0 1 2.11-.45c.84.27 1.71.47 2.61.59A2 2 0 0 1 22 16.92z"/></svg>',
    message: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>'
  };

  function configValue(path) {
    return path.split(".").reduce((value, key) => {
      if (value === null || typeof value !== "object") return undefined;
      return value[key];
    }, CONFIG);
  }

  function hasUsableValue(value) {
    return (typeof value === "string" && value.trim() !== "") || typeof value === "number";
  }

  function populateConfig() {
    document.querySelectorAll("[data-config]").forEach((element) => {
      const value = configValue(element.dataset.config || "");
      if (hasUsableValue(value)) element.textContent = String(value);
    });

    document.querySelectorAll("[data-config-href]").forEach((element) => {
      const value = configValue(element.dataset.configHref || "");
      if (hasUsableValue(value)) element.setAttribute("href", String(value));
    });

    document.querySelectorAll("[data-announcement]").forEach((element) => {
      const announcement = CONFIG.announcement;
      element.hidden = !(announcement && announcement.enabled && announcement.text);
    });

    // Compatibility for pages being migrated to the data-config contract.
    const legacyLinks = {
      phone: configValue("business.phoneHref") || CONFIG.phoneTel,
      sms: configValue("business.smsHref") || CONFIG.phoneSms,
      messenger: configValue("facebook.messengerUrl") || CONFIG.messengerUrl,
      facebook: configValue("facebook.pageUrl") || CONFIG.facebookUrl,
      directions: configValue("business.directionsUrl") || CONFIG.directionsUrl
    };

    Object.entries(legacyLinks).forEach(([type, href]) => {
      if (!hasUsableValue(href)) return;
      document.querySelectorAll(`[data-contact="${type}"]`).forEach((link) => {
        link.setAttribute("href", href);
      });
    });

    const phoneDisplay = configValue("business.phoneDisplay") || CONFIG.phoneDisplay;
    if (hasUsableValue(phoneDisplay)) {
      document.querySelectorAll("[data-phone-text]").forEach((element) => {
        element.textContent = phoneDisplay;
      });
    }
  }

  function publishedNode(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = String(value);
    return node;
  }

  function safeAnnouncementHref(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      const url = new URL(value, location.href);
      return url.protocol === "https:" || (url.protocol === "http:" && url.origin === location.origin) ? url.href : "";
    } catch {
      return "";
    }
  }

  function renderAnnouncement(content) {
    if (!content || content.enabled !== true || typeof content.text !== "string" || !content.text.trim()) return;
    document.querySelectorAll("[data-published-announcement]").forEach((region) => {
      const inner = publishedNode("div", "container published-announcement-inner");
      inner.append(publishedNode("p", "", content.text.trim()));
      const href = safeAnnouncementHref(content.href);
      if (href && typeof content.label === "string" && content.label.trim()) {
        const link = publishedNode("a", "text-link", content.label.trim());
        link.href = href;
        if (new URL(href).origin !== location.origin) {
          link.target = "_blank";
          link.rel = "noopener noreferrer";
        }
        inner.append(link);
      }
      region.replaceChildren(inner);
      region.hidden = false;
    });
  }

  function renderMenu(content, publishedAt) {
    const region = document.querySelector("[data-published-menu]");
    const list = region?.querySelector("[data-published-menu-items]");
    if (!region || !list || !Array.isArray(content?.items)) return;
    const items = content.items.filter((item) => item && typeof item.name === "string" && item.name.trim());
    if (!items.length) return;
    const money = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 });
    const cards = items.map((item) => {
      const card = publishedNode("article", "published-menu-item");
      const heading = publishedNode("h3", "", item.name.trim());
      card.append(heading);
      if (typeof item.description === "string" && item.description.trim()) {
        card.append(publishedNode("p", "", item.description.trim()));
      }
      const details = publishedNode("div", "published-menu-details");
      const price = typeof item.pricePesos === "number" && Number.isFinite(item.pricePesos) && item.pricePesos >= 0
        ? money.format(item.pricePesos) : "Ask for price";
      details.append(publishedNode("strong", "", price));
      details.append(publishedNode("span", "", item.available === true ? "Listed as available" : "Currently unavailable"));
      card.append(details);
      return card;
    });
    list.replaceChildren(...cards);
    const updated = region.querySelector("[data-published-menu-date]");
    const published = new Date(publishedAt || "");
    if (updated && !Number.isNaN(published.getTime())) {
      updated.textContent = `Published ${new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" }).format(published)}. Confirm current availability with Yaelitos.`;
    }
    region.hidden = false;
  }

  function renderHours(content) {
    const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    if (!Array.isArray(content?.days) || content.days.length !== 7) return;
    const byDay = new Map(content.days.map((item) => [item?.day, item]));
    if (byDay.size !== 7 || days.some((day) => !byDay.has(day))) return;
    const formatTime = (value) => {
      if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return "";
      const date = new Date(`2000-01-01T${value}:00`);
      return new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" }).format(date);
    };
    const rows = days.map((day) => {
      const item = byDay.get(day);
      const open = formatTime(item.open);
      const close = formatTime(item.close);
      if (item.closed !== true && (!open || !close)) return null;
      const hours = item.closed === true ? "Closed" : `${open}–${close}`;
      const row = publishedNode("div", "published-hours-row");
      row.append(publishedNode("dt", "", day[0].toUpperCase() + day.slice(1)));
      row.append(publishedNode("dd", "", hours));
      return row;
    });
    if (rows.some((row) => !row)) return;
    document.querySelectorAll("[data-published-hours]").forEach((region) => {
      const list = region.querySelector("[data-published-hours-list]");
      if (!list) return;
      list.replaceChildren(...rows.map((row) => row.cloneNode(true)));
      region.hidden = false;
      region.closest(".published-hours-layout")?.classList.add("is-published");
    });
    const currentDay = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "Asia/Manila" }).format(new Date()).toLowerCase();
    const current = byDay.get(currentDay);
    const today = current.closed === true ? "Closed today" : `Today: ${formatTime(current.open)}–${formatTime(current.close)}`;
    document.querySelectorAll("[data-hours-summary]").forEach((element) => {
      element.textContent = `${today}. Please confirm holiday changes with Yaelitos.`;
    });
  }

  async function loadPublishedContent() {
    if (!document.querySelector("[data-published-menu], [data-published-hours], [data-published-announcement], [data-hours-summary]")) return;
    const app = window.YAELITOS_APP_CONFIG || {};
    const base = String(app.supabaseUrl || "").replace(/\/$/, "");
    const key = String(app.supabasePublishableKey || "").trim();
    if (!/^https:\/\//.test(base) || !key) return;
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      let response;
      try {
        response = await fetch(`${base}/rest/v1/site_content?select=section,content,published_at`, {
          headers: { apikey: key, Accept: "application/json" },
          signal: controller.signal,
          cache: "no-store"
        });
      } finally {
        window.clearTimeout(timeout);
      }
      if (!response.ok) return;
      const rows = await response.json();
      if (!Array.isArray(rows)) return;
      const content = new Map(rows.map((row) => [row.section, row]));
      renderAnnouncement(content.get("announcement")?.content);
      renderMenu(content.get("menu")?.content, content.get("menu")?.published_at);
      renderHours(content.get("hours")?.content);
    } catch {
      // The visible fallback tells visitors to ask Yaelitos directly.
    }
  }

  function setActiveNav() {
    const currentFile = location.pathname.split("/").pop() || "index.html";
    document.querySelectorAll(".nav-links a").forEach((link) => {
      const linkUrl = new URL(link.getAttribute("href") || "", location.href);
      const linkFile = linkUrl.pathname.split("/").pop() || "index.html";
      const isCurrent = linkUrl.origin === location.origin && linkFile === currentFile;
      link.classList.toggle("active", isCurrent);
      if (isCurrent) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function initMenu() {
    const button = document.querySelector(".menu-toggle");
    const links = document.querySelector(".nav-links");
    if (!button || !links) return;

    if (!links.id) links.id = "main-navigation";
    button.type = "button";
    button.setAttribute("aria-controls", links.id);

    const openLabel = button.dataset.openLabel || "Open menu";
    const closeLabel = button.dataset.closeLabel || "Close menu";

    function isOpen() {
      return button.getAttribute("aria-expanded") === "true";
    }

    function setOpen(open, returnFocus) {
      links.classList.toggle("open", open);
      document.body.classList.toggle("menu-open", open);
      button.setAttribute("aria-expanded", String(open));
      button.setAttribute("aria-label", open ? closeLabel : openLabel);
      if (!open && returnFocus) button.focus();
    }

    setOpen(false, false);

    button.addEventListener("click", () => {
      setOpen(!isOpen(), false);
    });

    links.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("a")) setOpen(false, false);
    });

    document.addEventListener("pointerdown", (event) => {
      if (!isOpen() || button.contains(event.target) || links.contains(event.target)) return;
      setOpen(false, false);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !isOpen()) return;
      event.preventDefault();
      setOpen(false, true);
    });
  }

  function initReveal() {
    const items = Array.from(document.querySelectorAll(".reveal"));
    if (!items.length) return;

    const staggerGroups = document.querySelectorAll([
      ".service-ribbon-grid",
      ".food-grid",
      ".food-collection",
      ".gallery-editorial",
      ".proof-grid",
      ".events-intro-grid",
      ".process-grid",
      ".contact-details-grid"
    ].join(","));

    staggerGroups.forEach((group) => {
      Array.from(group.children)
        .filter((item) => item.classList.contains("reveal"))
        .forEach((item, index) => item.style.setProperty("--reveal-delay", `${Math.min(index, 4) * 70}ms`));
    });

    // Content starts visible. CSS should only hide pending items beneath
    // .reveal-enhanced, so no-JS and unsupported browsers keep all content.
    items.forEach((item) => item.classList.add("visible"));

    if (useLiteMotion || !("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      });
    }, {
      rootMargin: "0px 0px -8%",
      threshold: 0.08
    });

    const pendingItems = items.filter((item) => {
      const bounds = item.getBoundingClientRect();
      return !(bounds.top < window.innerHeight && bounds.bottom > 0);
    });

    root.classList.add("reveal-enhanced");
    pendingItems.forEach((item) => {
      item.classList.remove("visible");
      observer.observe(item);
    });
  }

  function galleryDialogFor(trigger) {
    const target = (trigger.dataset.galleryOpen || "").trim();
    if (target.startsWith("#")) return document.querySelector(target);
    return document.querySelector("[data-gallery-dialog]");
  }

  function initGalleryDialogs() {
    const triggers = document.querySelectorAll("[data-gallery-open]");
    if (!triggers.length) return;

    const returnFocus = new WeakMap();

    document.querySelectorAll("[data-gallery-dialog]").forEach((dialog, index) => {
      if (!dialog.id) dialog.id = `gallery-dialog-${index + 1}`;
      dialog.setAttribute("aria-modal", "true");

      const closeButton = dialog.querySelector("[data-gallery-close], [data-dialog-close]");
      if (closeButton) closeButton.addEventListener("click", () => dialog.close());

      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
      });

      dialog.addEventListener("close", () => {
        const trigger = returnFocus.get(dialog);
        if (trigger && trigger.isConnected) trigger.focus();
      });
    });

    triggers.forEach((trigger) => {
      const dialog = galleryDialogFor(trigger);
      if (!dialog || typeof dialog.showModal !== "function") return;

      trigger.setAttribute("aria-haspopup", "dialog");
      if (dialog.id) trigger.setAttribute("aria-controls", dialog.id);

      trigger.addEventListener("click", (event) => {
        const sourceImage = trigger.querySelector("img");
        const dialogImage = dialog.querySelector("[data-gallery-image], img");
        const dialogCaption = dialog.querySelector("[data-gallery-caption], figcaption");
        const sourceCaption = trigger.querySelector("[data-gallery-caption], figcaption");
        const source = trigger.dataset.gallerySrc || sourceImage?.currentSrc || sourceImage?.src;
        const alt = trigger.dataset.galleryAlt || sourceImage?.alt || "";
        const caption = trigger.dataset.galleryCaption || sourceCaption?.textContent?.trim() || alt;

        if (!dialogImage || !source) return;
        event.preventDefault();

        dialogImage.src = source;
        dialogImage.alt = alt;
        if (dialogCaption) {
          dialogCaption.textContent = caption;
          dialogCaption.hidden = !caption;
        }

        returnFocus.set(dialog, trigger);
        dialog.showModal();
      });
    });
  }

  function localIsoDate(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function field(form, name, legacyName) {
    return form.elements.namedItem(name) || (legacyName ? form.elements.namedItem(legacyName) : null);
  }

  function fieldValue(form, name, legacyName) {
    return String(field(form, name, legacyName)?.value || "").trim();
  }

  function selectedLabel(control) {
    if (!control) return "";
    if (control instanceof HTMLSelectElement) {
      return control.selectedOptions[0]?.textContent?.trim() || control.value.trim();
    }
    return String(control.value || "").trim();
  }

  function readableDate(value) {
    if (!value) return "";
    const parsed = new Date(`${value}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return value;
    return new Intl.DateTimeFormat("en-PH", {
      year: "numeric",
      month: "long",
      day: "numeric"
    }).format(parsed);
  }

  function readableTime(value) {
    if (!value) return "";
    const parsed = new Date(`2000-01-01T${value}`);
    if (Number.isNaN(parsed.getTime())) return value;
    return new Intl.DateTimeFormat("en-PH", {
      hour: "numeric",
      minute: "2-digit"
    }).format(parsed);
  }

  function inquiryMessage(form) {
    const inquiryControl = field(form, "inquiry-type");
    const inquiryType = selectedLabel(inquiryControl) || form.dataset.inquiryForm || "General inquiry";
    const name = fieldValue(form, "name");
    const contact = fieldValue(form, "contact-number");
    const date = readableDate(fieldValue(form, "date"));
    const time = readableTime(fieldValue(form, "time"));
    const guests = fieldValue(form, "guest-count", "number-of-guests");
    const occasion = fieldValue(form, "occasion", "event-type");
    const notes = fieldValue(form, "notes", "message");

    const lines = [
      `Hello Yaelitos! I would like to inquire about: ${inquiryType}.`,
      "",
      `Name: ${name}`,
      `Contact number: ${contact}`,
      `Preferred date: ${date}`,
      `Preferred time: ${time}`,
      `Number of guests: ${guests}`
    ];

    if (occasion) lines.push(`Occasion: ${occasion}`);
    if (notes) lines.push(`Notes: ${notes}`);

    lines.push(
      "",
      "Please let me know if this is available. I understand this request is confirmed only after Yaelitos replies. Thank you!"
    );

    return lines.join("\n");
  }

  function setStatus(element, message, type = "info") {
    if (!element) return;
    element.textContent = message;
    element.dataset.status = type;
    element.classList.toggle("show", Boolean(message));
    element.setAttribute("role", "status");
    element.setAttribute("aria-live", "polite");
    element.setAttribute("aria-atomic", "true");
  }

  async function copyMessage(output) {
    const text = output.value;
    if (!text) return false;

    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {
        // Use the selection-based fallback below.
      }
    }

    output.focus();
    output.select();
    output.setSelectionRange(0, text.length);
    try {
      return document.execCommand("copy");
    } catch (_) {
      return false;
    }
  }

  function resultFor(form) {
    const localResult = form.querySelector("[data-inquiry-result]");
    if (localResult) return localResult;
    const region = form.closest("[data-inquiry]") || form.parentElement;
    return region?.querySelector("[data-inquiry-result]") || document.querySelector("[data-inquiry-result]");
  }

  function initInquiryForms() {
    const requestedType = new URLSearchParams(location.search).get("type");

    document.querySelectorAll("[data-inquiry-form]").forEach((form) => {
      const inquiryControl = field(form, "inquiry-type");
      const dateInput = field(form, "date");
      const formStatus = form.querySelector("[data-inquiry-status], .form-status");
      const result = resultFor(form);
      const output = result?.querySelector("[data-message-output]");
      const copyMessenger = result?.querySelector("[data-copy-messenger]");
      const smsLink = result?.querySelector("[data-sms-link]");
      const callLink = result?.querySelector("[data-call-link]");
      const actionStatus = result?.querySelector("[data-action-status]") || formStatus;
      let hasGeneratedMessage = false;

      if (requestedType && inquiryControl instanceof HTMLSelectElement) {
        const matchingOption = Array.from(inquiryControl.options).find((option) => option.value === requestedType);
        if (matchingOption) inquiryControl.value = matchingOption.value;
      }

      if (dateInput) {
        const today = localIsoDate();
        dateInput.min = today;
        const validateDate = () => {
          dateInput.setCustomValidity(dateInput.value && dateInput.value < today
            ? "Please choose today or a future date."
            : "");
        };
        dateInput.addEventListener("change", validateDate);
        dateInput.addEventListener("input", validateDate);
        validateDate();
      }

      if (output) output.readOnly = true;
      const messengerUrl = configValue("facebook.messengerUrl") || CONFIG.messengerUrl;
      const phoneHref = configValue("business.phoneHref") || CONFIG.phoneTel;
      const smsHref = configValue("business.smsHref") || CONFIG.phoneSms;

      if (copyMessenger && hasUsableValue(messengerUrl)) {
        if (copyMessenger instanceof HTMLAnchorElement) {
          copyMessenger.href = messengerUrl;
          copyMessenger.target = "_blank";
          copyMessenger.rel = "noopener noreferrer";
        }

        copyMessenger.addEventListener("click", async (event) => {
          if (!output?.value) {
            event.preventDefault();
            setStatus(actionStatus, "Complete the form first so we can prepare your message.", "error");
            return;
          }

          let messengerOpened = true;
          if (!(copyMessenger instanceof HTMLAnchorElement)) {
            event.preventDefault();
            const opened = window.open(messengerUrl, "_blank");
            if (opened) opened.opener = null;
            else {
              messengerOpened = false;
            }
          }

          const copied = await copyMessage(output);
          if (!messengerOpened && copied) {
            setStatus(actionStatus, "Details copied, but your browser blocked Messenger. Open the Facebook link, then paste your details there.", "error");
          } else if (!messengerOpened) {
            output.focus();
            output.select();
            setStatus(actionStatus, "Your browser blocked Messenger and automatic copy was unavailable. Copy the selected details, then open the Facebook link.", "error");
          } else if (copied) {
            setStatus(actionStatus, "Details copied. Paste them into Messenger, then wait for Yaelitos to confirm.", "success");
          } else {
            output.focus();
            output.select();
            setStatus(actionStatus, "Messenger opened, but automatic copy was unavailable. Copy the selected details manually, then paste them into Messenger.", "error");
          }
        });
      }

      if (callLink && hasUsableValue(phoneHref)) callLink.href = phoneHref;

      form.addEventListener("input", () => {
        if (!hasGeneratedMessage) return;
        hasGeneratedMessage = false;
        if (result) result.hidden = true;
        if (output) output.value = "";
        setStatus(formStatus, "Your details changed. Select \"Prepare my message\" again when you are ready.", "info");
      });

      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (dateInput) {
          const today = localIsoDate();
          dateInput.setCustomValidity(dateInput.value && dateInput.value < today
            ? "Please choose today or a future date."
            : "");
        }

        if (!form.reportValidity()) {
          setStatus(formStatus, "Please complete the highlighted fields and choose today or a future date.", "error");
          return;
        }

        if (!result || !output) {
          setStatus(formStatus, "Your details are valid, but the message panel is unavailable. Please call Yaelitos instead.", "error");
          return;
        }

        const message = inquiryMessage(form);
        output.value = message;
        result.hidden = false;
        result.classList.remove("is-prepared");
        if (!useLiteMotion) requestAnimationFrame(() => result.classList.add("is-prepared"));
        hasGeneratedMessage = true;

        if (smsLink && hasUsableValue(smsHref)) {
          smsLink.href = `${smsHref}?body=${encodeURIComponent(message)}`;
        }

        setStatus(formStatus, "Your message is ready below. Nothing has been sent yet; your request is confirmed only after Yaelitos replies.", "success");
        setStatus(actionStatus, "Choose Messenger, SMS, or call Yaelitos. Your typed details stay on this device until you send them.", "info");

        result.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          block: "nearest"
        });
      });
    });
  }

  function decorateActions() {
    document.querySelectorAll("[data-icon='phone']").forEach((button) => {
      if (!button.querySelector("svg")) button.insertAdjacentHTML("afterbegin", iconPaths.phone);
    });
    document.querySelectorAll("[data-icon='message']").forEach((button) => {
      if (!button.querySelector("svg")) button.insertAdjacentHTML("afterbegin", iconPaths.message);
    });
  }

  function start() {
    populateConfig();
    loadPublishedContent();
    setActiveNav();
    initMenu();
    initReveal();
    initGalleryDialogs();
    initInquiryForms();
    decorateActions();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
