/**
 * Cloud configuration — the one switch that turns cloud sync on or off.
 *
 * This build is CLOUD-ENABLED: the credentials below are populated, so
 * isConfigured() returns true, the Supabase SDK is loaded lazily on boot,
 * and the app shows the sign-in gate. The anon key is SAFE to commit and
 * serve publicly — it only grants what the database's Row-Level Security
 * policies allow. RLS, not this file, is the security boundary. (Never put
 * the service_role key here.) Full setup lives in docs/CLOUD-SYNC-PLAN.md.
 *
 * To run LOCAL-FIRST instead, blank out supabaseUrl/supabaseAnonKey below:
 * isConfigured() then returns false, Auth.ready() resolves { cloud: false },
 * the SDK is never downloaded, and the app boots exactly as the offline,
 * single-device PWA it has always been — no network calls, no sign-in.
 */
(function (global) {
  "use strict";

  const config = {
    // From Supabase → Project Settings → API. e.g. "https://xxxx.supabase.co"
    supabaseUrl: "https://kogchpccsphiecitwaav.supabase.co",
    // The public "anon" key from the same page. Safe to ship in this file.
    supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvZ2NocGNjc3BoaWVjaXR3YWF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzNjQ3MzAsImV4cCI6MjEwMTk0MDczMH0.2-qhPqLRCOdO-0ShUAhOqAns9pUa0dL_Qjt5OgOyjyI",
    // Private Storage bucket for photos (created by the setup SQL).
    bucket: "tree-photos"
  };

  // Cloud is ON only when BOTH url and key are non-empty. A half-filled
  // config counts as OFF — better to run local-only than to half-initialise
  // a client that throws on its first call.
  config.isConfigured = function () {
    return !!(config.supabaseUrl && String(config.supabaseUrl).trim()
      && config.supabaseAnonKey && String(config.supabaseAnonKey).trim());
  };

  global.VirasatConfig = config;
})(window);
