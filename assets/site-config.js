(function exposeYaelitosConfig() {
  "use strict";

  const business = Object.freeze({
    name: "Yaelitos Restaurant",
    tagline: "Your Second Home",
    phoneDisplay: "0912-059-3992",
    phoneHref: "tel:+639120593992",
    smsHref: "sms:+639120593992",
    address: "Rizal St., Poblacion A, M'lang, Philippines 9402",
    directionsUrl: "https://maps.app.goo.gl/E2DxXaYfcfcTgu41A"
  });

  const facebook = Object.freeze({
    pageUrl: "https://www.facebook.com/profile.php?id=61557367387632",
    messengerUrl: "https://m.me/61557367387632"
  });

  const announcement = Object.freeze({
    enabled: false,
    text: "",
    label: "",
    href: ""
  });

  window.YAELITOS_CONFIG = Object.freeze({
    business,
    facebook,
    announcement,

    // Flat aliases keep older markup working while pages use the nested config.
    businessName: business.name,
    tagline: business.tagline,
    phoneDisplay: business.phoneDisplay,
    phoneTel: business.phoneHref,
    phoneSms: business.smsHref,
    address: business.address,
    postcode: "9402",
    directionsUrl: business.directionsUrl,
    facebookUrl: facebook.pageUrl,
    messengerUrl: facebook.messengerUrl
  });
})();
