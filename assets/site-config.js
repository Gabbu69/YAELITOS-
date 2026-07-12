(function exposeYaelitosConfig() {
  "use strict";

  const business = Object.freeze({
    name: "Yaelitos Restaurant",
    tagline: "Your Second Home",
    phoneDisplay: "0912-059-3992",
    phoneHref: "tel:+639120593992",
    smsHref: "sms:+639120593992",
    address: "Rizal St., Poblacion A, M'lang, Philippines 9402",
    directionsUrl: "https://www.google.com/maps/dir/?api=1&destination=Rizal%20St.%2C%20Poblacion%20A%2C%20M%27lang%2C%20Philippines%209402"
  });

  const facebook = Object.freeze({
    pageUrl: "https://www.facebook.com/profile.php?id=61557367387632",
    messengerUrl: "https://m.me/61557367387632",
    followersLabel: "9.5K followers",
    recommendationLabel: "92% recommend from 8 reviews",
    checkedOn: "Checked July 2026",
    reviewCount: "8 reviews"
  });

  const announcement = Object.freeze({
    enabled: false,
    text: "",
    label: "",
    href: ""
  });

  const socialProof = Object.freeze({
    followers: facebook.followersLabel,
    recommendation: facebook.recommendationLabel,
    checked: facebook.checkedOn,
    combined: `${facebook.followersLabel} - ${facebook.recommendationLabel} - checked July 2026`
  });

  window.YAELITOS_CONFIG = Object.freeze({
    business,
    facebook,
    announcement,
    socialProof,

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
