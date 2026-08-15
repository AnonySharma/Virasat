/**
 * Virasat service worker — offline-first app shell.
 *
 * Strategy:
 *   - install: precache the app shell (HTML, CSS, JS, icon).
 *   - same-origin GET: stale-while-revalidate. Returns the cached copy
 *     immediately when available, then refreshes the cache in the
 *     background so the next visit gets the new version.
 *   - cross-origin GET (Google Fonts, Font Awesome): cache-first with
 *     a long TTL — these rarely change and we want offline parity.
 *   - non-GET (e.g. analytics beacons): pass through, never cached.
 *
 * Cache version is part of the cache name, so bumping CACHE_VERSION on
 * a release activates a clean replacement during `activate`.
 */
const CACHE_VERSION = "v65";
const SHELL_CACHE = "virasat-shell-" + CACHE_VERSION;
const RUNTIME_CACHE = "virasat-runtime-" + CACHE_VERSION;
const CDN_CACHE = "virasat-cdn-" + CACHE_VERSION;

const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/icon.svg",
  "./assets/apple-touch-icon.png",
  "./assets/tree.svg",
  "./assets/wedding-rings.svg",
  "./styles/tokens.css",
  "./styles/base.css",
  "./styles/components.css",
  "./styles/views.css",
  "./lib/core/i18n.js",
  "./lib/core/data-store.js",
  "./lib/core/photo-store.js",
  "./lib/ui/dom.js",
  "./lib/components/heritage-datepicker.js",
  "./lib/components/heritage-select.js",
  "./lib/components/crop-editor.js",
  "./lib/components/path-finder.js",
  "./lib/components/inspector.js",
  "./lib/views/people-view.js",
  "./lib/views/tree-view.js",
  "./lib/views/timeline-view.js",
  "./lib/views/insights-view.js",
  "./lib/features/image-export.js",
  "./lib/features/export-import.js",
  "./lib/features/collect-form.js",
  "./lib/features/print-book.js",
  "./lib/features/help-guide.js",
  "./lib/auth/config.js",
  "./lib/auth/auth-store.js",
  "./lib/auth/cloud-store.js",
  "./lib/auth/sign-in.js",
  "./lib/auth/first-run.js",
  "./lib/auth/tree-list.js",
  "./lib/auth/sharing.js",
  "./tests/sample-data.js",
  "./lib/app.js"
];

// Cross-origin third-party CSS the page loads on every visit. Pre-caching
// these means the very first offline boot has fonts and icons. The actual
// .woff2 / .ttf files referenced from inside the CSS are picked up by the
// runtime cache-first handler the first time they're fetched.
const CDN_SHELL = [
  "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT@9..144,400..700,30..100&family=Inter:wght@400;500;600;700&family=Noto+Serif+Devanagari:wght@400;500;600&display=swap",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)),
      // Fetch these in CORS mode (the default), NOT no-cors. The page loads
      // Font Awesome's CSS with integrity=... crossorigin, and Subresource
      // Integrity CANNOT be verified against an opaque (no-cors) response — the
      // browser rejects the stylesheet and icons silently vanish until a hard
      // refresh bypasses us. Both CDNs send `access-control-allow-origin: *`,
      // so a normal CORS fetch yields a verifiable response we can safely
      // cache. Only store a real 200 (never an opaque type). Individual
      // failures are tolerated so a first-install network blip doesn't abort.
      caches.open(CDN_CACHE).then((cache) =>
        Promise.all(CDN_SHELL.map((url) =>
          fetch(url)
            .then((resp) => { if (resp && resp.status === 200 && resp.type !== "opaque") return cache.put(url, resp); })
            .catch(() => {})
        ))
      )
    ])
    // Deliberately NOT skipWaiting() here. A fresh deploy parks this worker in
    // `waiting` while the open tab keeps running the old code; the page shows a
    // "new version ready" prompt and messages SKIP_WAITING (below) only when the
    // user accepts — so we never hot-swap code out from under an in-progress
    // edit (the app has no keystroke-level autosave).
  );
});

// The page requests takeover when the user accepts the update prompt. This is
// the ONLY path to skipWaiting, so activation is always user-consented.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((k) => k.startsWith("virasat-") && ![SHELL_CACHE, RUNTIME_CACHE, CDN_CACHE].includes(k))
        .map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

function isCdnHost(url) {
  return url.hostname === "fonts.googleapis.com"
    || url.hostname === "fonts.gstatic.com"
    || url.hostname === "cdnjs.cloudflare.com"
    // Supabase JS SDK (loaded lazily by auth-store.js when cloud is enabled).
    // Cache-first so an offline relaunch still has the client code.
    || url.hostname === "cdn.jsdelivr.net";
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Supabase API (auth, data, storage) must NEVER be cached — responses are
  // per-user, auth'd, and change constantly. The cross-origin bail below
  // already lets these through; this explicit guard makes the intent clear
  // and survives any future reordering of the handlers above it.
  if (url.hostname.endsWith(".supabase.co")) return;

  // Cross-origin fonts/icons/SDK → cache-first. Never cache an opaque
  // response: a CSS loaded with SRI (Font Awesome) can't be integrity-checked
  // against an opaque body, so caching one would break icons on the next
  // visit. The request keeps its own mode (a `crossorigin` <link> is already
  // CORS), so a cacheable 200 here is CORS-clean and verifiable.
  if (isCdnHost(url)) {
    event.respondWith(
      caches.open(CDN_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const resp = await fetch(req);
          if (resp && resp.status === 200 && resp.type !== "opaque") cache.put(req, resp.clone());
          return resp;
        } catch (e) {
          return hit || new Response("", { status: 504 });
        }
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Never serve a cached service worker. Browsers fetch `sw.js` to detect
  // updates; a cached copy here would freeze the version number forever.
  // The browser already byte-compares it to the registered one, so going
  // straight to network is safe and correct.
  if (url.pathname.endsWith("/sw.js") || url.pathname === "/sw.js") {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // Same-origin → stale-while-revalidate.
  event.respondWith(
    caches.open(RUNTIME_CACHE).then(async (cache) => {
      const cached = await cache.match(req) || await caches.match(req);
      const network = fetch(req).then((resp) => {
        if (resp && resp.status === 200 && resp.type === "basic") {
          cache.put(req, resp.clone());
        }
        return resp;
      }).catch(() => null);
      if (cached) {
        // Refresh in the background, return the cached copy now.
        event.waitUntil(network);
        return cached;
      }
      const fresh = await network;
      if (fresh) return fresh;
      // Last-ditch: serve the cached index for navigation requests so the
      // SPA can boot offline even on URLs we never visited online.
      if (req.mode === "navigate") {
        const fallback = await caches.match("./index.html");
        if (fallback) return fallback;
      }
      return new Response("Offline", { status: 504, statusText: "Offline" });
    })
  );
});
