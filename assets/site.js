const SITE_CONTACT = {
  // Contact settings used by buttons and inquiry forms.
  phoneDisplay: "0912-059-3992",
  phoneHref: "tel:+639120593992",
  smsHref: "sms:+639120593992",
  messengerUrl: "https://m.me/yaelitosrestaurant",
  address: "Rizal St., Poblacion A, M'lang, North Cotabato"
};

const iconPaths = {
  phone: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.32 1.77.59 2.61a2 2 0 0 1-.45 2.11L8 9.69a16 16 0 0 0 6.31 6.31l1.25-1.25a2 2 0 0 1 2.11-.45c.84.27 1.71.47 2.61.59A2 2 0 0 1 22 16.92z"/></svg>',
  message: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>'
};

function setActiveNav() {
  const file = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav-links a").forEach((link) => {
    const href = link.getAttribute("href");
    if (href === file || (file === "" && href === "index.html")) {
      link.classList.add("active");
    }
  });
}

function initMenu() {
  const button = document.querySelector(".menu-toggle");
  const links = document.querySelector(".nav-links");
  if (!button || !links) return;
  button.addEventListener("click", () => {
    const open = links.classList.toggle("open");
    document.body.classList.toggle("menu-open", open);
    button.setAttribute("aria-expanded", String(open));
  });
}

function initReveal() {
  const items = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) {
    items.forEach((item) => item.classList.add("visible"));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.14 });
  items.forEach((item) => observer.observe(item));
}

function initContactLinks() {
  document.querySelectorAll("[data-contact='phone']").forEach((link) => {
    link.href = SITE_CONTACT.phoneHref;
  });
  document.querySelectorAll("[data-contact='sms']").forEach((link) => {
    link.href = SITE_CONTACT.smsHref;
  });
  document.querySelectorAll("[data-contact='messenger']").forEach((link) => {
    link.href = SITE_CONTACT.messengerUrl;
  });
  document.querySelectorAll("[data-phone-text]").forEach((el) => {
    el.textContent = SITE_CONTACT.phoneDisplay;
  });
}

function formatFormMessage(form, title) {
  const data = new FormData(form);
  const lines = [`${title} for Yaelitos`, ""];
  for (const [key, value] of data.entries()) {
    if (!value) continue;
    const label = key.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    lines.push(`${label}: ${value}`);
  }
  lines.push("", `Location: ${SITE_CONTACT.address}`);
  return lines.join("\n");
}

function initInquiryForms() {
  document.querySelectorAll("[data-inquiry-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const type = form.dataset.inquiryForm || "Inquiry";
      const message = formatFormMessage(form, type);
      const status = form.querySelector(".form-status");
      const body = encodeURIComponent(message);
      if (status) {
        status.textContent = "Your inquiry is ready. Opening your SMS app now. You can also send the same details through Facebook Messenger.";
        status.classList.add("show");
      }
      if (navigator.clipboard) {
        navigator.clipboard.writeText(message).catch(() => {});
      }
      window.location.href = `${SITE_CONTACT.smsHref}?&body=${body}`;
      form.reset();
    });
  });
}

function initLightbox() {
  const items = document.querySelectorAll(".gallery-item");
  const box = document.querySelector(".lightbox");
  const image = box ? box.querySelector("img") : null;
  const close = box ? box.querySelector("button") : null;
  if (!box || !image || !close || !items.length) return;
  items.forEach((item) => {
    item.addEventListener("click", () => {
      const img = item.querySelector("img");
      image.src = img.src;
      image.alt = img.alt;
      box.classList.add("open");
    });
  });
  close.addEventListener("click", () => box.classList.remove("open"));
  box.addEventListener("click", (event) => {
    if (event.target === box) box.classList.remove("open");
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") box.classList.remove("open");
  });
}

function decorateFloatingActions() {
  document.querySelectorAll("[data-icon='phone']").forEach((button) => {
    if (!button.querySelector("svg")) button.insertAdjacentHTML("afterbegin", iconPaths.phone);
  });
  document.querySelectorAll("[data-icon='message']").forEach((button) => {
    if (!button.querySelector("svg")) button.insertAdjacentHTML("afterbegin", iconPaths.message);
  });
}

setActiveNav();
initMenu();
initReveal();
initContactLinks();
initInquiryForms();
initLightbox();
decorateFloatingActions();
