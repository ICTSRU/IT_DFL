/* ICTD Digital File Library — front-end settings. Edit this file only. */
window.ICTD_LIB_CONFIG = {
  VERSION: "2.5",

  // 1) Apps Script Web App URL (Deploy > Manage deployments > Web app URL, ends with /exec)
  WEB_APP_URL: "https://script.google.com/macros/s/AKfycbwd5bCOgpH3bN3LfjYKx5G582LjtlBZ519kc3alzaTMiZVCTl6cfyBYqqmM_WfJHEOofA/exec",

  // 2) Google OAuth Web Client ID (same value as ClientID in the Config sheet)
  GOOGLE_CLIENT_ID: "286826767897-ptof53iq20gn5964e8ogvpk0c71cu944.apps.googleusercontent.com",

  // Sign-in hint shown to Google (the server enforces the domain, this only filters the account chooser)
  ALLOWED_DOMAIN: "sr.edu.sa",

  // Client-side upload limit in MB (the server enforces MaxUploadMB from the Config sheet as well)
  MAX_UPLOAD_MB: 40,

  // Logos: drop the files in assets/img/ or point to the shared ICTSRU/brand library URLs.
  LOGOS: {
    sru: "assets/img/sru-logo.png",
    ictd: "assets/img/ictd-logo.png",
    itoc: "assets/img/itoc-logo.png"
  },

  ITOC_HUB_URL: "https://ictsru.github.io/ITOC/#forms",
  SUPPORT_EMAIL: "itoc@sr.edu.sa",

  // Owner suggestions in the Add/Edit document form (ICTD team list)
  TEAM_NAMES: [
    "Dr. Nasser Abounar", "Mohamed ElMahdy", "Mohamed Nawaz", "Mohamed Omar", "Mohamed Saleh",
    "Ammar Alrowedan", "Nayed Alrashidi", "Abd Alazez Alawaji", "Azzam Alaqeel", "Asma Alolayan",
    "Shath Albusyli", "Inshrah Almutairi", "عاطف النادي", "سراج"
  ]
};
