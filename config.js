// config.js
// Ab yahan koi secret nahi hai. Sirf public config.
window.RAJX_CONFIG = {
  // Frontend API secret (Netlify env var "API_SECRET" ke saath same hona chahiye)
  API_SECRET: "rajx_9f8a7b6c5d4e3f2a1b",

  // Public links
  TELEGRAM_LINK: "https://t.me/+3p5F9JVFaAA1MzBl",
  PANEL_LINK: "https://otppannels.netlify.app/",

  // Default Firebase auth key used as fallback
  DEFAULT_FB_KEY: "@FREEOTPPANNELS",

  // API endpoint (Netlify function)
  API_ENDPOINT: "/.netlify/functions/api"
};