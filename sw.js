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
const CACHE_VERSION = "v10";
const SHELL_CACHE = "virasat-shell-" + CACHE_VERSION;
const RUNTIME_CACHE = "virasat-runtime-" + CACHE_VERSION;
const CDN_CACHE = "virasat-cdn-" + CACHE_VERSION;

const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/icon.svg",
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
  "./lib/views/profile-view.js",
  "./lib/features/image-export.js",
  "./lib/features/export-import.js",
  "./lib/features/collect-form.js",
  "./lib/features/print-book.js",
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
      // Cross-origin fetches require `mode: "no-cors"` to be cacheable when
      // CORS headers are missing (Font Awesome's CDN, sometimes Google
      // Fonts depending on referer). We tolerate individual failures so a
      // network blip on first install doesn't abort the whole installation.
      caches.open(CDN_CACHE).then((cache) =>
        Promise.all(CDN_SHELL.map((url) =>
          fetch(url, { mode: "no-cors" })
            .then((resp) => cache.put(url, resp))
            .catch(() => {})
        ))
      )
    ]).then(() => self.skipWaiting())
  );
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
    || url.hostname === "cdnjs.cloudflare.com";
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Cross-origin fonts/icons → cache-first.
  if (isCdnHost(url)) {
    event.respondWith(
      caches.open(CDN_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const resp = await fetch(req);
          if (resp && resp.status === 200) cache.put(req, resp.clone());
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
