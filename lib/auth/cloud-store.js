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
  // Which tree the user last had open, so a returning session reopens it
  // instead of always snapping back to their oldest owned tree. Cleared on
  // sign-out. Global (not per-user) — a device is used by one account at a
  // time, and RLS re-validates access before we honour it.
  const ACTIVE_TREE_KEY = "virasat.activeTreeId";
  function readSavedTree() {
    try { return global.localStorage.getItem(ACTIVE_TREE_KEY) || null; } catch (_) { return null; }
  }
  function saveActiveTree(id) {
    try {
      if (id) global.localStorage.setItem(ACTIVE_TREE_KEY, id);
      else global.localStorage.removeItem(ACTIVE_TREE_KEY);
    } catch (_) {}
  }

  let started = false;
  let treeId = null;            // the active tree's uuid
  let userId = null;            // the signed-in user's uuid (captured in start)
  let currentRole = null;       // "owner" | "editor" | "viewer" for the active tree
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

  // Push the active tree's role into the two UI/data levers: the store's
  // read-only guard (so a viewer's edit can't create unsyncable local state)
  // and a `body.is-viewer` class the stylesheet uses to hide edit affordances.
  // A null role (couldn't read membership) is treated as read-only — fail safe.
  function applyRole() {
    const canEdit = currentRole === "owner" || currentRole === "editor";
    try { if (store() && store().setReadOnly) store().setReadOnly(!canEdit); } catch (_) {}
    try {
      if (global.document && global.document.body && global.document.body.classList) {
        global.document.body.classList.toggle("is-viewer", !canEdit);
      }
    } catch (_) {}
  }

  // Resolve the tree to open on sign-in: the last-active tree if the user still
  // has access to it, else the user's oldest owned tree, else the oldest tree
  // shared with them, else a fresh empty one. RLS scopes every `select` to rows
  // the caller may see, so an invalid/revoked saved id simply returns 0 rows
  // and falls through — no leak, no crash.
  async function resolveTree(uid) {
    const db = client();

    // Prefer the tree the user last had open (across the whole account, owned
    // OR shared) — but only if it's still visible to them under RLS.
    const saved = readSavedTree();
    if (saved) {
      const hit = await db.from("trees").select("id").eq("id", saved).limit(1);
      if (!hit.error && hit.data && hit.data.length) return hit.data[0].id;
    }

    // Own tree first (created_at asc → their original tree stays the default).
    const owned = await db.from("trees")
      .select("id")
      .eq("owner_id", uid)
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
    // existing local tree instead of an empty one is done via Import JSON,
    // which loads into the active tree and pushes.)
    const created = await db.from("trees")
      .insert({
        owner_id: uid,
        title: familyTitle(),
        family_name: familyName(),
        data: EMPTY_DATA
      })
      .select("id")
      .single();
    if (created.error) throw created.error;
    return created.data.id;
  }

  // Fetch the caller's role on a tree from tree_members. Falls back to null
  // (treated as read-only by the UI) if the row can't be read. RLS lets a
  // member read their own membership row via the members_select policy.
  async function loadRole(id) {
    try {
      const res = await client().from("tree_members")
        .select("role")
        .eq("tree_id", id)
        .eq("user_id", userId)
        .single();
      if (res.error) { currentRole = null; return; }
      currentRole = (res.data && res.data.role) || null;
    } catch (_) { currentRole = null; }
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
    userId = user.id;

    treeId = await resolveTree(userId);
    saveActiveTree(treeId);          // remember it for the next session
    await loadRole(treeId);          // owner / editor / viewer for UI gating
    applyRole();                     // read-only guard + body.is-viewer class
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
    userId = null;
    currentRole = null;
    // Sign-out returns to editable local-only mode — explicitly clear the
    // read-only guard + body class (NOT via applyRole(), whose null-role
    // fail-safe would leave it read-only).
    try { if (store() && store().setReadOnly) store().setReadOnly(false); } catch (_) {}
    try {
      if (global.document && global.document.body && global.document.body.classList) {
        global.document.body.classList.toggle("is-viewer", false);
      }
    } catch (_) {}
    dirtyAgain = false;
    // Sign-out: forget the active tree so the next account on this device
    // resolves its OWN default rather than trying (and failing RLS) to reopen
    // a tree it can't see.
    saveActiveTree(null);
    // Release the just-closed tree's cached photo URLs. (The app reloads right
    // after sign-out, but revoking is cheap and correct.)
    resetPhotoCache();
  }

  // Force any pending push immediately (e.g. before sign-out / tab close).
  function flush() {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    return push().catch((e) => console.error("cloud flush failed:", e));
  }

  // — Multi-tree API (Phase 5) —————————————————————————————————————————————
  // A user can own and/or be a member of several trees. The switcher UI
  // (tree-list.js) drives all of this; cloud-store owns the network + the
  // careful teardown/re-arm of the push pipeline so a switch never leaks edits
  // between trees.

  // Every tree visible to the caller, newest-touched first, each tagged with
  // the caller's role. RLS already scopes both selects to the caller's rows.
  async function listTrees() {
    if (!started || !client()) return [];
    const db = client();
    const treesRes = await db.from("trees")
      .select("id, title, family_name, owner_id, updated_at")
      .order("updated_at", { ascending: false });
    if (treesRes.error) throw treesRes.error;
    const rows = treesRes.data || [];

    // Roles come from tree_members; one query for all my memberships, joined
    // client-side. (members_select RLS returns rows for trees I belong to.)
    const roleByTree = {};
    try {
      const mem = await db.from("tree_members")
        .select("tree_id, role")
        .eq("user_id", userId);
      if (!mem.error && mem.data) {
        mem.data.forEach((m) => { roleByTree[m.tree_id] = m.role; });
      }
    } catch (_) {}

    return rows.map((t) => ({
      id: t.id,
      title: t.title || "Untitled family tree",
      familyName: t.family_name || "Family",
      owned: t.owner_id === userId,
      role: roleByTree[t.id] || (t.owner_id === userId ? "owner" : null),
      active: t.id === treeId
    }));
  }

  // Create a fresh empty tree owned by the caller and switch to it. The
  // on_tree_created trigger adds the owner membership row. Returns the new id.
  async function createTree(title, familyNameArg) {
    if (!started || !client()) throw new Error("Cloud is not active");
    const cleanTitle = String(title || "").trim() || "Untitled family tree";
    const cleanFamily = String(familyNameArg || "").trim() || "Family";
    const created = await client().from("trees")
      .insert({
        owner_id: userId,
        title: cleanTitle,
        family_name: cleanFamily,
        data: Object.assign({}, EMPTY_DATA, { meta: { familyName: cleanFamily, familyTitle: cleanTitle } })
      })
      .select("id")
      .single();
    if (created.error) throw created.error;
    await switchTree(created.data.id);
    return created.data.id;
  }

  // Point the whole store at a different tree. Mirrors start()'s load sequence
  // but tears the pusher DOWN first (so no stale debounce pushes the old tree's
  // edits into the new row) and re-arms it after the hydrate. A pending push to
  // the OUTGOING tree is flushed first so its last edit isn't stranded.
  async function switchTree(nextId) {
    if (!started || !client()) throw new Error("Cloud is not active");
    if (!nextId || nextId === treeId) return;

    // 1. Detach the pusher and flush any pending edit to the CURRENT tree.
    if (offDirty) { offDirty(); offDirty = null; }
    await flush();                   // guarded UPDATE still targets the old treeId

    // 2. Repoint. setActiveTree flushes the outgoing cache under its old key,
    //    then loads the incoming tree's cached snapshot for an instant paint.
    treeId = nextId;
    dirtyAgain = false;
    saveActiveTree(treeId);
    await loadRole(treeId);
    applyRole();
    resetPhotoCache();
    store().setActiveTree(treeId);

    // 3. Fresh remote load, then re-arm the pusher (post-hydrate, so the
    //    hydrate itself doesn't bounce back as a push).
    await loadInto(treeId);
    offDirty = store().onDirty(schedulePush);

    // 4. Realtime re-subscribes to the new row (no-op until Phase 7 wires it).
    if (typeof onTreeSwitched === "function") { try { onTreeSwitched(treeId); } catch (_) {} }
  }

  // Rename a tree (owner/editor only; RLS enforces). Updates title + family
  // name on the row; if it's the active tree, mirror into local meta so the
  // header reflects it immediately without a reload.
  async function renameTree(id, title, familyNameArg) {
    if (!started || !client()) throw new Error("Cloud is not active");
    const patch = {};
    if (title != null) patch.title = String(title).trim() || "Untitled family tree";
    if (familyNameArg != null) patch.family_name = String(familyNameArg).trim() || "Family";
    const res = await client().from("trees").update(patch).eq("id", id).select("id").single();
    if (res.error) throw res.error;
    if (id === treeId) {
      if (patch.family_name && store().setFamilyName) store().setFamilyName(patch.family_name);
      if (patch.title && store().setFamilyTitle) store().setFamilyTitle(patch.title);
    }
  }

  // Delete a tree (owner only; RLS enforces). If it's the active tree, switch
  // to whatever remains first so the app is never left pointing at a dead row.
  async function deleteTree(id) {
    if (!started || !client()) throw new Error("Cloud is not active");
    if (id === treeId) {
      const others = (await listTrees()).filter((t) => t.id !== id);
      if (others.length) {
        await switchTree(others[0].id);
      } else {
        // Last tree: create a fresh empty one so there's always somewhere to be.
        await createTree(familyTitle(), familyName());
      }
    }
    const res = await client().from("trees").delete().eq("id", id);
    if (res.error) throw res.error;
  }

  // Set by realtime (Phase 7) to re-subscribe on tree switch. Kept as a
  // module-level hook so switchTree doesn't need to know realtime's internals.
  let onTreeSwitched = null;
  function setOnTreeSwitched(fn) { onTreeSwitched = fn; }

  global.CloudStore = {
    start,
    stop,
    flush,
    isActive: () => started,
    activeTreeId: () => treeId,
    // Multi-tree
    listTrees,
    createTree,
    switchTree,
    renameTree,
    deleteTree,
    // Role gating (Phase 6)
    getRole: () => currentRole,
    canEdit: () => currentRole === "owner" || currentRole === "editor",
    isOwner: () => currentRole === "owner",
    // Realtime hook (Phase 7)
    setOnTreeSwitched
  };
})(window);
