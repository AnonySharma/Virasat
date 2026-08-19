// @ts-check
/**
 * PublicView — the no-login, read-only "anyone with the link" boot path.
 *
 * An owner can share a tree as *unlisted*: the app mints a random share_token
 * and the owner hands out a link of the form
 *
 *     https://…/Virasat/?v=<treeId>&k=<shareToken>
 *
 * Opening that link shows the tree read-only WITHOUT any sign-in. This module
 * owns exactly that path and nothing else:
 *
 *   PublicView.isPublicView()  → true when the URL carries a ?v=&k= pair. The
 *                                boot gate (app.js) checks this BEFORE the
 *                                sign-in gate so a link visitor never sees it.
 *   PublicView.boot()          → Promise<boolean>. Fetches the shared tree via
 *                                the anon-callable get_shared_tree RPC, hydrates
 *                                FamilyStore, forces read-only, and returns true
 *                                on success (false → an error screen is shown).
 *   PublicView.isActive()      → true once a shared tree has loaded (so app.js
 *                                refreshers + the viewer banner can special-case
 *                                the anonymous-visitor state).
 *
 * Why this is safe with just the public anon key: get_shared_tree is a
 * SECURITY DEFINER RPC gated on (visibility='unlisted' AND share_token matches).
 * The tree id alone is useless — the token is the secret. The RPC returns the
 * blob already REDACTED (private phone/email/address stripped server-side via
 * the same redact_person the signed-in viewer path uses), so a link visitor can
 * never read a field the owner marked private, not even in DevTools.
 *
 * What this path deliberately does NOT do: no push pipeline, no realtime
 * channel, no membership lookup, no account menu — a public visitor is a pure
 * reader. It reuses the exact read-only levers a viewer-role member trips
 * (FamilyStore.setReadOnly(true) + body.is-viewer), so the whole hardened
 * view-only UI applies unchanged.
 */
