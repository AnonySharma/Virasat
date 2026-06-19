/**
 * Data store — single source of truth, persisted in localStorage.
 *
 * Person:
 *   { id, name, photo (data URL or null), birthDate (YYYY-MM-DD or YYYY or null),
 *     deathDate (same or null), birthPlace, deathPlace, gender ('m'|'f'|'o'|null),
 *     notes, parents: [id, ...], spouses: [id, ...] }
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
  let state = load();
  // Boot trace — visible in DevTools console. Helps the user/diag distinguish
  // "data was wiped" from "data is there but didn't render". Cheap one-liner.
  if (typeof console !== "undefined") {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      console.info("[Virasat] loaded —",
        (state.people || []).length, "people,",
        Object.keys(state.marriages || {}).length, "marriages,",
        "localStorage size", raw ? raw.length : 0, "chars");
    } catch (_) {}
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
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
    const k = marriageKey(aId, bId);
    if (!k || !state.marriages) return;
    delete state.marriages[k];
    persist();
  }

  // Date precision modifier — kept tiny and validated everywhere it's read.
  const DATE_PRECISIONS = ["exact", "about", "before", "after"];
  function normalisePrecision(v, date) {
    if (!date) return null;                       // no date → no precision
    if (DATE_PRECISIONS.indexOf(v) >= 0) return v;
    return "exact";
  }

  // Render a date with its precision marker. "1968 (about)" → "c. 1968";
  // "exact" returns the raw string. Used by chips, the timeline and the
  // tree's compact format.
  function formatDateWithPrecision(date, precision) {
    if (!date) return "";
    if (!precision || precision === "exact") return String(date);
    const map = { about: "c. ", before: "before ", after: "after " };
    return (map[precision] || "") + date;
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

  function normalizePerson(p) {
    return {
      id: p.id || genId(),
      name: (p.name || "Unknown").trim(),
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
      gender: p.gender || null,
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

  /**
   * Returns true if the person has any English content with no Hindi counterpart
   * (useful for showing a small "needs Hindi" hint in HI mode).
   */
  function isMissingHindi(person) {
    if (!person) return false;
    const checks = ["name", "occupation", "description", "notes", "birthPlace", "deathPlace"];
    for (const k of checks) {
      if (person[k] && !person[k + "_hi"]) return true;
    }
    if ((person.achievements || []).length > (person.achievements_hi || []).filter(Boolean).length) return true;
    if ((person.education || []).length > (person.education_hi || []).filter(Boolean).length) return true;
    return false;
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
    if (mute || (opts && opts.silent)) return;
    listeners.forEach((fn) => {
      try { fn(state); } catch (err) { console.error(err); }
    });
  }
  function setMute(v) { mute = !!v; }
  function notifyAll() {
    listeners.forEach((fn) => {
      try { fn(state); } catch (err) { console.error(err); }
    });
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
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      // If we had a pending debounced write, that means this tab made an
      // edit that's about to be silently overwritten by the other tab's
      // write. Surface it as a banner instead of swallowing — the user
      // should know their last edit was discarded and can choose whether
      // to reload or copy their state out.
      const hadPendingEdit = !!persistTimer;
      if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
      try {
        state = load();
        listeners.forEach((fn) => { try { fn(state); } catch (err) { console.error(err); } });
        if (hadPendingEdit && typeof window.dispatchEvent === "function") {
          window.dispatchEvent(new CustomEvent("virasat:cross-tab-conflict"));
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
    genId._n = (genId._n || 0) + 1;
    return px
      + Math.random().toString(36).slice(2, 8)
      + Date.now().toString(36).slice(-4)
      + genId._n.toString(36);
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
    const person = normalizePerson({ ...input, id: input.id || genId() });
    state.people.push(person);
    syncSpouses(person.id, person.spouses, []);
    persist();
    return person;
  }

  function updatePerson(id, patch) {
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
    state.people = state.people.filter((p) => p.id !== id);
    // Strip references
    state.people.forEach((p) => {
      p.parents = p.parents.filter((pid) => pid !== id);
      p.spouses = p.spouses.filter((sid) => sid !== id);
    });
    // Drop any marriage records mentioning the deleted person — otherwise
    // the keys keep dangling ids forever and re-binding the same id (after
    // a re-import) would surface a stale marriage.
    if (state.marriages) {
      Object.keys(state.marriages).forEach((k) => {
        const [a, b] = k.split("|");
        if (a === id || b === id) delete state.marriages[k];
      });
    }
    persist();
  }

  // Bidirectional spouse-link maintenance. Builds a new state.people
  // array in one pass and assigns it atomically — so a mid-sync crash
  // can't leave one partner listing the other while the other doesn't.
  // Previously this mutated each partner record in place (one .find() +
  // .push() per partner), which was N separate writes that could
  // partially apply.
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

  function replaceAll(newState) {
    if (!newState || !Array.isArray(newState.people)) {
      throw new Error("Invalid data file: missing 'people' array.");
    }
    // If the user had unsaved edits behind a pending debounce timer, flush
    // them now (the timer would otherwise fire AFTER the import lands and
    // overwrite the imported state with the about-to-be-replaced one).
    // flushPersist clears the timer, so the bulk write below stands alone.
    flushPersist();
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
    state = {
      version: SCHEMA_VERSION,
      people: newState.people.map(normalizePerson),
      marriages,
      meta: newState.meta || state.meta
    };
    persist();
  }

  function clearAll() {
    state = emptyState();
    persist();
  }

  function getFamilyName() {
    return (state.meta && state.meta.familyName) || "Family";
  }
  function setFamilyName(name) {
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
    out.push({ person, kind, date: occ.toISOString().slice(0, 10), daysAway, ageOrYears });
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
    if ((from.spouses || []).includes(toId)) {
      if (to.gender === "female") return "wife";
      if (to.gender === "male") return "husband";
      return "spouse";
    }
    if ((from.parents || []).includes(toId)) {
      if (to.gender === "female") return "mother";
      if (to.gender === "male") return "father";
      return "parent";
    }
    if ((to.parents || []).includes(fromId)) {
      if (to.gender === "female") return "daughter";
      if (to.gender === "male") return "son";
      return "child";
    }
    return "relation";
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
    if (isNaN(d)) return null;
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
      // Compact precision markers for chips: c.YYYY / <YYYY / >YYYY
      if (precision === "about")  return "c. " + year;
      if (precision === "before") return "before " + year;
      if (precision === "after")  return "after " + year;
      return String(year);
    }
    const left  = side(by, bp, "?");
    const right = side(dy, dp, person.deathDate ? "?" : "present");
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
          const ctx = canvas.getContext("2d");
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.src = reader.result;
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
    replaceAll, clearAll,
    setMute, notifyAll, flushPersist,
    getChildrenOf, getSiblingsOf, buildGenerations,
    parseDate, getYear, isAlive, isDeceased, calcAge, formatDateRange,
    formatDateWithPrecision, DATE_PRECISIONS,
    fileToDataURL, initials,
    getField, isMissingHindi,
    getMarriage, setMarriage, deleteMarriage, marriageKey,
    getFamilyName, setFamilyName,
    getFamilyTitle, setFamilyTitle,
    addStory, updateStory, deleteStory, searchStories,
    upcomingAnniversaries, maintenanceStats, peopleMissing,
    findRelationPath, relationLabel,
    SCHEMA_VERSION
  };
})(window);
