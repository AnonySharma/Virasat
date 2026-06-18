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
const CACHE_VERSION = "v1";
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
  "./lib/utils/i18n.js",
  "./lib/utils/data-store.js",
  "./lib/utils/photo-store.js",
  "./lib/utils/ui-utils.js",
  "./lib/components/heritage-datepicker.js",
  "./lib/components/heritage-select.js",
  "./lib/components/crop-editor.js",
  "./lib/components/inspector.js",
  "./lib/components/profile-view.js",
  "./lib/views/people-view.js",
  "./lib/views/tree-view.js",
  "./lib/views/timeline-view.js",
  "./lib/features/image-export.js",
  "./lib/features/export-import.js",
  "./lib/features/collect-form.js",
  "./lib/app.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
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
