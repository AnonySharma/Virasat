/**
 * Cloud store — the WRITE side of sync (the READ side lives in data-store's
 * hydrateFromRemote). Resolves the signed-in user's active tree, loads it into
 * FamilyStore, and pushes local edits back with a last-writer-wins optimistic
 * version guard.
 *
 * Contract (relied on by app.js boot gate, Phase 2 task #24):
 *   CloudStore.start()  → Promise. No-op (resolves immediately) when
 *                         Auth.isCloud() is false. Otherwise: resolve/create
 *                         the active tree, load it, hydrate FamilyStore, and
 *                         arm the dirty→push pipeline. Rejects only on a hard
 *                         load failure (caller falls back to the local cache).
 *   CloudStore.stop()   → tear down the dirty hook + pending push (sign-out).
 *   CloudStore.flush()  → force any pending push now (best-effort).
 *
 * Design notes:
 *   • data-store owns state + the optimistic-lock version (getVersion /
 *     setVersion / hydrateFromRemote); this file owns the network + the
 *     dirty→debounce→push loop. The two never import each other's internals.
 *   • The push is version-guarded (UPDATE ... WHERE id AND version=base). A
 *     0-row result means someone else advanced the row → conflict: fetch
 *     latest, fire the EXISTING virasat:cross-tab-conflict event (app.js
 *     already renders a banner for it), then hydrate the server's copy.
 *   • Realtime + offline replay are Phase 7; Phase 2 is load + guarded push.
 */
