(function exposeYaelitosAppConfig() {
  "use strict";

  window.YAELITOS_APP_CONFIG = Object.freeze({
    supabaseUrl: "",
    supabasePublishableKey: "",
    turnstileSiteKey: "",
    staffPath: "/staff/",
    idleMinutes: 30
  });
})();