(function (global) {
  "use strict";

  // Loose uuid shape (8-4-4-4-12 hex). Both the tree id and the token are uuids;
  // reject anything else up front so a truncated/garbled link shows the "not
  // available" screen rather than firing a doomed RPC.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  let active = false;          // a shared tree has successfully loaded
  let familyName = "";         // for the shell title / banner
  let familyTitle = "";

  function t(key, vars) { return global.I18n ? global.I18n.t(key, vars) : key; }

  // Read the ?v=<treeId>&k=<token> pair from the query string. Returns
  // { treeId, token } or null. Uses the query (not the #hash) on purpose: the
  // hash is the app's own #tree/#people view router, and PKCE returns ?code= in
  // the query — neither collides with these two distinct keys.
  function parseLink() {
    try {
      const p = new global.URLSearchParams(global.location.search || "");
      const treeId = p.get("v");
      const token = p.get("k");
      if (!treeId || !token) return null;
      return { treeId: treeId, token: token };
    } catch (_) {
      return null;
    }
  }

  function isPublicView() {
    return !!parseLink();
  }

  function isActive() { return active; }

  function client() {
    const a = global.Auth;
    return (a && a.client && a.client()) || null;
  }

  // Full-viewport message when a link can't be honoured (SDK blocked, malformed
  // link, tree un-shared, or wrong/rotated token). Reuses the .signin jali
  // backdrop for visual continuity. Deliberately vague — "not available" covers
  // every failure without revealing whether a given tree exists.
  function showUnavailable() {
    try {
      if (global.document) {
        global.document.documentElement.classList.remove("is-booting");
      }
      const UI = global.UI;
      const wrap = (global.document && global.document.createElement) ? global.document.createElement("div") : null;
      if (!wrap || !UI) return;
      wrap.className = "signin app-splash public-view-error";
      wrap.setAttribute("role", "alert");
      const inner = global.document.createElement("div");
      inner.className = "app-splash__inner public-view-error__inner";
      const ico = global.document.createElement("i");
      ico.className = "fa-solid fa-link-slash public-view-error__icon";
      ico.setAttribute("aria-hidden", "true");
      const title = global.document.createElement("div");
      title.className = "public-view-error__title";
      title.textContent = t("publicView.unavailableTitle");
      const msg = global.document.createElement("div");
      msg.className = "public-view-error__msg";
      msg.textContent = t("publicView.unavailableBody");
      // A way out that doesn't expose the failed link: open the app at its own
      // origin (drops the query), landing on the sign-in gate.
      const open = global.document.createElement("a");
      open.className = "btn btn--primary public-view-error__cta";
      open.href = (function () { try { return global.location.origin + global.location.pathname; } catch (_) { return "#"; } })();
      const openIco = global.document.createElement("i");
      openIco.className = "fa-solid fa-arrow-right-to-bracket";
      openIco.setAttribute("aria-hidden", "true");
      const openLab = global.document.createElement("span");
      openLab.textContent = t("publicView.openApp");
      open.appendChild(openIco);
      open.appendChild(openLab);
      inner.appendChild(ico);
      inner.appendChild(title);
      inner.appendChild(msg);
      inner.appendChild(open);
      wrap.appendChild(inner);
      if (global.document.body) global.document.body.appendChild(wrap);
    } catch (e) {
      console.error("public-view error screen failed:", e);
    }
  }

  // Load the shared tree read-only. Resolves true on success (caller then boots
  // the app over the hydrated, read-only state), false on any failure (an error
  // screen is shown and the caller must NOT boot the normal app).
  async function boot() {
    const link = parseLink();
    if (!link) return false;
    if (!UUID_RE.test(link.treeId) || !UUID_RE.test(link.token)) {
      showUnavailable();
      return false;
    }

    const store = global.FamilyStore;
    if (!store || typeof store.hydrateFromRemote !== "function") {
      showUnavailable();
      return false;
    }

    // Bring the anon Supabase client up (Auth.ready loads the SDK lazily). If
    // cloud is disabled or the SDK is blocked, there's no backend to read from.
    let auth = global.Auth;
    if (auth && typeof auth.ready === "function") {
      try { await auth.ready(); } catch (_) {}
    }
    const c = client();
    if (!c || typeof c.rpc !== "function") {
      showUnavailable();
      return false;
    }

    // The one anon read. The RPC returns null (not an error) for unknown tree /
    // not-shared / wrong token, so both branches converge on "unavailable".
    let payload = null;
    try {
      const res = await c.rpc("get_shared_tree", { p_tree: link.treeId, p_token: link.token });
      if (res && res.error) { console.warn("get_shared_tree failed:", res.error.message || res.error); }
      payload = (res && res.data) || null;
    } catch (e) {
      console.warn("get_shared_tree threw:", e);
    }
    if (!payload || !payload.data) {
      showUnavailable();
      return false;
    }

    familyName = payload.family_name || "";
    familyTitle = payload.title || "";

    // Point the photo pipeline + local cache at this tree BEFORE hydrating, so
    // PhotoStore.getUrl resolves "<treeId>/<photoId>.jpg" against the bucket
    // (the photos_read_shared policy serves them to anon for an unlisted tree).
    // Same order start() uses: setActiveTree (no network) then install the data.
    try { store.setActiveTree(link.treeId); } catch (e) { console.warn("setActiveTree failed:", e); }

    // Make sure the header shows the family's name even if an older blob's meta
    // is thin — patch from the RPC's own title/family_name columns.
    const data = payload.data;
    try {
      if (data && typeof data === "object") {
        data.meta = data.meta || {};
        if (!data.meta.familyName && familyName) data.meta.familyName = familyName;
        if (!data.meta.familyTitle && familyTitle) data.meta.familyTitle = familyTitle;
      }
    } catch (_) {}

    // Install the (already server-redacted) blob. hydrateFromRemote never marks
    // dirty, so nothing can push — but we also never arm a pusher, so a public
    // visitor is structurally incapable of writing back.
    store.hydrateFromRemote(data, payload.version || 1);

    // Reuse the hardened view-only levers a viewer-role member trips: the store
    // guard blocks every mutation, and body.is-viewer hides all .js-edit-only
    // affordances via CSS. active=true lets app.js special-case the banner/chrome.
    try { if (store.setReadOnly) store.setReadOnly(true); } catch (_) {}
    try {
      if (global.document && global.document.body && global.document.body.classList) {
        global.document.body.classList.add("is-viewer");
      }
    } catch (_) {}

    active = true;
    return true;
  }

  global.PublicView = {
    isPublicView,
    isActive,
    boot,
    familyName: () => familyName,
    familyTitle: () => familyTitle
  };
})(window);