(function (global) {
  "use strict";

  const PUSH_DEBOUNCE_MS = 1500;   // coalesce a burst of edits into one push
  const EMPTY_DATA = { version: 2, people: [], marriages: {}, meta: {} };

  let started = false;
  let treeId = null;            // the active tree's uuid
  let offDirty = null;          // unsubscribe from FamilyStore.onDirty
  let pushTimer = null;
  let pushing = false;          // a push is in flight
  let dirtyAgain = false;       // an edit landed while a push was in flight

  function auth() { return global.Auth; }
  function client() { return auth() && auth().client && auth().client(); }
  function store() { return global.FamilyStore; }

  // Drop PhotoStore's object-URL cache whenever the active tree changes. A
  // cached URL is keyed by a globally-unique photoId so it can't mis-resolve
  // across trees, but revoking on switch frees the blobs the old tree's <img>s
  // held and forces getUrl to re-resolve against the now-active tree's cloud
  // context. IDB blobs are intentionally kept (offline switch-back repaint).
  function resetPhotoCache() {
    try {
      if (global.PhotoStore && typeof global.PhotoStore.resetCache === "function") {
        global.PhotoStore.resetCache();
      }
    } catch (e) { console.warn("photo cache reset failed:", e); }
  }

  // Resolve the tree to open: the user's own tree if they have one, else the
  // first tree they're a member of (shared with them), else create a fresh
  // one. RLS already scopes `select *` to rows the caller may see, so the
  // simplest correct query is "my rows, newest first".
  async function resolveTree(userId) {
    const db = client();
    // Own tree first (created_at asc → their original tree stays the default).
    const owned = await db.from("trees")
      .select("id")
      .eq("owner_id", userId)
      .order("created_at", { ascending: true })
      .limit(1);
    if (owned.error) throw owned.error;
    if (owned.data && owned.data.length) return owned.data[0].id;

    // No owned tree — a shared one? (RLS returns only trees I'm a member of.)
    const any = await db.from("trees")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1);
    if (any.error) throw any.error;
    if (any.data && any.data.length) return any.data[0].id;

    // Brand-new account with nothing shared: create an empty tree. The
    // on_tree_created trigger auto-adds the owner as a member. (Uploading an
    // existing local tree instead of an empty one is Phase 4 migration.)
    const created = await db.from("trees")
      .insert({
        owner_id: userId,
        title: familyTitle(),
        family_name: familyName(),
        data: EMPTY_DATA
      })
      .select("id")
      .single();
    if (created.error) throw created.error;
    return created.data.id;
  }

  function familyName() {
    try { return (store() && store().getFamilyName && store().getFamilyName()) || "Family"; }
    catch (_) { return "Family"; }
  }
  function familyTitle() {
    try { return (store() && store().getFamilyTitle && store().getFamilyTitle()) || "Family tree"; }
    catch (_) { return "Family tree"; }
  }

  // Load the active tree's data + version and hand it to FamilyStore.
  async function loadInto(id) {
    const res = await client().from("trees")
      .select("data, version")
      .eq("id", id)
      .single();
    if (res.error) throw res.error;
    const row = res.data || {};
    store().hydrateFromRemote(row.data || EMPTY_DATA, row.version || 1);
  }

  // The dirty→push loop. FamilyStore.onDirty fires after every mutating
  // persist(); we debounce, then push once.
  function schedulePush() {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { pushTimer = null; push().catch((e) => console.error("cloud push failed:", e)); }, PUSH_DEBOUNCE_MS);
  }

  async function push() {
    if (!treeId || !client()) return;
    // Serialise: if a push is already in flight, note that more edits arrived
    // and let the in-flight one re-schedule when it finishes.
    if (pushing) { dirtyAgain = true; return; }
    pushing = true;
    try {
      const base = store().getVersion();
      const snapshot = store().getState();
      const res = await client().from("trees")
        .update({ data: snapshot, version: base + 1 })
        .eq("id", treeId)
        .eq("version", base)
        .select("version")
        .single();

      // PostgREST returns an error with code PGRST116 when .single() matches
      // zero rows — that's our optimistic-lock conflict, not a hard failure.
      if (res.error && res.error.code !== "PGRST116") throw res.error;

      if (res.data && res.data.version != null) {
        // Clean win — advance our base version to match the server.
        store().setVersion(res.data.version);
      } else {
        // 0 rows updated → someone else advanced the row. Reconcile.
        await onConflict();
      }
    } finally {
      pushing = false;
      // Edits that landed mid-flight (or a conflict-hydrate we may want to
      // re-push over) get one more debounced pass.
      if (dirtyAgain) { dirtyAgain = false; schedulePush(); }
    }
  }

  // Last-writer-wins conflict: our version-guarded UPDATE hit 0 rows because a
  // newer version exists server-side. Warn via the EXISTING cross-tab banner
  // (app.js already renders it, with a Reload button), then hydrate the
  // server's copy so both sides converge. A richer "save my version as a
  // backup first" flow is Phase 8; for now the banner + toast tell the user to
  // export if they had unsynced edits, and nothing is lost silently.
  async function onConflict() {
    try {
      if (global.UI && global.UI.toast) {
        global.UI.toast("This tree changed on another device — reloading the latest. Export first if you had unsaved edits.", "warning");
      }
      if (typeof global.dispatchEvent === "function") {
        global.dispatchEvent(new CustomEvent("virasat:cross-tab-conflict"));
      }
    } catch (_) {}
    // Fetch + install the winning server copy. dirtyAgain is intentionally NOT
    // set here: hydrateFromRemote replaces our state wholesale, so there's
    // nothing local left to re-push.
    try { await loadInto(treeId); }
    catch (e) { console.error("conflict reload failed:", e); }
  }

  async function start() {
    if (started) return;
    if (!auth() || !auth().isCloud || !auth().isCloud()) return;   // local-only: no-op
    const user = auth().getUser && auth().getUser();
    if (!user || !user.id) return;                                 // signed out: no-op
    started = true;

    treeId = await resolveTree(user.id);
    resetPhotoCache();               // drop any local-only tree's cached photo URLs
    store().setActiveTree(treeId);   // repoint the local cache to this tree
    await loadInto(treeId);          // fetch + hydrate (sets base version)

    // Arm the pusher AFTER the initial hydrate (hydrate doesn't markDirty, so
    // no spurious first push). Every later mutation debounces into one push.
    offDirty = store().onDirty(schedulePush);
  }

  function stop() {
    if (offDirty) { offDirty(); offDirty = null; }
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    started = false;
    treeId = null;
    dirtyAgain = false;
    // Sign-out: release the just-closed tree's cached photo URLs. (The app
    // reloads right after sign-out, but revoking is cheap and correct.)
    resetPhotoCache();
  }

  // Force any pending push immediately (e.g. before sign-out / tab close).
  function flush() {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    return push().catch((e) => console.error("cloud flush failed:", e));
  }

  global.CloudStore = {
    start,
    stop,
    flush,
    isActive: () => started,
    activeTreeId: () => treeId
  };
})(window);
