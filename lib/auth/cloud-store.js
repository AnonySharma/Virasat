// @ts-check
/**
 * Cloud store — the WRITE side of sync (the READ side lives in data-store's
 * hydrateFromRemote). Resolves the signed-in user's active tree, loads it into
 * FamilyStore, and pushes local edits back with a last-writer-wins optimistic
 * version guard.
 *
 * Contract (relied on by app.js boot gate):
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
 *   • Realtime: a channel on the active row delivers other devices'
 *     pushes near-live (clean → re-hydrate; dirty → leave it for the push to
 *     hit the version guard). A 60s poll is the fallback when WebSockets are
 *     blocked, and the heartbeat that replays an edit stranded by going offline.
 */
(function (global) {
  "use strict";

  const PUSH_DEBOUNCE_MS = 1500;   // coalesce a burst of edits into one push
  const POLL_MS = 60000;           // realtime fallback + offline-replay heartbeat
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
  let previewing = false;       // owner/editor self-invoked "see it as a viewer"
  let offDirty = null;          // unsubscribe from FamilyStore.onDirty
  let pushTimer = null;
  let pushing = false;          // a push is in flight
  let dirtyAgain = false;       // an edit landed while a push was in flight
  let pendingPush = false;      // an edit awaits a SUCCESSFUL push — survives an
                                // offline failure so we can replay on reconnect
  let channel = null;           // Supabase realtime channel on the active row
  let pollTimer = null;         // 60s poll: realtime fallback + offline heartbeat

  // Derived sync state for the header pip — NOT a new source of truth, just a
  // read of the existing pendingPush / pushing / navigator.onLine flags:
  //   "synced"  — every edit is confirmed on the server (nothing pending)
  //   "pending" — edits are debouncing / in flight (online)
  //   "offline" — edits are waiting but we can't reach the network
  // A change fires virasat:sync-state so the chrome can repaint without polling.
  let syncState = "synced";
  function isOnline() {
    try { return (global.navigator && "onLine" in global.navigator) ? !!global.navigator.onLine : true; }
    catch (_) { return true; }
  }
  function computeSyncState() {
    if (pendingPush || pushing) return isOnline() ? "pending" : "offline";
    return "synced";
  }
  function refreshSyncState() {
    const next = computeSyncState();
    if (next === syncState) return;
    syncState = next;
    try {
      if (typeof global.dispatchEvent === "function") {
        global.dispatchEvent(new CustomEvent("virasat:sync-state", { detail: { state: syncState } }));
      }
    } catch (_) {}
  }

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
  //
  // `previewing` lets an owner/editor deliberately drop to a viewer's read-only
  // view of their OWN tree. It folds in HERE (not as a separate app-side flag)
  // because applyRole() is the sole authority on the read-only guard + is-viewer
  // class — re-run on every start()/switchTree(). A flag kept elsewhere would be
  // silently overwritten by the next applyRole(); folding it in means a tree
  // switch cleanly re-derives edit rights (switchTree also clears the flag).
  function applyRole() {
    const canEdit = (currentRole === "owner" || currentRole === "editor") && !previewing;
    try { if (store() && store().setReadOnly) store().setReadOnly(!canEdit); } catch (_) {}
    try {
      if (global.document && global.document.body && global.document.body.classList) {
        global.document.body.classList.toggle("is-viewer", !canEdit);
      }
    } catch (_) {}
  }

  // Toggle preview-as-viewer. Only an owner/editor can enter it (a real viewer
  // is already read-only — nothing to preview). Re-applies the guard and forces
  // one repaint so the JS-gated edit branches (inspector/People/Tree) rebuild in
  // read-only form; the CSS-hidden .js-edit-only affordances vanish instantly on
  // the class toggle. notifyAll() repaints WITHOUT persisting — preview is a pure
  // view state and must never mark the tree dirty or push to the server.
  function setPreview(on) {
    const roleEditable = currentRole === "owner" || currentRole === "editor";
    const next = !!on && roleEditable;
    if (next === previewing) return;
    previewing = next;
    applyRole();
    try { if (store() && store().notifyAll) store().notifyAll(); } catch (_) {}
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

    // Brand-new account with nothing shared and nothing owned: return null.
    // start() treats a null tree as the first-run state and app.js shows the
    // "create your first tree" screen. We deliberately do NOT auto-create an
    // empty tree here — that produced an unnamed "Family family tree" the user
    // never asked for. A tree is created only when the user names one (or
    // imports / loads a sample), via CloudStore.createTree.
    return null;
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
  // persist(); we debounce, then push once. pendingPush flags "there are local
  // edits the server hasn't confirmed" — it stays true across an offline
  // failure so the poll heartbeat (and the online event) can replay the edit.
  function schedulePush() {
    pendingPush = true;
    refreshSyncState();
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
      let res;
      try {
        res = await client().from("trees")
          .update({ data: snapshot, version: base + 1 })
          .eq("id", treeId)
          .eq("version", base)
          .select("version")
          .single();
      } catch (netErr) {
        // A rejected promise here means a transport failure (offline / CORS /
        // dropped connection) — PostgREST signals row-level outcomes in-band via
        // res.error, it doesn't throw. The edit stays pending; the poll
        // heartbeat and the "online" event replay it. Expected, so no console
        // noise — just reflect that we couldn't reach the cloud and stop.
        refreshSyncState();   // pendingPush is still true → "offline" if offline
        return;
      }

      // PostgREST returns an error with code PGRST116 when .single() matches
      // zero rows — that's our optimistic-lock conflict, not a hard failure.
      if (res.error && res.error.code !== "PGRST116") throw res.error;

      if (res.data && res.data.version != null) {
        // Clean win — advance our base version to match the server. The edit
        // is confirmed; a follow-up edit (dirtyAgain) re-arms pendingPush below.
        store().setVersion(res.data.version);
        pendingPush = false;
      } else {
        // 0 rows updated → someone else advanced the row. Reconcile (hydrate
        // clears pendingPush — our local edits lose the last-writer race).
        await onConflict();
      }
    } finally {
      pushing = false;
      refreshSyncState();
      // Edits that landed mid-flight (or a conflict-hydrate we may want to
      // re-push over) get one more debounced pass. A network failure leaves
      // pendingPush true but does NOT busy-retry here — the 60s poll owns the
      // offline-retry cadence so a long outage doesn't spin every 1.5s.
      if (dirtyAgain) { dirtyAgain = false; schedulePush(); }
    }
  }

  // Last-writer-wins conflict: our version-guarded UPDATE hit 0 rows because a
  // newer version exists server-side. Before overwriting our copy, snapshot the
  // LOSING local state and hand it to the banner (app.js) on the event detail,
  // so the user can save the edit that's about to be discarded. Then hydrate
  // the server's copy so both sides converge — nothing is lost silently.
  async function onConflict() {
    // Deep-clone NOW: loadInto → hydrateFromRemote replaces the live state
    // wholesale, and getState() returns the live reference, so a shallow grab
    // would mutate out from under us. Photos live in IDB (untouched by hydrate),
    // so the backup builder can still inline them from this snapshot's photoIds.
    let losing = null;
    try { losing = JSON.parse(JSON.stringify(store().getState())); } catch (_) {}
    try {
      if (typeof global.dispatchEvent === "function") {
        global.dispatchEvent(new CustomEvent("virasat:cross-tab-conflict", { detail: { losing: losing } }));
      }
    } catch (_) {}
    // Fetch + install the winning server copy. dirtyAgain and pendingPush are
    // both cleared: hydrateFromRemote replaces our state wholesale, so there's
    // nothing local left to re-push.
    try { await loadInto(treeId); pendingPush = false; }
    catch (e) { console.error("conflict reload failed:", e); }
  }

  // — Realtime + offline replay —————————————————————————————————————————————
  // A Supabase channel on the active tree's row delivers other devices' pushes
  // near-live; a 60s poll is both the fallback (when the WebSocket is blocked)
  // and the heartbeat that replays an edit stranded by going offline. Together
  // they mean: edit here → visible there in seconds, and an edit made offline
  // lands as soon as the network returns.

  let polling = false;          // guards against overlapping poll ticks

  // A remote UPDATE arrived. If its version is newer than ours AND we have no
  // unpushed local edits, adopt it (a clean cross-device sync). If we DO have
  // local edits, do nothing here: our own scheduled push will hit the version
  // guard, land in onConflict, and reconcile with the last-writer-wins banner.
  function onRemoteChange(payload) {
    try {
      const remoteVer = payload && payload.new && payload.new.version;
      if (remoteVer == null) return;
      if (remoteVer <= store().getVersion()) return;   // our own echo, or stale
      if (pendingPush || pushing) return;               // local edits will race the guard
      loadInto(treeId).catch((e) => console.error("realtime reload failed:", e));
    } catch (_) {}
  }

  // Subscribe the channel to the active row. Degrades silently to poll-only if
  // the client has no realtime (older SDK, or a stubbed client in tests).
  function subscribe(id) {
    unsubscribe();
    const c = client();
    if (!c || typeof c.channel !== "function") return;
    try {
      channel = c.channel("virasat:tree:" + id)
        .on("postgres_changes",
            { event: "UPDATE", schema: "public", table: "trees", filter: "id=eq." + id },
            onRemoteChange)
        .subscribe();
    } catch (e) { channel = null; console.warn("realtime subscribe failed:", e); }
  }

  function unsubscribe() {
    if (!channel) return;
    try {
      const c = client();
      if (c && typeof c.removeChannel === "function") c.removeChannel(channel);
      else if (typeof channel.unsubscribe === "function") channel.unsubscribe();
    } catch (_) {}
    channel = null;
  }

  // One poll tick: replay a stranded edit first (the offline→online case), else
  // check whether the server moved ahead of us (the realtime-blocked case).
  async function pollOnce() {
    if (!treeId || !client()) return;
    if (pendingPush && !pushing) { await push().catch((e) => console.error("poll replay failed:", e)); return; }
    try {
      const res = await client().from("trees").select("version").eq("id", treeId).single();
      if (res.error) return;
      const remote = res.data && res.data.version;
      if (remote != null && remote > store().getVersion() && !pendingPush && !pushing) {
        await loadInto(treeId);
      }
    } catch (_) {}   // offline / transient — the next tick retries
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      if (polling) return;
      polling = true;
      pollOnce().catch(() => {}).then(() => { polling = false; });
    }, POLL_MS);
    // Don't let the heartbeat keep a Node test process alive (browser: no-op).
    if (pollTimer && typeof /** @type {any} */ (pollTimer).unref === "function") /** @type {any} */ (pollTimer).unref();
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    polling = false;
  }

  // Reconnect: replay immediately instead of waiting up to 60s for the poll.
  function onOnline() {
    if (!started) return;
    refreshSyncState();   // offline → pending (or synced if nothing waiting)
    if (pendingPush && !pushing) { push().catch((e) => console.error("reconnect replay failed:", e)); }
  }
  // Connection dropped: flip the pip to "offline" now if there's unsaved work,
  // rather than waiting for the next push attempt to fail.
  function onOffline() {
    if (!started) return;
    refreshSyncState();
  }

  async function start() {
    if (started) return;
    if (!auth() || !auth().isCloud || !auth().isCloud()) return;   // local-only: no-op
    const user = auth().getUser && auth().getUser();
    if (!user || !user.id) return;                                 // signed out: no-op
    started = true;
    userId = user.id;

    treeId = await resolveTree(userId);

    // First-run: a brand-new account with no owned or shared tree. Stay
    // "started" (so createTree works) but don't load/subscribe/arm anything —
    // there's no row yet. app.js sees activeTreeId() === null and shows the
    // "create your first tree" screen. saveActiveTree(null) clears any stale
    // pointer so the next session doesn't try to reopen a tree that never was.
    if (!treeId) {
      saveActiveTree(null);
      currentRole = null;
      return;
    }

    saveActiveTree(treeId);          // remember it for the next session
    await loadRole(treeId);          // owner / editor / viewer for UI gating
    applyRole();                     // read-only guard + body.is-viewer class
    resetPhotoCache();               // drop any local-only tree's cached photo URLs
    store().setActiveTree(treeId);   // repoint the local cache to this tree
    await loadInto(treeId);          // fetch + hydrate (sets base version)

    // Arm the pusher AFTER the initial hydrate (hydrate doesn't markDirty, so
    // no spurious first push). Every later mutation debounces into one push.
    offDirty = store().onDirty(schedulePush);

    // Near-live updates + offline replay: subscribe the active row, run the
    // 60s heartbeat, and replay immediately on reconnect.
    subscribe(treeId);
    startPolling();
    try {
      if (global.addEventListener) {
        global.addEventListener("online", onOnline);
        global.addEventListener("offline", onOffline);
      }
    } catch (_) {}
    // Freshly loaded + hydrated: nothing pending. Announce it so the pip paints.
    syncState = "synced";
    refreshSyncState();
  }

  function stop() {
    if (offDirty) { offDirty(); offDirty = null; }
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    unsubscribe();
    stopPolling();
    try {
      if (global.removeEventListener) {
        global.removeEventListener("online", onOnline);
        global.removeEventListener("offline", onOffline);
      }
    } catch (_) {}
    started = false;
    treeId = null;
    userId = null;
    currentRole = null;
    previewing = false;
    pendingPush = false;
    refreshSyncState();   // back to "synced" (nothing pending) for the pip
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

  // — Multi-tree API —————————————————————————————————————————————
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

  // Count members of the ACTIVE tree (read-only). members_select RLS lets any
  // member read the member rows of trees they belong to, so a HEAD count works
  // for owner and non-owner alike. Returns null on any error so callers can
  // fall back gracefully. Used to warn before a destructive import that the
  // tree is shared with other people.
  async function activeMemberCount() {
    if (!started || !client() || !treeId) return null;
    try {
      const res = await client().from("tree_members")
        .select("user_id", { count: "exact", head: true })
        .eq("tree_id", treeId);
      if (res.error) return null;
      return typeof res.count === "number" ? res.count : null;
    } catch (_) { return null; }
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

    // 1. Detach the pusher + realtime, and flush any pending edit to the
    //    CURRENT tree. unsubscribe first so a late remote event for the old row
    //    can't hydrate over the incoming tree mid-switch.
    if (offDirty) { offDirty(); offDirty = null; }
    unsubscribe();
    await flush();                   // guarded UPDATE still targets the old treeId

    // 2. Repoint. setActiveTree flushes the outgoing cache under its old key,
    //    then loads the incoming tree's cached snapshot for an instant paint.
    //    Clear pendingPush: a stranded edit to the OLD tree must never replay
    //    against the NEW row (the poll heartbeat would otherwise do exactly that).
    treeId = nextId;
    dirtyAgain = false;
    pendingPush = false;
    refreshSyncState();              // incoming tree starts with nothing pending
    saveActiveTree(treeId);
    previewing = false;              // a fresh tree starts in its real role, not preview
    await loadRole(treeId);
    applyRole();
    resetPhotoCache();
    store().setActiveTree(treeId);

    // 3. Fresh remote load, then re-arm the pusher (post-hydrate, so the
    //    hydrate itself doesn't bounce back as a push).
    await loadInto(treeId);
    offDirty = store().onDirty(schedulePush);

    // 4. Realtime re-subscribes to the new row.
    subscribe(treeId);
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
  // Deleting the LAST tree drops back to the first-run state (no active tree)
  // rather than auto-creating an unnamed replacement — the caller then re-shows
  // the "create your first tree" screen. Returns { emptied } so it can.
  async function deleteTree(id) {
    if (!started || !client()) throw new Error("Cloud is not active");
    let emptied = false;
    if (id === treeId) {
      const others = (await listTrees()).filter((t) => t.id !== id);
      if (others.length) {
        await switchTree(others[0].id);
      } else {
        // Last tree: detach the pusher + realtime BEFORE the delete so a
        // racing debounced push can't target the row we're removing, then
        // null out to the first-run state.
        if (offDirty) { offDirty(); offDirty = null; }
        if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
        unsubscribe();
        pendingPush = false;
        dirtyAgain = false;
        treeId = null;
        currentRole = null;
        saveActiveTree(null);
        resetPhotoCache();
        emptied = true;
      }
    }
    const res = await client().from("trees").delete().eq("id", id);
    if (res.error) throw res.error;
    // Reclaim the tree's LOCAL footprint (its offline cache blob + any photo
    // blobs no surviving tree still references). After the network delete
    // succeeded so a failed delete leaves local state intact — the bucket is
    // the durable copy either way. Best-effort: a purge hiccup must not fail
    // the delete the server already accepted.
    try { if (store().purgeLocalTree) store().purgeLocalTree(id); } catch (_) {}
    return { emptied };
  }

  // Leave a tree you were shared into (viewer/editor — NOT the owner; the
  // leave_tree RPC rejects owners server-side). Mirrors deleteTree's repointing
  // so the app is never left pointing at a row you can no longer read, but the
  // row itself is untouched — only your membership (+ any lingering invite) is
  // removed via the owner-independent RPC. Returns { emptied } like deleteTree.
  async function leaveTree(id) {
    if (!started || !client()) throw new Error("Cloud is not active");
    let emptied = false;
    if (id === treeId) {
      const others = (await listTrees()).filter((t) => t.id !== id);
      if (others.length) {
        await switchTree(others[0].id);
      } else {
        if (offDirty) { offDirty(); offDirty = null; }
        if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
        unsubscribe();
        pendingPush = false;
        dirtyAgain = false;
        treeId = null;
        currentRole = null;
        saveActiveTree(null);
        resetPhotoCache();
        emptied = true;
      }
    }
    const res = await client().rpc("leave_tree", { p_tree: id });
    if (res.error) throw res.error;
    // Reclaim the left tree's LOCAL footprint — you can no longer read the row,
    // so its cached blob + exclusively-owned photo blobs are dead weight in
    // this browser. Reference-counted against surviving trees (see
    // purgeLocalTree); best-effort so it never fails a completed leave.
    try { if (store().purgeLocalTree) store().purgeLocalTree(id); } catch (_) {}
    return { emptied };
  }

  global.CloudStore = {
    start,
    stop,
    flush,
    isActive: () => started,
    activeTreeId: () => treeId,
    // Derived sync state for the header pip ("synced" | "pending" | "offline").
    // Fires virasat:sync-state on every transition. Reads existing flags only —
    // no new network or backend.
    syncState: () => syncState,
    // Multi-tree
    listTrees,
    activeMemberCount,
    createTree,
    switchTree,
    renameTree,
    deleteTree,
    leaveTree,
    // Role gating
    getRole: () => currentRole,
    canEdit: () => currentRole === "owner" || currentRole === "editor",
    isOwner: () => currentRole === "owner",
    // Preview-as-viewer (owner/editor only). isPreviewing reflects the live flag;
    // setPreview(true/false) enters/leaves and repaints. canEdit() reports the
    // underlying role and is unaffected by preview — the read-only *guard* is what
    // preview flips, so gate an "exit preview" affordance on canEdit(), not on
    // FamilyStore.isReadOnly() (which is true during preview).
    isPreviewing: () => previewing,
    setPreview
  };
})(window);
