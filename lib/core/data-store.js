// @ts-check
/**
 * Data store — single source of truth, persisted in localStorage.
 *
 * A Person record has ~30 fields — id/name, a `_hi` Hindi variant for every
 * free-text field, photo + crop frames, dates with precision, places,
 * occupation, achievements/education arrays, stories, contact, and the pet
 * flag. `normalizePerson` (below) is the authoritative shape: it defaults
 * every field, so read it rather than trusting this header.
 *
 * Relationships are stored on each person; helpers below derive children/siblings.
 * Spouses are bidirectional; parents are stored on the child.
 */
(function (global) {
  "use strict";

  const STORAGE_KEY = "familyTree.v1";
  // SCHEMA_VERSION 2 marks the addition of state.marriages, person.stories,
  // person.photoCropAvatar/Hero, and birth/deathDatePrecision flags. v1
  // imports are still accepted: missing fields default via `||` in
  // normalizePerson, and missing marriages defaults to `{}` in load().
  const SCHEMA_VERSION = 2;

  const listeners = new Set();

  // — Cloud-sync seam (all inert until cloud-store.js wires them) —————————
  // The active cloud tree's id, or null in local-only mode. When null the
  // local cache key stays "familyTree.v1" and every path below behaves
  // exactly as the single-device app always has.
  let activeTreeId = null;
  // The cloud row's optimistic-lock counter for the active tree (the `version`
  // column in the `trees` table — NOT SCHEMA_VERSION). 0 = unknown / not yet
  // loaded from the server. cloud-store reads getVersion() before a push and
  // guards the UPDATE on it; hydrateFromRemote sets it from the server.
  let cloudVersion = 0;
  // Called (if set) on every mutating persist() so cloud-store can schedule a
  // debounced push. data-store never imports the SDK — this hook is the only
  // coupling, and it stays null in local-only mode.
  let dirtyHook = null;
  // Read-only guard for viewer-role shared trees. When true, every
  // mutator early-returns so a viewer's stray click can't create a local edit
  // that RLS would then reject on push (which would flicker in, then revert on
  // the next hydrate). RLS is the real server-side boundary; this is the
  // client-side backstop that keeps the UI honest. Always false in local-only
  // mode and for owner/editor roles. hydrateFromRemote/setActiveTree bypass it
  // (they're not user edits).
  let readOnly = false;
  function setReadOnly(v) { readOnly = !!v; }
  function isReadOnly() { return readOnly; }
  // Per-tree cache key so each cloud tree's offline snapshot is isolated;
  // falls back to the legacy single-tree key when no tree is active.
  function storageKeyFor(treeId) {
    return treeId ? "familyTree." + treeId + ".v1" : STORAGE_KEY;
  }
  function activeStorageKey() { return storageKeyFor(activeTreeId); }

  // MUST stay above the `load()` call below. load() → normalizePerson →
  // normalisePrecision reads DATE_PRECISIONS, and a `const` throws
  // ReferenceError if touched in its temporal dead zone. If this sat lower in
  // the file (next to normalisePrecision, where it reads more naturally), a
  // returning user with ANY dated person would throw inside load()'s own
  // try/catch → silent reset to empty state → the first save then overwrites
  // their localStorage backup for good. Do not move it back down.
  const DATE_PRECISIONS = ["exact", "about", "before", "after"];

  let state = load();

  // — Undo / redo — a ring of whole-tree JSON snapshots. persist() records the
  // post-edit state as the new "present" (baselineStr) and pushes the prior one
  // onto undoStack; undo()/redo() swap `state` to an adjacent snapshot. The
  // timeline RESETS (resetHistory) whenever it restarts: boot, tree switch, and
  // any remote hydrate / cross-tab reload — a change from elsewhere ends this
  // device's local undo line, so undo never fights sync. Declared up here (above
  // the boot trace) so the resetHistory() call below isn't in these vars' TDZ.
  // Caveat: a person-delete / reset frees photo blobs asynchronously, so undoing
  // one restores the record's JSON but its photo may degrade to initials — the
  // same limitation the existing single-delete path already has.
  const HISTORY_LIMIT = 30;
  let undoStack = [];   // prior serialized states, oldest → newest
  let redoStack = [];   // undone states, available to redo() until a new edit
  let baselineStr = null;   // the present state, serialized (JSON.stringify)

  // Boot trace — visible in DevTools console. Helps the user/diag distinguish
  // "data was wiped" from "data is there but didn't render". Cheap one-liner.
  if (typeof console !== "undefined") {
    try {
      const raw = localStorage.getItem(activeStorageKey());
      console.info("[Virasat] loaded —",
        (state.people || []).length, "people,",
        Object.keys(state.marriages || {}).length, "marriages,",
        "localStorage size", raw ? raw.length : 0, "chars");
    } catch (_) {}
  }
  resetHistory();   // seed the "present" from the just-loaded state

  function load() {
    try {
      // activeStorageKey() === STORAGE_KEY at boot (activeTreeId null) and in
      // local-only mode; it becomes "familyTree.<treeId>.v1" only after
      // cloud-store calls setActiveTree(). So a returning offline user reads
      // exactly the same key they always have.
      const raw = localStorage.getItem(activeStorageKey());
      if (!raw) return emptyState();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return emptyState();
      // Normalize every person
      const people = Array.isArray(parsed.people) ? parsed.people.map(normalizePerson) : [];
      const marriages = (parsed.marriages && typeof parsed.marriages === "object") ? parsed.marriages : {};
      return {
        version: SCHEMA_VERSION,
        people,
        marriages,
        meta: parsed.meta || { familyName: "Sharma Family", createdAt: new Date().toISOString() }
      };
    } catch (e) {
      console.warn("Failed to load store, resetting", e);
      // The localStorage payload is corrupt and we're about to discard every
      // photoId reference. The IDB blobs they pointed at would otherwise be
      // unreachable forever, eating storage. Wipe them too.
      if (typeof window !== "undefined" && window.PhotoStore && PhotoStore.clearAll) {
        PhotoStore.clearAll().catch(() => {});
      }
      return emptyState();
    }
  }

  function emptyState() {
    return {
      version: SCHEMA_VERSION,
      people: [],
      marriages: {},
      meta: { familyName: "Sharma Family", createdAt: new Date().toISOString() }
    };
  }

  // Marriages are keyed by the sorted pair "aId|bId" (lexicographically),
  // so getMarriage(a, b) === getMarriage(b, a). The value carries the
  // optional fields a marriage might have: date, place, story, photoId.
  function marriageKey(aId, bId) {
    if (!aId || !bId) return null;
    return aId < bId ? aId + "|" + bId : bId + "|" + aId;
  }
  function getMarriage(aId, bId) {
    const k = marriageKey(aId, bId);
    return k ? (state.marriages && state.marriages[k]) || null : null;
  }
  function setMarriage(aId, bId, data) {
    if (readOnly) return;
    const k = marriageKey(aId, bId);
    if (!k) return;
    if (!state.marriages) state.marriages = {};
    const prev = state.marriages[k] || {};
    const next = Object.assign({}, prev, data, { updatedAt: new Date().toISOString() });
    if (!next.createdAt) next.createdAt = prev.createdAt || new Date().toISOString();
    state.marriages[k] = next;
    persist();
    return next;
  }
  function deleteMarriage(aId, bId) {
    if (readOnly) return;
    const k = marriageKey(aId, bId);
    if (!k || !state.marriages) return;
    delete state.marriages[k];
    persist();
  }

  // Date precision modifier — kept tiny and validated everywhere it's read.
  // DATE_PRECISIONS itself is declared up top (above the load() call) because
  // this function runs inside load() during module init — see the note there.
  function normalisePrecision(v, date) {
    if (!date) return null;                       // no date → no precision
    if (DATE_PRECISIONS.indexOf(v) >= 0) return v;
    return "exact";
  }

  // Gender is stored canonically as "m" | "f" | "o" | null. The whole app
  // (relationLabel, the form picker, the gender facet) compares against those
  // codes — but older exports and the sample data used the full words
  // "male"/"female"/"other". Fold every spelling to a code here so a legacy
  // import or the sample tree doesn't read as "no gender recorded" and doesn't
  // fragment the gender facet into parallel word/code buckets.
  function normaliseGender(v) {
    if (!v) return null;
    const s = String(v).trim().toLowerCase();
    if (s === "m" || s === "male" || s === "man" || s === "boy") return "m";
    if (s === "f" || s === "female" || s === "woman" || s === "girl") return "f";
    if (s === "o" || s === "other" || s === "nonbinary" || s === "non-binary") return "o";
    return null;
  }

  // Stories — long-form memories tied to a person.
  function normaliseStory(s) {
    if (!s) return null;
    if (typeof s === "string") {
      // Treat a bare string as a body-only story
      return { id: genId("s_"), title: "", body: s, tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    }
    if (typeof s !== "object") return null;
    return {
      id: s.id || genId("s_"),
      title: (s.title || "").trim(),
      body: s.body || "",
      tags: Array.isArray(s.tags) ? s.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean) : [],
      createdAt: s.createdAt || new Date().toISOString(),
      updatedAt: s.updatedAt || s.createdAt || new Date().toISOString()
    };
  }

  // A gallery item is an ADDITIONAL photo beyond the primary avatar
  // (person.photoId). Shape: { id, photoId, photo?, caption }.
  //   photoId  — IDB blob key (the normal case; minted by PhotoStore).
  //   photo    — base64 data URL, present only transiently on a freshly
  //              imported backup; migrateLegacy converts it to a photoId,
  //              exactly like the primary `photo` field.
  //   caption  — a short single-language label ("Wedding, 1962"). Single
  //              language on purpose, matching the marriage-record `story`
  //              precedent; kept deliberately light so a photo grid isn't a
  //              wall of paired inputs. A _hi variant can be added later.
  // Anything without a usable photo ref is dropped — a caption with no image
  // isn't a gallery entry.
  function normaliseGalleryItem(g) {
    if (!g || typeof g !== "object") return null;
    if (!g.photoId && !g.photo) return null;
    return {
      id: g.id || genId("g_"),
      photoId: g.photoId || null,
      photo: g.photo || null,
      caption: (g.caption || "").trim()
    };
  }

  // A document is a scanned SOURCE — a birth certificate, a letter, a
  // newspaper article — the family attaches so a fact can be verified by a
  // later generation. Shape: { id, photoId, photo?, title, kind, date, note }.
  //   photoId / photo — the scan's image, stored on the SAME substrate as
  //              photos (an IDB blob, JPEG, EXIF-stripped, cloud-synced),
  //              just captured at a larger maxDim so the text stays legible.
  //   title    — what the document is ("Birth certificate", "Letter, 1947").
  //   kind     — a coarse type for the icon: "certificate" | "letter" |
  //              "article" | "photo" | "other". Free-typed values are kept.
  //   date     — optional YYYY[-MM[-DD]] the document is dated/from.
  //   note     — the citation: WHAT this source records or verifies, in the
  //              family's own words. Single-language, matching the story/
  //              gallery precedent.
  // Anything without a usable image ref is dropped — a citation with no scan
  // isn't a document (record it as a story or note instead).
  const DOC_KINDS = ["certificate", "letter", "article", "photo", "other"];
  function normaliseDocument(d) {
    if (!d || typeof d !== "object") return null;
    if (!d.photoId && !d.photo) return null;
    const kind = DOC_KINDS.indexOf(d.kind) !== -1 ? d.kind : (String(d.kind || "").trim() || "other");
    return {
      id: d.id || genId("doc_"),
      photoId: d.photoId || null,
      photo: d.photo || null,
      title: (d.title || "").trim(),
      kind: kind,
      date: d.date || null,
      note: (d.note || "").trim()
    };
  }

  function normalizePerson(p) {
    return {
      id: p.id || genId(),
      name: String(p.name || "").trim() || "Unknown",
      name_hi: p.name_hi || "",
      photo: p.photo || null,           // base64 data URL (auto-migrated to IDB)
      photoId: p.photoId || null,       // IndexedDB blob id
      // photoUrl (committed-asset path) was removed 2026-06-19. The sample
      // data is now inlined as base64 — see tests/inline-sample-photos.mjs.
      // Old user data with `photoUrl: "..."` will round-trip cleanly:
      // normalizePerson silently drops the field, the photo just won't
      // render. If you import an ancient backup that relied on photoUrl,
      // re-upload the affected photos.
      // Crop frames let the same source photo render differently in the
      // round node/avatar slot vs. the wide hero band on the profile.
      // Each is { x, y, scale } in CSS object-position semantics:
      //   x, y     ∈ [0, 100]   — focal point inside the photo (%).
      //   scale    ≥ 1          — zoom factor (1 = fit).
      // Null means "no custom crop, use sensible defaults" (cover-center).
      photoCropAvatar: p.photoCropAvatar || null,
      photoCropHero: p.photoCropHero || null,
      // Additional photos beyond the primary avatar — a small gallery
      // (childhood, wedding, late portrait). The primary stays `photoId` so
      // every existing reader (tree node, avatar, hero, exports) is untouched;
      // this is purely additive. Each entry: { id, photoId, photo?, caption }.
      gallery: Array.isArray(p.gallery) ? p.gallery.map(normaliseGalleryItem).filter(Boolean) : [],
      // Scanned source documents (certificates, letters, articles) that back up
      // the facts on this record. Stored on the same blob substrate as photos;
      // see normaliseDocument. Purely additive — no existing reader depends on it.
      documents: Array.isArray(p.documents) ? p.documents.map(normaliseDocument).filter(Boolean) : [],
      birthDate: p.birthDate || null,
      // Optional precision flag for the dates: "exact" | "about" | "before" | "after".
      // Defaults to "exact" when a date is set; null when no date.
      birthDatePrecision: normalisePrecision(p.birthDatePrecision, p.birthDate),
      deathDate: p.deathDate || null,
      deathDatePrecision: normalisePrecision(p.deathDatePrecision, p.deathDate),
      birthPlace: p.birthPlace || "",
      birthPlace_hi: p.birthPlace_hi || "",
      deathPlace: p.deathPlace || "",
      deathPlace_hi: p.deathPlace_hi || "",
      gender: normaliseGender(p.gender),
      notes: p.notes || "",
      notes_hi: p.notes_hi || "",
      description: p.description || "",
      description_hi: p.description_hi || "",
      achievements: Array.isArray(p.achievements) ? p.achievements.filter(Boolean) : [],
      achievements_hi: Array.isArray(p.achievements_hi) ? p.achievements_hi.filter(Boolean) : [],
      education: Array.isArray(p.education) ? p.education.filter(Boolean) : [],
      education_hi: Array.isArray(p.education_hi) ? p.education_hi.filter(Boolean) : [],
      occupation: p.occupation || "",
      occupation_hi: p.occupation_hi || "",
      // Long-form memories. Each entry: { id, title, body, tags: [], createdAt, updatedAt }
      stories: Array.isArray(p.stories) ? p.stories.map(normaliseStory).filter(Boolean) : [],
      // Contact info — useful for the part of the tree that's still alive.
      // Each field carries an optional `private: true` flag; when set, the
      // export pipeline strips it from JSON / PNG / poster outputs but it
      // stays in the local store. The UI shows a "private" badge.
      contact: normaliseContact(p.contact),
      // Pet flag — when true, render with a paw badge in the tree and
      // optionally in lists. Pets are real members of many families and
      // deserve a place; everything else (dates, stories) still applies.
      isPet: !!p.isPet,
      // For pets: their human owner(s). Stored separately from `parents`
      // because a beagle isn't a child of its humans, just bonded. The tree
      // draws a dashed gold tether from a pet to its first owner.
      petOwners: Array.isArray(p.petOwners) ? p.petOwners.filter(Boolean) : [],
      parents: Array.isArray(p.parents) ? p.parents.filter(Boolean) : [],
      // Explicitly-unknown parents — a sparse list of the roles ("father" /
      // "mother") the family has recorded as *actively unknown* (an adoption,
      // a lost paternal line), distinct from simply not-yet-filled-in. Kept
      // OUT of `parents` on purpose: that array is a list of real person ids
      // that drives generations, ancestor walks, edges, and the export
      // allowlist — a sentinel there would corrupt all of them. This is a
      // pure annotation the tree renders as a dashed placeholder node.
      unknownParents: Array.isArray(p.unknownParents)
        ? p.unknownParents.filter((r) => r === "father" || r === "mother")
        : [],
      spouses: Array.isArray(p.spouses) ? p.spouses.filter(Boolean) : [],
      createdAt: p.createdAt || new Date().toISOString(),
      updatedAt: p.updatedAt || new Date().toISOString()
    };
  }

  function normaliseContact(c) {
    if (!c || typeof c !== "object") return { phone: "", email: "", address: "", privatePhone: false, privateEmail: false, privateAddress: false };
    return {
      phone: String(c.phone || "").trim(),
      email: String(c.email || "").trim(),
      address: String(c.address || "").trim(),
      privatePhone: !!c.privatePhone,
      privateEmail: !!c.privateEmail,
      privateAddress: !!c.privateAddress
    };
  }

  /**
   * Localized field reader: returns the _hi variant if UI lang is "hi"
   * AND the variant is non-empty; otherwise the original.
   * For arrays, falls through item-by-item: if a Hindi item exists at the same
   * index, use it; else use the original.
   */
  function getField(person, key) {
    if (!person) return "";
    const lang = (window.I18n && I18n.getLang && I18n.getLang()) || "en";
    if (lang !== "hi") return person[key];
    const hiKey = key + "_hi";
    const hi = person[hiKey];
    if (Array.isArray(person[key])) {
      const en = person[key];
      const hiArr = Array.isArray(hi) ? hi : [];
      return en.map((v, i) => (hiArr[i] && String(hiArr[i]).trim()) ? hiArr[i] : v);
    }
    return (hi && String(hi).trim()) ? hi : person[key];
  }

  // The localStorage write is the expensive part — JSON.stringify of a 500 KB
  // tree can block the main thread ~30 ms on mobile. Debounce it so a burst
  // of edits (typing in a field, dragging a photo crop) coalesces into one
  // write. Listeners still fire synchronously so the UI stays in sync;
  // the cost being deferred is just the on-disk save.
  let persistTimer = null;
  const PERSIST_DEBOUNCE_MS = 250;
  function flushPersist() {
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    try {
      // Writes the active tree's cache key. In local-only mode that IS
      // STORAGE_KEY, so the on-disk layout is unchanged. In cloud mode each
      // tree gets its own "familyTree.<treeId>.v1" offline snapshot.
      localStorage.setItem(activeStorageKey(), JSON.stringify(state));
    } catch (e) {
      console.error("Persist failed (storage full?)", e);
      throw new Error("Storage full — try removing photos or exporting your data.");
    }
  }
  // When `mute` is set, persist() schedules the write but skips notifying
  // subscribers. Used by bulk operations (photo migration on first load)
  // to avoid N tree re-renders for N photos. Pair with `notifyAll()` after
  // the bulk work to force one final repaint.
  let mute = false;
  function persist(opts) {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(flushPersist, PERSIST_DEBOUNCE_MS);
    // Signal the cloud pusher (if wired) BEFORE the mute/silent gate: those
    // flags suppress UI re-renders during bulk work, but the data still
    // changed and must reach the server. cloud-store's own ~1.5s debounce
    // coalesces the burst, so one markDirty per mutation is cheap.
    // hydrateFromRemote deliberately does NOT call persist(), so applying
    // server data never re-flags dirty → no push→echo→push loop.
    markDirty();
    if (mute || (opts && opts.silent)) return;
    // Record this edit on the undo timeline (after the mute/silent gate, so
    // bulk photo migration doesn't fragment history — it re-baselines on
    // unmute instead). A no-op save (Save with nothing changed) leaves the
    // serialized state identical, so captureHistory adds no dead step.
    captureHistory();
    listeners.forEach((fn) => {
      try { fn(state); } catch (err) { console.error(err); }
    });
  }
  // Cloud-sync dirty signal. dirtyHook stays null in local-only mode, so this
  // is a single truthy check per mutation — no measurable cost. cloud-store
  // installs the hook via onDirty(); it fires after every mutating persist().
  function markDirty() {
    if (!dirtyHook) return;
    try { dirtyHook(); } catch (err) { console.error("dirtyHook failed:", err); }
  }
  function onDirty(fn) {
    dirtyHook = (typeof fn === "function") ? fn : null;
    return function () { if (dirtyHook === fn) dirtyHook = null; };
  }
  function setMute(v) {
    const was = mute;
    mute = !!v;
    // Leaving a muted bulk section (photo migration): the state changed under
    // the mute, but we deliberately skipped capturing each step. Fold the whole
    // batch into the present by re-baselining, so the first post-migration undo
    // targets the user's next real edit — not a half-migrated intermediate.
    if (was && !mute) baselineStr = serializeState();
  }
  function notifyAll() {
    listeners.forEach((fn) => {
      try { fn(state); } catch (err) { console.error(err); }
    });
  }

  // — Undo / redo engine ————————————————————————————————————————————————
  // Snapshots are whole-tree JSON strings — the same payload flushPersist()
  // writes, so serializing is work the store already does. A ring capped at
  // HISTORY_LIMIT keeps memory bounded (~a few hundred KB even for a large
  // tree × 30 steps); the oldest undo step is dropped when full.
  function serializeState() {
    try { return JSON.stringify(state); } catch (_) { return null; }
  }
  // Start (or restart) the timeline from the current state. Clears both stacks
  // so no undo can cross a boot / tree-switch / remote-hydrate boundary.
  function resetHistory() {
    undoStack = [];
    redoStack = [];
    baselineStr = serializeState();
  }
  // Called by persist() after a real (unmuted) edit. Pushes the PREVIOUS present
  // onto the undo stack and adopts the new state as the present. A serialized
  // no-op (Save with nothing changed) is ignored so it can't add a dead step or
  // wrongly clear the redo stack. Any genuine edit invalidates redo (you can't
  // redo past a fork), matching every editor's undo model.
  function captureHistory() {
    const nextStr = serializeState();
    if (nextStr === null) return;               // serialization failed — skip
    if (nextStr === baselineStr) return;        // no real change
    if (baselineStr !== null) {
      undoStack.push(baselineStr);
      if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    }
    redoStack = [];
    baselineStr = nextStr;
  }
  // Install a serialized snapshot as the live state WITHOUT going through
  // normalizeIncomingState: these strings were produced by our own
  // serializeState() from already-normalized state, so they're trusted and
  // re-normalizing would be wasted work. Writes the cache + notifies like a
  // hydrate, and markDirty()s so an undo in cloud mode pushes as a new version
  // (LWW) rather than silently diverging from the server.
  function applySnapshot(str) {
    let parsed;
    try { parsed = JSON.parse(str); } catch (_) { return false; }
    if (!parsed || !Array.isArray(parsed.people)) return false;
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    state = parsed;
    try { localStorage.setItem(activeStorageKey(), str); }
    catch (e) { console.error("Cache write failed after undo/redo", e); }
    markDirty();
    notifyAll();
    return true;
  }
  function canUndo() { return undoStack.length > 0; }
  function canRedo() { return redoStack.length > 0; }
  // Step back: the present moves onto the redo stack, the top undo snapshot
  // becomes the present. Read-only trees can't mutate, so undo is a no-op there.
  // The stacks + baseline are updated BEFORE applySnapshot()'s notifyAll() so a
  // subscribe listener (e.g. the header's refreshUndoRedo) reads the final
  // canUndo()/canRedo(), not a half-stepped state. On the (practically
  // unreachable — the string is our own serializeState output) parse failure,
  // the timeline is restored so a bad apply can't strand a snapshot.
  function undo() {
    if (readOnly || !undoStack.length) return false;
    const cur = baselineStr !== null ? baselineStr : serializeState();
    const prev = undoStack.pop();
    if (cur !== null) redoStack.push(cur);
    const prevBaseline = baselineStr;
    baselineStr = prev;
    if (applySnapshot(prev)) return true;
    undoStack.push(prev);
    if (cur !== null) redoStack.pop();
    baselineStr = prevBaseline;
    return false;
  }
  function redo() {
    if (readOnly || !redoStack.length) return false;
    const cur = baselineStr !== null ? baselineStr : serializeState();
    const next = redoStack.pop();
    if (cur !== null) undoStack.push(cur);
    const prevBaseline = baselineStr;
    baselineStr = next;
    if (applySnapshot(next)) return true;
    redoStack.push(next);
    if (cur !== null) undoStack.pop();
    baselineStr = prevBaseline;
    return false;
  }
  // Belt-and-braces: flush on tab close so we never lose a pending write.
  // beforeunload is unreliable on mobile Safari (often skipped); pagehide is
  // the canonical signal there. visibilitychange covers app-switching.
  if (typeof window !== "undefined") {
    // Silent catches were masking quota / write failures during unload —
    // the user would reload and see an empty tree without any clue why.
    // Log any unload-time failure so DevTools shows it on next session.
    function flushOnUnload(reason) {
      return () => {
        try { flushPersist(); }
        catch (e) { console.error("[Virasat] unload flush failed (" + reason + "):", e); }
      };
    }
    window.addEventListener("beforeunload", flushOnUnload("beforeunload"));
    window.addEventListener("pagehide", flushOnUnload("pagehide"));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushOnUnload("visibilitychange")();
    });
    // Cross-tab sync: when another tab persists, the `storage` event fires
    // here with the new payload. Reload state from localStorage and notify
    // listeners so this tab re-renders with the latest data. Last-write-
    // wins is fine for a single-user app; silent loss of one tab's edits
    // is not, which the no-op default would risk.
    window.addEventListener("storage", (e) => {
      // Compare against the ACTIVE key: in local-only mode that's STORAGE_KEY
      // (unchanged), and in cloud mode two same-device tabs on the same tree
      // share "familyTree.<treeId>.v1", so this still catches their writes.
      if (e.key !== activeStorageKey() || !e.newValue) return;
      // If we had a pending debounced write, that means this tab made an
      // edit that's about to be silently overwritten by the other tab's
      // write. Surface it as a banner instead of swallowing — the user
      // should know their last edit was discarded and can choose whether
      // to reload or copy their state out.
      const hadPendingEdit = !!persistTimer;
      if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
      // Snapshot the about-to-be-overwritten state BEFORE reloading, so the
      // conflict banner can offer to save the losing edit (matches the cloud
      // last-writer-wins path in cloud-store.onConflict).
      let losing = null;
      if (hadPendingEdit) { try { losing = JSON.parse(JSON.stringify(state)); } catch (_) {} }
      try {
        state = load();
        // Another tab's write is a change from outside this tab's edit line —
        // end the local undo timeline so an undo here can't resurrect state the
        // other tab has moved past.
        resetHistory();
        listeners.forEach((fn) => { try { fn(state); } catch (err) { console.error(err); } });
        if (hadPendingEdit && typeof window.dispatchEvent === "function") {
          window.dispatchEvent(new CustomEvent("virasat:cross-tab-conflict", { detail: { losing: losing } }));
        }
      } catch (err) { console.error("Cross-tab reload failed:", err); }
    });
  }

  function genId(prefix) {
    const px = prefix || "p_";
    // Prefer crypto.randomUUID — collision-free by construction. Fall back to
    // Math.random + Date.now + a per-process counter so two calls in the same
    // millisecond can't collide on environments without crypto.
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return px + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    }
    const _c = /** @type {any} */ (genId);
    _c._n = (_c._n || 0) + 1;
    return px
      + Math.random().toString(36).slice(2, 8)
      + Date.now().toString(36).slice(-4)
      + _c._n.toString(36);
  }

  // ===== Public API =====

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function getState() { return state; }
  function getPeople() { return state.people.slice(); }
  function getPerson(id) { return state.people.find((p) => p.id === id) || null; }

  function addPerson(input) {
    if (readOnly) return null;
    const person = normalizePerson({ ...input, id: input.id || genId() });
    state.people.push(person);
    syncSpouses(person.id, person.spouses, []);
    persist();
    return person;
  }

  function updatePerson(id, patch) {
    if (readOnly) return null;
    const idx = state.people.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    const prev = state.people[idx];
    const next = normalizePerson({ ...prev, ...patch, id, createdAt: prev.createdAt, updatedAt: new Date().toISOString() });
    state.people[idx] = next;
    syncSpouses(id, next.spouses, prev.spouses);
    persist();
    return next;
  }

  function deletePerson(id) {
    if (readOnly) return;
    // Collect every IndexedDB blob that becomes unreachable once this person
    // is gone, so we can free them after the state is settled. This is the
    // single owner of delete-time cleanup: every delete path (inspector,
    // tree-view, people-view) funnels through here and frees the same set, so
    // callers must not do their own partial blob cleanup.
    const orphanedBlobs = [];
    const gone = getPerson(id);
    if (gone) personPhotoIds(gone).forEach((bid) => orphanedBlobs.push(bid)); // avatar + gallery

    state.people = state.people.filter((p) => p.id !== id);
    // Strip references. petOwners is stripped alongside parents/spouses —
    // without it a pet whose only owner was just deleted keeps a dangling
    // owner id, and buildGenerations/drawEdges then strand it at the root row
    // with no edges.
    state.people.forEach((p) => {
      p.parents = p.parents.filter((pid) => pid !== id);
      p.spouses = p.spouses.filter((sid) => sid !== id);
      if (Array.isArray(p.petOwners)) p.petOwners = p.petOwners.filter((oid) => oid !== id);
    });
    // Drop any marriage records mentioning the deleted person — otherwise
    // the keys keep dangling ids forever and re-binding the same id (after
    // a re-import) would surface a stale marriage. Free each dropped
    // marriage's photo blob too (the gold-knot modal can attach one).
    if (state.marriages) {
      Object.keys(state.marriages).forEach((k) => {
        const [a, b] = k.split("|");
        if (a === id || b === id) {
          const m = state.marriages[k];
          if (m && m.photoId) orphanedBlobs.push(m.photoId);
          delete state.marriages[k];
        }
      });
    }
    persist();
    // Fire-and-forget blob deletion after state is persisted. Guarded on
    // window.PhotoStore because data-store.js loads before photo-store.js and
    // headless/test runs have no IDB.
    if (orphanedBlobs.length && typeof window !== "undefined" && window.PhotoStore) {
      orphanedBlobs.forEach((bid) => { if (bid) PhotoStore.delete(bid).catch(() => {}); });
    }
  }

  // Bidirectional spouse-link maintenance. Builds a new state.people
  // array in one pass and assigns it atomically — so a mid-sync crash
  // can't leave one partner listing the other while the other doesn't.
  // Don't revert to mutating each partner record in place: that's N
  // separate writes that could partially apply.
  function syncSpouses(personId, nextSpouseIds, prevSpouseIds) {
    const next = new Set(nextSpouseIds);
    const prev = new Set(prevSpouseIds);
    // Find the partner ids that need their `spouses` flipped.
    const toRemove = new Set();
    const toAdd = new Set();
    prev.forEach((sid) => { if (!next.has(sid)) toRemove.add(sid); });
    next.forEach((sid) => { if (!prev.has(sid)) toAdd.add(sid); });
    if (toRemove.size === 0 && toAdd.size === 0) return;
    // Build the new array in one pass — copy each person, mutate only
    // those whose spouses array changes, leave the rest untouched.
    state.people = state.people.map((p) => {
      if (toRemove.has(p.id)) {
        const filtered = p.spouses.filter((x) => x !== personId);
        return filtered.length === p.spouses.length ? p : Object.assign({}, p, { spouses: filtered });
      }
      if (toAdd.has(p.id) && !p.spouses.includes(personId)) {
        return Object.assign({}, p, { spouses: p.spouses.concat([personId]) });
      }
      return p;
    });
  }

  // Validate + normalise an incoming whole-tree blob (from a JSON import OR a
  // cloud row) into a clean state object. Throws on a structurally invalid
  // blob so callers never install garbage. Shared by replaceAll (local import)
  // and hydrateFromRemote (cloud load) so the two can never drift apart.
  function normalizeIncomingState(newState) {
    if (!newState || !Array.isArray(newState.people)) {
      throw new Error("Invalid data file: missing 'people' array.");
    }
    // Normalise marriage keys: marriageKey() sorts the pair lexicographically,
    // but a hand-edited or third-party JSON can carry unsorted keys. Re-key
    // every entry so getMarriage(a,b) lookups stay deterministic.
    const rawM = (newState.marriages && typeof newState.marriages === "object") ? newState.marriages : {};
    const marriages = {};
    Object.keys(rawM).forEach((k) => {
      const parts = k.split("|");
      if (parts.length !== 2 || !parts[0] || !parts[1]) return;
      const norm = marriageKey(parts[0], parts[1]);
      if (norm) marriages[norm] = rawM[k];
    });
    return {
      version: SCHEMA_VERSION,
      people: newState.people.map(normalizePerson),
      marriages,
      meta: newState.meta || state.meta
    };
  }

  function replaceAll(newState) {
    if (readOnly) return;
    // If the user had unsaved edits behind a pending debounce timer, flush
    // them now (the timer would otherwise fire AFTER the import lands and
    // overwrite the imported state with the about-to-be-replaced one).
    // flushPersist clears the timer, so the bulk write below stands alone.
    const next = normalizeIncomingState(newState);
    flushPersist();
    state = next;
    persist();
  }

  // Apply a whole-tree blob loaded from the cloud, tagged with the server's
  // optimistic-lock `version`. This is the READ side of sync; the WRITE side
  // (version-guarded push) lives in cloud-store.js.
  //
  // Deliberately does NOT go through persist():
  //   • it must NOT markDirty() — server data isn't a local edit, and flagging
  //     dirty here would bounce it straight back as a push (echo loop);
  //   • it still writes the offline cache + notifies listeners so the UI
  //     repaints and a reload paints the just-hydrated data.
  // A pending local debounce is dropped first: those edits lost the LWW race
  // (that's what a hydrate means), so letting the timer fire would clobber the
  // server data we're installing. cloud-store surfaces the conflict/backup UX
  // separately before calling this on the dirty path.
  function hydrateFromRemote(data, version) {
    const next = normalizeIncomingState(data);
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    state = next;
    cloudVersion = Number(version) || 0;
    try { localStorage.setItem(activeStorageKey(), JSON.stringify(state)); }
    catch (e) { console.error("Cache write failed after hydrate", e); }
    // Server data supersedes this device's edit line — start history fresh from
    // the hydrated state so no undo can walk back into pre-sync history.
    resetHistory();
    notifyAll();
  }

  // — Active-tree + version accessors (cloud-store is the only caller) ————————
  // Switch the store to a different cloud tree. Flushes any pending write to
  // the OUTGOING tree's key first (so its last edit isn't lost), then repoints
  // the key and loads that tree's cached snapshot for an instant offline paint;
  // cloud-store follows up with a fresh remote load + hydrateFromRemote.
  // Passing null returns to local-only single-blob mode.
  function setActiveTree(treeId) {
    const next = treeId || null;
    if (next === activeTreeId) return;
    flushPersist();               // persist outgoing tree under its OLD key
    activeTreeId = next;
    cloudVersion = 0;             // unknown until the next hydrate
    state = load();               // cached snapshot for the new key (or empty)
    // Each tree owns its own undo line; switching starts the new one fresh so an
    // undo can't reach across into the tree we just left.
    resetHistory();
    notifyAll();
  }
  function getActiveTreeId() { return activeTreeId; }
  function getVersion() { return cloudVersion; }
  // Advance the optimistic-lock counter after cloud-store's OWN successful
  // push, so getVersion() keeps matching the server without a re-hydrate
  // (which would notifyAll needlessly and could revert an edit made while the
  // push was in flight). cloudVersion = "the server version my base state
  // corresponds to"; the dirty flag ("unsaved edits on top") lives separately
  // in cloud-store.
  function setVersion(v) { cloudVersion = Number(v) || 0; }

  function clearAll() {
    if (readOnly) return;
    state = emptyState();
    persist();
  }

  // Gather every IDB photo-blob id a (possibly raw-parsed) state object
  // references — people photos + marriage photos. Bare `photo` (base64) fields
  // are inline and vanish with the cache key, so only `photoId` (an IDB key) is
  // collected. Tolerant of malformed input: unknown shapes yield an empty set.
  // Every IDB blob id a single person references: primary avatar + gallery.
  // The one place gallery photoIds are gathered, so orphan-cleanup, per-tree
  // purge, and cloud backfill can't silently miss them (a miss = a leaked blob
  // that never gets uploaded, or never gets freed).
  function personPhotoIds(p) {
    const ids = [];
    if (!p) return ids;
    if (p.photoId) ids.push(p.photoId);
    if (Array.isArray(p.gallery)) p.gallery.forEach((g) => { if (g && g.photoId) ids.push(g.photoId); });
    // Document scans live in the SAME IDB blob store, so they must be counted
    // here too — otherwise orphan-cleanup / purge / backfill would treat a
    // document blob as unreferenced and free it, or fail to sync it to cloud.
    if (Array.isArray(p.documents)) p.documents.forEach((d) => { if (d && d.photoId) ids.push(d.photoId); });
    return ids;
  }

  function collectPhotoIds(st) {
    const ids = new Set();
    if (!st || typeof st !== "object") return ids;
    if (Array.isArray(st.people)) {
      st.people.forEach((p) => { personPhotoIds(p).forEach((id) => ids.add(id)); });
    }
    if (st.marriages && typeof st.marriages === "object") {
      Object.keys(st.marriages).forEach((k) => {
        const m = st.marriages[k];
        if (m && m.photoId) ids.add(m.photoId);
      });
    }
    return ids;
  }

  // Reclaim the LOCAL footprint of a tree the user just deleted or left. In
  // cloud mode each tree owns a "familyTree.<treeId>.v1" offline cache and its
  // photos are IDB blobs; without this, a departed tree's cache blob and photo
  // blobs linger in the browser forever — an unbounded leak on a shared or
  // long-lived device. The server row + bucket are the caller's job (and the
  // off-limits half); this is purely local storage + IndexedDB.
  //
  // Photos are the delicate part: IDB keys are flat, bare photoIds (see
  // photo-store.js) and the SAME id can be referenced by more than one local
  // tree (importing the same backup twice). So a blob is freed ONLY when no
  // surviving local tree still points at it — reference-counted against every
  // other cache key (+ the live in-memory state), never a blind per-tree wipe.
  function purgeLocalTree(treeId) {
    if (!treeId) return;
    const doomedKey = storageKeyFor(treeId);
    if (doomedKey === STORAGE_KEY) return;   // never touch the legacy/local-only blob

    // photoIds the doomed tree referenced. Read from its on-disk cache blob,
    // and — when the store still holds this tree in memory (the delete-last-
    // tree path never repoints away from it) — union in the live state, which
    // is more current than a possibly-stale/unflushed blob and may be the only
    // record if the blob was never written.
    const doomed = new Set();
    try {
      const raw = localStorage.getItem(doomedKey);
      if (raw) collectPhotoIds(JSON.parse(raw)).forEach((id) => doomed.add(id));
    } catch (_) {}
    if (activeTreeId === treeId) collectPhotoIds(state).forEach((id) => doomed.add(id));

    // Drop the cache key regardless — reclaims the localStorage bytes even when
    // the blob is missing or unparseable (we just can't free photos then).
    try { localStorage.removeItem(doomedKey); } catch (_) {}
    if (!doomed.size) return;

    // Every photoId any SURVIVING local data still references. Scan all other
    // per-tree cache keys plus the legacy single-tree key; then add the live
    // in-memory state UNLESS it IS the doomed tree (the delete-last-tree path
    // leaves the store still pointing at it, and counting it would keep every
    // photo — excluding it there is exactly what makes the free correct).
    const keep = new Set();
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k === doomedKey) continue;
        if (k !== STORAGE_KEY && !/^familyTree\..+\.v1$/.test(k)) continue;
        try {
          const raw = localStorage.getItem(k);
          if (raw) collectPhotoIds(JSON.parse(raw)).forEach((id) => keep.add(id));
        } catch (_) {}
      }
    } catch (_) {}
    if (activeTreeId !== treeId) collectPhotoIds(state).forEach((id) => keep.add(id));

    // Free only the blobs the doomed tree EXCLUSIVELY owned, and only from the
    // LOCAL IDB cache — deleteLocal, never delete. A departed tree's bucket
    // objects live under ITS OWN path, but PhotoStore's remote delete resolves
    // the path from the now-active tree (leaving/switching has already repointed
    // it), so a plain delete would fire a wrong-path — or, for a left shared
    // tree, unauthorized — bucket remove. Bucket cleanup for a deleted tree is a
    // separate owner-only concern; local reclaim must stay local. Fire-and-
    // forget, guarded like deletePerson's cleanup (data-store loads before
    // photo-store; headless/test runs have no IDB).
    if (typeof window !== "undefined" && window.PhotoStore && PhotoStore.deleteLocal) {
      doomed.forEach((id) => { if (id && !keep.has(id)) PhotoStore.deleteLocal(id).catch(() => {}); });
    }
  }

  function getFamilyName() {
    return (state.meta && state.meta.familyName) || "Family";
  }
  function setFamilyName(name) {
    if (readOnly) return;
    if (!state.meta) state.meta = {};
    state.meta.familyName = String(name || "").trim() || "Family";
    persist();
  }

  // Full free-form title — what shows in the tree header and on every
  // exported file. Defaults to "{familyName} family tree" so older saves
  // keep their previous title until the user customises it.
  function getFamilyTitle() {
    if (state.meta && state.meta.familyTitle) return state.meta.familyTitle;
    const fam = getFamilyName();
    return fam + " family tree";
  }
  function setFamilyTitle(title) {
    if (readOnly) return;
    if (!state.meta) state.meta = {};
    const cleaned = String(title || "").trim();
    if (!cleaned) {
      delete state.meta.familyTitle;
    } else {
      state.meta.familyTitle = cleaned;
    }
    persist();
  }

  // === Stories ===
  function addStory(personId, input) {
    if (readOnly) return null;
    const idx = state.people.findIndex((p) => p.id === personId);
    if (idx === -1) return null;
    const p = state.people[idx];
    const story = normaliseStory(Object.assign({}, input, { id: input && input.id || genId("s_") }));
    if (!story) return null;
    p.stories = (p.stories || []).slice();
    p.stories.unshift(story);
    p.updatedAt = new Date().toISOString();
    persist();
    return story;
  }
  function updateStory(personId, storyId, patch) {
    if (readOnly) return null;
    const p = getPerson(personId);
    if (!p || !Array.isArray(p.stories)) return null;
    const i = p.stories.findIndex((s) => s.id === storyId);
    if (i === -1) return null;
    const next = normaliseStory(Object.assign({}, p.stories[i], patch, {
      id: storyId,
      createdAt: p.stories[i].createdAt,
      updatedAt: new Date().toISOString()
    }));
    p.stories[i] = next;
    p.updatedAt = new Date().toISOString();
    persist();
    return next;
  }
  function deleteStory(personId, storyId) {
    if (readOnly) return;
    const p = getPerson(personId);
    if (!p || !Array.isArray(p.stories)) return;
    p.stories = p.stories.filter((s) => s.id !== storyId);
    p.updatedAt = new Date().toISOString();
    persist();
  }
  function searchStories(query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return [];
    const hits = [];
    state.people.forEach((p) => {
      (p.stories || []).forEach((s) => {
        const inTitle = (s.title || "").toLowerCase().indexOf(q) !== -1;
        const inBody  = (s.body  || "").toLowerCase().indexOf(q) !== -1;
        const inTags  = (s.tags  || []).some((t) => t.toLowerCase().indexOf(q) !== -1);
        if (inTitle || inBody || inTags) {
          hits.push({ person: p, story: s, matched: { title: inTitle, body: inBody, tags: inTags } });
        }
      });
    });
    return hits;
  }

  // ===== Derivations =====

  function getChildrenOf(parentId) {
    return state.people.filter((p) => p.parents.includes(parentId));
  }

  function getSiblingsOf(personId) {
    const person = getPerson(personId);
    if (!person) return [];
    const set = new Set();
    person.parents.forEach((pid) => {
      getChildrenOf(pid).forEach((sib) => { if (sib.id !== personId) set.add(sib.id); });
    });
    return Array.from(set).map(getPerson).filter(Boolean);
  }

  // === Anniversaries ===
  // Returns events in the next `days` whose anniversary date falls within
  // the window. Pulls birthdays for everyone with a known birth date and
  // death anniversaries for everyone deceased. Sorted by days-from-today
  // ascending. Each event = { person, kind, date (this year's anniversary),
  // daysAway, ageOrYears }.
  function upcomingAnniversaries(days) {
    const window = days || 30;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endTs = today.getTime() + window * 86400000;
    const out = [];
    state.people.forEach((p) => {
      pushAnniversary(out, p, p.birthDate, "birth", today, endTs);
      if (p.deathDate) pushAnniversary(out, p, p.deathDate, "death", today, endTs);
    });
    out.sort((a, b) => a.daysAway - b.daysAway);
    return out;
  }
  function pushAnniversary(out, person, dateStr, kind, today, endTs) {
    if (!dateStr) return;
    const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return; // year-only / partial → no anniversary day
    const month = parseInt(m[2], 10) - 1;
    const day = parseInt(m[3], 10);
    const year = today.getFullYear();
    let occ = new Date(year, month, day);
    occ.setHours(0, 0, 0, 0);
    if (occ.getTime() < today.getTime()) {
      occ = new Date(year + 1, month, day);
      occ.setHours(0, 0, 0, 0);
    }
    if (occ.getTime() > endTs) return;
    const daysAway = Math.round((occ.getTime() - today.getTime()) / 86400000);
    const origYear = parseInt(m[1], 10);
    const ageOrYears = occ.getFullYear() - origYear;
    // Format from LOCAL components, not toISOString() — occ is local midnight,
    // and toISOString() (UTC) would roll the date back a day in any timezone
    // east of UTC. Consumers key calendar events / reminders off this string.
    const yyyy = occ.getFullYear();
    const mm = String(occ.getMonth() + 1).padStart(2, "0");
    const dd = String(occ.getDate()).padStart(2, "0");
    out.push({ person, kind, date: yyyy + "-" + mm + "-" + dd, daysAway, ageOrYears });
  }

  // === Maintenance — "needs attention" stats ===
  // Counts of records missing birth date / photo / description so the rail
  // can surface gaps. Cheap (one O(N) walk) and idempotent.
  function maintenanceStats() {
    const ppl = state.people;
    let missingBirth = 0, missingPhoto = 0, missingDescription = 0;
    ppl.forEach((p) => {
      if (!p.birthDate) missingBirth++;
      if (!p.photo && !p.photoId) missingPhoto++;
      if (!(p.description || "").trim()) missingDescription++;
    });
    return { total: ppl.length, missingBirth, missingPhoto, missingDescription };
  }
  function peopleMissing(field) {
    return state.people.filter((p) => {
      switch (field) {
        case "birth": return !p.birthDate;
        case "photo": return !p.photo && !p.photoId;
        case "description": return !(p.description || "").trim();
        default: return false;
      }
    });
  }

  // === Lineage path-finder ===
  // Bidirectional BFS over the parent-child + spouse graph. Returns an
  // ordered list of person ids forming the shortest chain from a to b
  // (inclusive at both ends), or null if no path exists. Edges are
  // bidirectional: parent <-> child, spouse <-> spouse.
  function findRelationPath(aId, bId) {
    if (!aId || !bId || aId === bId) return aId ? [aId] : null;
    const adj = (id) => {
      const p = getPerson(id);
      if (!p) return [];
      const out = [];
      (p.parents || []).forEach((pid) => out.push(pid));
      getChildrenOf(id).forEach((c) => out.push(c.id));
      (p.spouses || []).forEach((sid) => out.push(sid));
      return out;
    };
    // Standard BFS — small graph, simpler than bidirectional.
    const visited = new Map();
    visited.set(aId, null);
    const queue = [aId];
    while (queue.length) {
      const cur = queue.shift();
      if (cur === bId) {
        const path = [];
        let n = bId;
        while (n != null) { path.unshift(n); n = visited.get(n); }
        return path;
      }
      adj(cur).forEach((nxt) => {
        if (!visited.has(nxt)) {
          visited.set(nxt, cur);
          queue.push(nxt);
        }
      });
    }
    return null;
  }
  // Best-effort label for the relationship between two adjacent ids in a
  // path. Used by the path-finder modal to render "father", "wife",
  // "daughter" between hops.
  function relationLabel(fromId, toId) {
    const from = getPerson(fromId);
    const to = getPerson(toId);
    if (!from || !to) return "→";
    // Localised via the relation.* namespace, with an English fallback so this
    // stays safe if I18n hasn't loaded (e.g. a unit-test import). No vars.
    const rel = (key, fallback) =>
      (global.I18n && typeof global.I18n.t === "function") ? global.I18n.t("relation." + key) : fallback;
    // Gender is stored as "m" | "f" | "o" | null (see people-view gender
    // picker) — compare against those codes, NOT "male"/"female", or every
    // gendered label silently falls through to the neutral form
    // ("spouse"/"parent"/"child") in the path-finder.
    if ((from.spouses || []).includes(toId)) {
      if (to.gender === "f") return rel("wife", "wife");
      if (to.gender === "m") return rel("husband", "husband");
      return rel("spouse", "spouse");
    }
    if ((from.parents || []).includes(toId)) {
      if (to.gender === "f") return rel("mother", "mother");
      if (to.gender === "m") return rel("father", "father");
      return rel("parent", "parent");
    }
    if ((to.parents || []).includes(fromId)) {
      if (to.gender === "f") return rel("daughter", "daughter");
      if (to.gender === "m") return rel("son", "son");
      return rel("child", "child");
    }
    return rel("relation", "relation");
  }

  /**
   * Build generations: people with no parents at gen 0, children at gen+1.
   * Returns Map<id, generation>.
   */
  function buildGenerations() {
    const gen = new Map();
    const visiting = new Set();
    function compute(id) {
      if (gen.has(id)) return gen.get(id);
      if (visiting.has(id)) { gen.set(id, 0); return 0; } // cycle guard
      visiting.add(id);
      const p = getPerson(id);
      if (!p || p.parents.length === 0) {
        gen.set(id, 0); visiting.delete(id); return 0;
      }
      const parentGens = p.parents.map(compute);
      const g = Math.max(...parentGens) + 1;
      gen.set(id, g); visiting.delete(id); return g;
    }
    state.people.forEach((p) => compute(p.id));
    // Pull spouses to the same generation as their partner if their own generation is 0 (i.e. they married in)
    state.people.forEach((p) => {
      if (p.parents.length === 0 && p.spouses.length > 0) {
        const partnerGens = p.spouses.map((sid) => gen.get(sid)).filter((g) => g != null);
        if (partnerGens.length) gen.set(p.id, Math.max(...partnerGens));
      }
    });
    // Place pets one generation BELOW their owner — they read as the
    // family's "kids of choice", connected by a dashed tether. Without
    // this they'd default to 0 (no parents → root row) or — if we placed
    // them in the same row as their owner — clutter the human couple.
    state.people.forEach((p) => {
      if (!p.isPet || !(p.petOwners || []).length) return;
      const ownerGens = p.petOwners.map((oid) => gen.get(oid)).filter((g) => g != null);
      if (ownerGens.length) gen.set(p.id, Math.max(...ownerGens) + 1);
    });
    return gen;
  }

  // ===== Date helpers =====

  function parseDate(s) {
    if (!s) return null;
    // Strictly accept only "YYYY", "YYYY-MM", or "YYYY-MM-DD". Anything else
    // is treated as invalid so callers can surface a clean error.
    const m = String(s).trim().match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
    if (!m) return null;
    const y = +m[1];
    const mo = m[2] ? +m[2] - 1 : 0;
    const da = m[3] ? +m[3] : 1;
    if (mo < 0 || mo > 11 || da < 1 || da > 31) return null;
    const d = new Date(y, mo, da);
    if (isNaN(+d)) return null;
    // Reject impossible days-of-month. JS Date silently rolls overflow
    // forward (new Date(2023, 1, 31) → Mar 3), so "2023-02-31" would parse
    // as a valid March date. Compare the constructed parts back against the
    // requested ones — a mismatch means the day overflowed the month. This
    // also correctly accepts Feb 29 on leap years and rejects it otherwise.
    if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== da) return null;
    return d;
  }

  function getYear(s) {
    if (!s) return null;
    const m = String(s).match(/^(\d{4})/);
    return m ? +m[1] : null;
  }

  function isAlive(person) { return !(person.deathDate && String(person.deathDate).trim()); }
  function isDeceased(person) { return !!(person.deathDate && String(person.deathDate).trim()); }

  function calcAge(person, atDate) {
    const birth = parseDate(person.birthDate);
    if (!birth) return null;
    const end = atDate || (person.deathDate ? parseDate(person.deathDate) : new Date());
    if (!end) return null;
    let age = end.getFullYear() - birth.getFullYear();
    const m = end.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && end.getDate() < birth.getDate())) age--;
    return age;
  }

  // Localised precision/present markers for the shared lifespan label. Falls
  // back to English literals if I18n hasn't loaded (e.g. a unit-test import),
  // so this stays safe to call before the app boots.
  function dateT(key, vars, fallback) {
    if (global.I18n && typeof global.I18n.t === "function") return global.I18n.t(key, vars);
    if (!fallback) return "";
    return fallback.replace(/\{year\}/g, vars && vars.year != null ? String(vars.year) : "");
  }

  function formatDateRange(person) {
    // Show only the years — full dates belong on the profile, not in chips.
    const by = getYear(person.birthDate);
    const dy = getYear(person.deathDate);
    if (by == null && dy == null && !person.deathDate) return "—";
    const bp = person.birthDatePrecision;
    const dp = person.deathDatePrecision;
    function side(year, precision, fallback) {
      if (year == null) return fallback;
      if (!precision || precision === "exact") return String(year);
      // Compact, localised precision markers for chips: c.YYYY / <YYYY / >YYYY
      if (precision === "about")  return dateT("date.circa",  { year }, "c. {year}");
      if (precision === "before") return dateT("date.before", { year }, "before {year}");
      if (precision === "after")  return dateT("date.after",  { year }, "after {year}");
      return String(year);
    }
    const present = dateT("common.present", null, "present");
    const left  = side(by, bp, "?");
    const right = side(dy, dp, person.deathDate ? "?" : present);
    return `${left} – ${right}`;
  }

  // ===== Image helpers =====

  /**
   * Read a File and return a downscaled JPEG data URL (max 512px, ~0.85 quality).
   */
  function fileToDataURL(file, maxDim = 512, quality = 0.85) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve(null);
      if (!/^image\//.test(file.type)) return reject(new Error("Not an image"));
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Could not decode image"));
        img.onload = () => {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.src = /** @type {string} */ (reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  // Initials for fallback avatar
  function initials(name) {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }


  global.FamilyStore = {
    subscribe, getState, getPeople, getPerson,
    addPerson, updatePerson, deletePerson,
    replaceAll, clearAll, purgeLocalTree,
    hydrateFromRemote, setActiveTree, getActiveTreeId, getVersion, setVersion, onDirty,
    setReadOnly, isReadOnly,
    undo, redo, canUndo, canRedo,
    setMute, notifyAll, flushPersist,
    getChildrenOf, getSiblingsOf, buildGenerations,
    parseDate, getYear, isAlive, isDeceased, calcAge, formatDateRange,
    DATE_PRECISIONS,
    fileToDataURL, initials,
    getField,
    getMarriage, setMarriage, deleteMarriage, marriageKey,
    getFamilyName, setFamilyName,
    getFamilyTitle, setFamilyTitle,
    addStory, updateStory, deleteStory, searchStories,
    upcomingAnniversaries, maintenanceStats, peopleMissing,
    findRelationPath, relationLabel,
    SCHEMA_VERSION
  };
})(window);
