(function initCustomerBooking() {
  "use strict";

  const appConfig = window.YAELITOS_APP_CONFIG || {};
  const siteConfig = window.YAELITOS_CONFIG || {};
  const form = document.querySelector("[data-booking-form]");
  if (!form) return;

  const result = document.querySelector("[data-inquiry-result]");
  const output = result?.querySelector("[data-message-output]");
  const formStatus = form.querySelector("[data-inquiry-status]");
  const actionStatus = result?.querySelector("[data-action-status]");
  const referenceElement = result?.querySelector("[data-booking-reference]");
  const resultEyebrow = result?.querySelector("[data-result-eyebrow]");
  const resultHeading = result?.querySelector("[data-result-heading]");
  const referenceHeading = result?.querySelector("[data-reference-heading]");
  const referenceDescription = result?.querySelector("[data-reference-description]");
  const serviceWarning = document.querySelector("[data-booking-service-warning]");
  const copyMessenger = result?.querySelector("[data-copy-messenger]");
  const smsLink = result?.querySelector("[data-sms-link]");
  const callLink = result?.querySelector("[data-call-link]");
  const submitButton = form.querySelector("button[type='submit']");
  const turnstileContainer = form.querySelector("[data-turnstile]");
  const dateInput = form.elements.namedItem("date");
  let turnstileWidgetId = null;
  let turnstileToken = "";
  let submissionId = crypto.randomUUID();
  let completed = false;

  function configValue(path) {
    return path.split(".").reduce((value, key) => value && typeof value === "object" ? value[key] : undefined, siteConfig);
  }

  function value(name) {
    return String(form.elements.namedItem(name)?.value || "").trim();
  }

  function localIsoDate(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function readableDate(raw) {
    const date = new Date(`${raw}T00:00:00`);
    return Number.isNaN(date.getTime()) ? raw : new Intl.DateTimeFormat("en-PH", {
      year: "numeric", month: "long", day: "numeric"
    }).format(date);
  }

  function readableTime(raw) {
    const date = new Date(`2000-01-01T${raw}`);
    return Number.isNaN(date.getTime()) ? raw : new Intl.DateTimeFormat("en-PH", {
      hour: "numeric", minute: "2-digit"
    }).format(date);
  }

  function inquiryLabel() {
    const select = form.elements.namedItem("inquiry-type");
    return select instanceof HTMLSelectElement
      ? select.selectedOptions[0]?.textContent?.trim() || select.value
      : "General inquiry";
  }

  function bookingMessage(reference = "") {
    const lines = [
      `Hello Yaelitos! I would like to inquire about: ${inquiryLabel()}.`,
      ""
    ];
    if (reference) lines.push(`Request reference: ${reference}`, "");
    lines.push(
      `Name: ${value("name")}`,
      `Contact number: ${value("contact-number")}`,
      `Preferred date: ${readableDate(value("date"))}`,
      `Preferred time: ${readableTime(value("time"))}`,
      `Number of guests: ${value("guest-count")}`
    );
    if (value("occasion")) lines.push(`Occasion: ${value("occasion")}`);
    if (value("notes")) lines.push(`Notes: ${value("notes")}`);
    lines.push("", "Please let me know if this is available. I understand this request is confirmed only after Yaelitos replies. Thank you!");
    return lines.join("\n");
  }

  function setStatus(element, message, type = "info") {
    if (!element) return;
    element.textContent = message;
    element.dataset.status = type;
    element.classList.toggle("show", Boolean(message));
  }

  function setFieldErrors(fields = {}) {
    const names = {
      inquiryType: "inquiry-type",
      name: "name",
      contactNumber: "contact-number",
      date: "date",
      time: "time",
      guestCount: "guest-count",
      occasion: "occasion",
      notes: "notes"
    };
    Object.values(names).forEach((name) => form.elements.namedItem(name)?.setCustomValidity(""));
    Object.entries(fields).forEach(([key, message]) => form.elements.namedItem(names[key])?.setCustomValidity(String(message)));
  }

  async function copyText() {
    if (!output?.value) return false;
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(output.value);
        return true;
      } catch {
        // Fall through to selection-based copy.
      }
    }
    output.focus();
    output.select();
    output.setSelectionRange(0, output.value.length);
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    }
  }

  function showResult(reference, saved, errorMessage = "") {
    if (!result || !output) return;
    const message = bookingMessage(reference);
    output.value = message;
    result.hidden = false;
    if (resultEyebrow) resultEyebrow.textContent = saved ? "Request received" : "Booking service unavailable";
    if (resultHeading) resultHeading.textContent = saved ? "Pending — waiting for Yaelitos" : "Your request was not saved";
    if (referenceHeading) referenceHeading.textContent = saved ? "Not yet confirmed" : "No online request was created";
    if (referenceDescription) referenceDescription.textContent = saved
      ? "Yaelitos must check the request and reply before it becomes a confirmed booking."
      : "Contact Yaelitos directly through Messenger, SMS, or phone. Keep your details below to copy or send.";
    referenceElement.textContent = reference || "Not saved";
    referenceElement.closest("[data-reference-panel]")?.classList.toggle("is-unsaved", !saved);
    if (smsLink) {
      const smsHref = configValue("business.smsHref") || "sms:+639120593992";
      smsLink.href = `${smsHref}?body=${encodeURIComponent(message)}`;
    }
    if (callLink) callLink.href = configValue("business.phoneHref") || "tel:+639120593992";
    setStatus(actionStatus, saved
      ? "Your request is Pending. Messenger, SMS, and phone are optional ways to follow up. Yaelitos must reply before it is confirmed."
      : `${errorMessage || "This request was not saved."} Use Messenger, SMS, or phone to contact Yaelitos directly.`,
    saved ? "success" : "error");
    result.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "nearest"
    });
  }

  async function loadTurnstile() {
    const siteKey = String(appConfig.turnstileSiteKey || "").trim();
    if (!siteKey || !turnstileContainer) return;
    if (!window.turnstile) {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        script.onload = resolve;
        script.onerror = reject;
        document.head.append(script);
      });
    }
    turnstileWidgetId = window.turnstile.render(turnstileContainer, {
      sitekey: siteKey,
      theme: "light",
      action: "booking_request",
      callback: (token) => { turnstileToken = token; },
      "expired-callback": () => { turnstileToken = ""; },
      "error-callback": () => { turnstileToken = ""; }
    });
  }

  function resetTurnstile() {
    turnstileToken = "";
    if (window.turnstile && turnstileWidgetId !== null) window.turnstile.reset(turnstileWidgetId);
  }

  if (dateInput instanceof HTMLInputElement) {
    dateInput.min = localIsoDate();
    const validateDate = () => dateInput.setCustomValidity(
      dateInput.value && dateInput.value < localIsoDate() ? "Please choose today or a future date." : ""
    );
    dateInput.addEventListener("input", validateDate);
    dateInput.addEventListener("change", validateDate);
  }

  const requestedType = new URLSearchParams(location.search).get("type");
  const inquirySelect = form.elements.namedItem("inquiry-type");
  if (requestedType && inquirySelect instanceof HTMLSelectElement && [...inquirySelect.options].some((option) => option.value === requestedType)) {
    inquirySelect.value = requestedType;
  }

  form.addEventListener("input", () => {
    setFieldErrors();
    if (!completed) return;
    completed = false;
    submissionId = crypto.randomUUID();
    if (result) result.hidden = true;
    setStatus(formStatus, "Your details changed. Submit the form again to save the updated request.", "info");
  });

  copyMessenger?.addEventListener("click", async () => {
    const copied = await copyText();
    setStatus(actionStatus, copied
      ? "Details copied. Paste them into Messenger, then wait for Yaelitos to reply."
      : "Messenger opened, but automatic copy was unavailable. Copy the selected details manually.",
    copied ? "success" : "error");
  });

  if (!String(appConfig.supabaseUrl || "").trim() || !String(appConfig.supabasePublishableKey || "").trim() || !String(appConfig.turnstileSiteKey || "").trim()) {
    if (serviceWarning) serviceWarning.hidden = false;
    if (turnstileContainer) turnstileContainer.hidden = true;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFieldErrors();
    if (dateInput instanceof HTMLInputElement) {
      dateInput.setCustomValidity(dateInput.value && dateInput.value < localIsoDate()
        ? "Please choose today or a future date."
        : "");
    }
    if (!form.reportValidity()) {
      setStatus(formStatus, "Please complete the highlighted fields and choose today or a future date.", "error");
      return;
    }

    const supabaseUrl = String(appConfig.supabaseUrl || "").replace(/\/$/, "");
    const publishableKey = String(appConfig.supabasePublishableKey || "").trim();
    if (!supabaseUrl || !publishableKey || !String(appConfig.turnstileSiteKey || "").trim()) {
      showResult("", false, "Online booking storage has not been configured yet.");
      setStatus(formStatus, "Your details were not saved. Contact Yaelitos using one of the options below.", "error");
      return;
    }
    if (!turnstileToken) {
      setStatus(formStatus, "Please complete the security check before submitting.", "error");
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Saving request...";
    setStatus(formStatus, "Saving your Pending request securely...", "info");

    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/submit-booking`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": publishableKey
        },
        body: JSON.stringify({
          submissionId,
          inquiryType: value("inquiry-type"),
          name: value("name"),
          contactNumber: value("contact-number"),
          date: value("date"),
          time: value("time"),
          guestCount: Number(value("guest-count")),
          occasion: value("occasion"),
          notes: value("notes"),
          turnstileToken
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFieldErrors(data.fields || {});
        if (data.fields && Object.keys(data.fields).length) form.reportValidity();
        showResult("", false, data.error || "The booking service could not save this request.");
        setStatus(formStatus, data.error || "Your request was not saved.", "error");
        resetTurnstile();
        return;
      }

      completed = true;
      showResult(data.reference, true);
      setStatus(formStatus, `Request ${data.reference} was saved as Pending. It is confirmed only after Yaelitos replies.`, "success");
    } catch {
      showResult("", false, "The booking service could not be reached.");
      setStatus(formStatus, "Your request was not saved. Check your connection or contact Yaelitos directly.", "error");
      resetTurnstile();
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Save my Pending request";
    }
  });

  loadTurnstile().catch(() => {
    if (serviceWarning) serviceWarning.hidden = false;
    setStatus(formStatus, "The security check could not load. You can still contact Yaelitos through Messenger, SMS, or phone.", "error");
  });
})();
