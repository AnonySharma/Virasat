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
      photoUrl: p.photoUrl || null,     // path to a committed asset (e.g. "assets/sample/p1.jpg")
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
      // Drop any pending debounce — the value we'd have written is already
      // stale relative to the other tab's update.
      if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
      try {
        state = load();
        listeners.forEach((fn) => { try { fn(state); } catch (err) { console.error(err); } });
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

  function syncSpouses(personId, nextSpouseIds, prevSpouseIds) {
    const next = new Set(nextSpouseIds);
    const prev = new Set(prevSpouseIds);
    // Remove from spouses no longer linked
    prev.forEach((sid) => {
      if (!next.has(sid)) {
        const sp = state.people.find((p) => p.id === sid);
        if (sp) sp.spouses = sp.spouses.filter((x) => x !== personId);
      }
    });
    // Add to new spouses
    next.forEach((sid) => {
      const sp = state.people.find((p) => p.id === sid);
      if (sp && !sp.spouses.includes(personId)) sp.spouses.push(personId);
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
      if (!p.photo && !p.photoId && !p.photoUrl) missingPhoto++;
      if (!(p.description || "").trim()) missingDescription++;
    });
    return { total: ppl.length, missingBirth, missingPhoto, missingDescription };
  }
  function peopleMissing(field) {
    return state.people.filter((p) => {
      switch (field) {
        case "birth": return !p.birthDate;
        case "photo": return !p.photo && !p.photoId && !p.photoUrl;
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

  // Sample data (loaded on first run if requested)
  // Four-generation Sharma family used for the "Try sample data" first-run
  // and for the README screenshots. Every record carries the full schema
  // surface (precision, places, occupation, description, achievements,
  // education, stories with tags, Hindi twins on the principal fields, and
  // a photoUrl pointing at a committed JPEG in assets/sample/). Marriage
  // records carry date / place / story so the gold-knot modal has content
  // to show when the user opens it. All ids are stable so a reset → reload
  // produces the same tree.
  function sampleData() {
    const now = new Date().toISOString();
    const id = {
      // Gen 1 — great-grandparents
      gg_ms:  "p_gg_ms",   gg_ld:  "p_gg_ld",
      gg_dv:  "p_gg_dv",   gg_sv:  "p_gg_sv",
      // Gen 2 — grandparents
      g_rs:   "p_g_rs",    g_su:   "p_g_su",
      // Gen 3 — parents + uncle/aunt + aunt
      p_anil: "p_anil",    p_priya:"p_priya",
      p_rohit:"p_rohit",   p_anjali:"p_anjali",
      p_meera:"p_meera",
      // Gen 4 — current generation
      c_ankit:"p_ankit",   c_neha: "p_neha",   c_aditya:"p_aditya",
      // Pets — companion animals are real members of many families.
      pet_kabir:"p_pet_kabir"
    };
    const mk = (pid, o) => ({ id: pid, parents: [], spouses: [], createdAt: now, updatedAt: now, ...o });
    const story = (sid, title, body, tags) => ({
      id: sid, title, body, tags: tags || [], createdAt: now, updatedAt: now
    });

    const people = [
      // ===== Gen 1 — great-grandparents =====
      mk(id.gg_ms, {
        name: "Mohan Lal Sharma", name_hi: "मोहन लाल शर्मा",
        photoUrl: "assets/sample/p1.jpg",
        birthDate: "1908", birthDatePrecision: "about",
        deathDate: "1982-03-09", deathDatePrecision: "exact",
        birthPlace: "Bikaner, Rajasthan, India", birthPlace_hi: "बीकानेर, राजस्थान",
        deathPlace: "Jaipur, India", deathPlace_hi: "जयपुर",
        gender: "male",
        occupation: "Cloth merchant", occupation_hi: "कपड़ा व्यापारी",
        description: "Walked from Bikaner to Jaipur as a young man with two trunks of hand-block cottons. Built a small shop in Johari Bazaar over forty years and refused to sell anything he wouldn't wear himself.",
        description_hi: "जवानी में दो ट्रंक हाथ-छपाई की सूती लेकर बीकानेर से जयपुर पैदल आए। चालीस वर्षों में जौहरी बाज़ार में एक छोटी दुकान खड़ी की।",
        achievements: [
          "Founded Sharma Textiles, Johari Bazaar (1934)",
          "Sponsored ten children's school fees every year for twenty-five years"
        ],
        education: ["Class 8 — Government school, Bikaner"],
        spouses: [id.gg_ld],
        stories: [
          story("s_ms_1", "The walk to Jaipur",
            "He was sixteen when his father gave him two trunks and a blessing and pointed him south. Six days on foot, sleeping under banyan trees. He used to say the road taught him more than any teacher ever could — that you find out what you're made of when nobody's watching.",
            ["origin", "youth", "rajasthan"]),
          story("s_ms_2", "His ledger book",
            "Every customer was entered by name in a green cloth-bound ledger. When someone couldn't pay, he wrote 'next year' in pencil. Some of those pencil entries stayed forty years.",
            ["business", "character"])
        ]
      }),
      mk(id.gg_ld, {
        name: "Lakshmi Devi Sharma", name_hi: "लक्ष्मी देवी शर्मा",
        photoUrl: "assets/sample/p5.jpg",
        birthDate: "1912", birthDatePrecision: "about",
        deathDate: "1989-11-22", deathDatePrecision: "exact",
        birthPlace: "Jaipur, India", birthPlace_hi: "जयपुर",
        deathPlace: "Jaipur, India", deathPlace_hi: "जयपुर",
        gender: "female",
        occupation: "Homemaker; mid-wife (informal)", occupation_hi: "गृहिणी; अनुभवी दाई",
        description: "Mother of seven, of whom three lived. Delivered most of the babies on her lane through the 1950s — never charged a rupee. Could read a fever from across a courtyard.",
        achievements: ["Trained eight younger women in basic neonatal care"],
        spouses: [id.gg_ms],
        stories: [
          story("s_ld_1", "The brass thali",
            "She kept a single brass thali wrapped in cotton on the highest shelf — used only on the day each grandchild was born. Polished it the night before, every time.",
            ["tradition", "matriarch"])
        ]
      }),

      mk(id.gg_dv, {
        name: "Devanand Verma", name_hi: "देवानंद वर्मा",
        photoUrl: "assets/sample/p12.jpg",
        birthDate: "1910-07-04", birthDatePrecision: "exact",
        deathDate: "1985", deathDatePrecision: "about",
        birthPlace: "Delhi, India", birthPlace_hi: "दिल्ली",
        deathPlace: "Delhi, India", deathPlace_hi: "दिल्ली",
        gender: "male",
        occupation: "Railway clerk", occupation_hi: "रेलवे क्लर्क",
        description: "Worked the same desk at Delhi Junction for thirty-eight years. Knew every train timing by memory; people came to his window for the schedule before they bought a ticket.",
        achievements: ["Honoured for 25 years' service, Northern Railway, 1962"],
        education: ["Intermediate — Hindu College, Delhi"],
        spouses: [id.gg_sv]
      }),
      mk(id.gg_sv, {
        name: "Saraswati Verma", name_hi: "सरस्वती वर्मा",
        photoUrl: "assets/sample/p13.jpg",
        birthDate: "1915-02-19", birthDatePrecision: "exact",
        deathDate: "1992-08-30", deathDatePrecision: "exact",
        birthPlace: "Lucknow, India", birthPlace_hi: "लखनऊ",
        deathPlace: "Delhi, India", deathPlace_hi: "दिल्ली",
        gender: "female",
        occupation: "Sanskrit teacher", occupation_hi: "संस्कृत अध्यापिका",
        description: "Taught Sanskrit at a girls' school in Old Delhi. Wrote letters to her sons in flawless Devanagari every Tuesday. Refused to retire until she was seventy-two.",
        achievements: ["Translated three Upanishads into Hindi for a school primer"],
        education: ["Acharya in Sanskrit — Banaras Hindu University, 1937"],
        spouses: [id.gg_dv],
        stories: [
          story("s_sv_1", "Tuesday letters",
            "She wrote on thin blue inland-letter paper. 'My dear son,' it always began. 'The neem outside the kitchen window has new leaves.' She wrote like that — small things first, then the news.",
            ["letters", "matriarch"])
        ]
      }),

      // ===== Gen 2 — grandparents =====
      mk(id.g_rs, {
        name: "Ramesh Sharma", name_hi: "रमेश शर्मा",
        photoUrl: "assets/sample/p14.jpg",
        birthDate: "1935-04-12", birthDatePrecision: "exact",
        deathDate: "2010-08-03", deathDatePrecision: "exact",
        birthPlace: "Jaipur, India", birthPlace_hi: "जयपुर",
        deathPlace: "Jaipur, India", deathPlace_hi: "जयपुर",
        gender: "male",
        occupation: "Schoolteacher (Hindi)", occupation_hi: "हिन्दी अध्यापक",
        description: "A patient teacher who founded a village school in 1962 and ran it for thirty-eight years. Loved gardening, Hindi poetry, and an evening cup of cardamom chai with a thin biscuit.",
        description_hi: "एक धैर्यवान अध्यापक, जिन्होंने 1962 में एक गाँव में प्राथमिक विद्यालय की स्थापना की और अड़तीस वर्षों तक चलाया।",
        achievements: [
          "Founded Saraswati Vidya Mandir village school (1962)",
          "President's Award for Teaching, 1985",
          "Published a slim book of Hindi couplets, *Mitti ke Sapne* (1998)"
        ],
        achievements_hi: [
          "सरस्वती विद्या मंदिर गाँव विद्यालय की स्थापना (1962)",
          "राष्ट्रपति शिक्षक पुरस्कार, 1985",
          "हिन्दी दोहों का संग्रह, 'मिट्टी के सपने' (1998)"
        ],
        education: ["MA Hindi Literature — University of Rajasthan, 1958", "BEd — Jaipur, 1960"],
        parents: [id.gg_ms, id.gg_ld],
        spouses: [id.g_su],
        stories: [
          story("s_rs_1", "The first day of school",
            "Eleven children. One blackboard he had carried home on his bicycle from Jaipur. He wrote each child's name in chalk and made them write it back. Two of those eleven later became teachers themselves.",
            ["teaching", "education", "village"]),
          story("s_rs_2", "Saturday garden",
            "Every Saturday morning, no exceptions, he tied a cloth around his head and pruned the bougainvillea. He wouldn't let anyone help. Said the plants knew his hands.",
            ["garden", "ritual"])
        ]
      }),
      mk(id.g_su, {
        name: "Sushila Sharma", name_hi: "सुशीला शर्मा",
        photoUrl: "assets/sample/p15.jpg",
        birthDate: "1940-09-01", birthDatePrecision: "exact",
        deathDate: "2018-02-14", deathDatePrecision: "exact",
        birthPlace: "Delhi, India", birthPlace_hi: "दिल्ली",
        deathPlace: "Jaipur, India", deathPlace_hi: "जयपुर",
        gender: "female",
        occupation: "Headmistress (after 1985)", occupation_hi: "प्रधानाध्यापिका",
        description: "Took over as headmistress of the village school in 1985 when Ramesh moved into administration. Strict about handwriting, soft about everything else. Could fold a saree in seven seconds flat.",
        achievements: ["Doubled girls' enrolment between 1985 and 1995", "Best Headmistress, Jaipur Zilla, 1992"],
        education: ["BA Hindi — Lady Shri Ram College, Delhi, 1961", "BEd — Jaipur, 1963"],
        parents: [id.gg_dv, id.gg_sv],
        spouses: [id.g_rs],
        stories: [
          story("s_su_1", "The sewing machine",
            "Her father gave her a black Singer sewing machine on her wedding day. It is in the corner of the room where she died, oiled and threaded. None of us has the heart to move it.",
            ["heirloom", "wedding"])
        ]
      }),

      // ===== Gen 3 — parents + uncle/aunt + aunt =====
      mk(id.p_anil, {
        name: "Anil Sharma", name_hi: "अनिल शर्मा",
        photoUrl: "assets/sample/p33.jpg",
        birthDate: "1965-07-19", birthDatePrecision: "exact",
        birthPlace: "Jaipur, India", birthPlace_hi: "जयपुर",
        gender: "male",
        occupation: "Civil engineer", occupation_hi: "सिविल इंजीनियर",
        description: "Built bridges in three states across two decades. Quiet, methodical, and a serious cricket fan. Reads a paperback before bed every night without exception.",
        achievements: ["Lead engineer on the Yamuna river bridge (1996)", "Chartered Engineer, ICE 1994"],
        education: ["BTech Civil Engineering — IIT Roorkee, 1987", "MS Structural — IIT Delhi, 1991"],
        contact: {
          phone: "+91 98456 11122", privatePhone: false,
          email: "anil.sharma@example.com", privateEmail: false,
          address: "12 Jasmine Road, Indiranagar, Bengaluru 560038", privateAddress: true
        },
        parents: [id.g_rs, id.g_su],
        spouses: [id.p_priya],
        stories: [
          story("s_anil_1", "Roorkee, 1985",
            "First time on a train alone. Two suitcases, one mathematical-tables book, and a tiffin of chapatis his mother had folded the night before. He still has the tiffin.",
            ["youth", "engineering"])
        ]
      }),
      mk(id.p_priya, {
        name: "Priya Mehta", name_hi: "प्रिया मेहता",
        photoUrl: "assets/sample/p47.jpg",
        birthDate: "1968-03-25", birthDatePrecision: "exact",
        birthPlace: "Delhi, India", birthPlace_hi: "दिल्ली",
        gender: "female",
        occupation: "Paediatrician", occupation_hi: "बाल रोग विशेषज्ञ",
        description: "Runs a clinic in Bengaluru where she's known by every grandmother on the street. Believes in long appointments and listens twice as much as she speaks.",
        achievements: ["Founded Saanjh Clinic, Bengaluru (2002)", "Karnataka Medical Council, Excellence in Paediatric Care, 2014"],
        education: ["MBBS — Lady Hardinge Medical College, 1992", "MD Paediatrics — AIIMS Delhi, 1996"],
        contact: {
          phone: "+91 98456 11123", privatePhone: true,
          email: "priya@saanjhclinic.in", privateEmail: false,
          address: "Saanjh Clinic, 4 Dollars Colony, Bengaluru 560094", privateAddress: false
        },
        spouses: [id.p_anil],
        stories: [
          story("s_priya_1", "First patient",
            "A two-year-old with a fever, brought in by his terrified father. She sat on the floor of the consulting room and let the boy come to her. He fell asleep on her lap before she finished the prescription.",
            ["medicine", "career"])
        ]
      }),

      mk(id.p_rohit, {
        name: "Rohit Sharma", name_hi: "रोहित शर्मा",
        photoUrl: "assets/sample/p48.jpg",
        birthDate: "1970-12-05", birthDatePrecision: "exact",
        birthPlace: "Jaipur, India", birthPlace_hi: "जयपुर",
        gender: "male",
        occupation: "Documentary filmmaker", occupation_hi: "वृत्तचित्र निर्माता",
        description: "Left engineering after two years to chase a film camera around Rajasthan and Gujarat. Has a national award and a dented Bolex he refuses to retire.",
        achievements: ["National Film Award, Best Documentary (Non-Feature), 2008", "Sundance grant, 2011"],
        education: ["BTech Mechanical (incomplete) — IIT Bombay, 1989–91", "FTII Pune — Direction, 1995"],
        contact: {
          phone: "+91 99300 87766", privatePhone: false,
          email: "rohit@bolexfilms.com", privateEmail: false,
          address: "Studio 4, Aram Nagar 2, Versova, Mumbai 400061", privateAddress: false
        },
        parents: [id.g_rs, id.g_su],
        spouses: [id.p_anjali]
      }),
      mk(id.p_anjali, {
        name: "Anjali Singh", name_hi: "अंजली सिंह",
        photoUrl: "assets/sample/p49.jpg",
        birthDate: "1973-06-12", birthDatePrecision: "exact",
        birthPlace: "Lucknow, India", birthPlace_hi: "लखनऊ",
        gender: "female",
        occupation: "Sound designer", occupation_hi: "ध्वनि डिज़ाइनर",
        description: "Met Rohit on a film set in Rann of Kutch and never quite went home. Designs sound for documentaries and one stubborn theatre group in Mumbai.",
        education: ["BA English — St. Stephen's College, Delhi, 1994", "Sound Design — FTII Pune, 1997"],
        contact: {
          phone: "+91 99300 87767", privatePhone: true,
          email: "anjali.singh@example.com", privateEmail: true,
          address: "", privateAddress: false
        },
        spouses: [id.p_rohit]
      }),

      mk(id.p_meera, {
        name: "Meera Sharma", name_hi: "मीरा शर्मा",
        photoUrl: "assets/sample/p50.jpg",
        birthDate: "1968-10-02", birthDatePrecision: "exact",
        birthPlace: "Jaipur, India", birthPlace_hi: "जयपुर",
        gender: "female",
        occupation: "Classical vocalist (Khayal)", occupation_hi: "खयाल गायिका",
        description: "Trained for two decades under Pandit Bhimsen Joshi's lineage. Performs sparingly; teaches twelve students at her Pune house and won't take a thirteenth.",
        achievements: ["Sangeet Natak Akademi Yuva Puraskar, 2003", "ITC SRA Senior Scholar, 1995–98"],
        education: ["BMus Hindustani Vocal — Faculty of Music, MS University Baroda, 1990"],
        contact: {
          phone: "+91 98220 22001", privatePhone: true,
          email: "meera@gandharva-mahal.in", privateEmail: false,
          address: "Gandharva Mahal, 19 Erandwane, Pune 411004", privateAddress: false
        },
        parents: [id.g_rs, id.g_su],
        stories: [
          story("s_meera_1", "Two ragas a day",
            "Meera sings two ragas every morning before sunrise — Bhairav and either Ahir Bhairav or Komal Rishabh Asavari, depending on the season. She has done this every day since she was nineteen, with three known exceptions, all bereavements.",
            ["music", "ritual", "discipline"])
        ]
      }),

      // ===== Gen 4 — current generation =====
      mk(id.c_ankit, {
        name: "Ankit Sharma", name_hi: "अंकित शर्मा",
        photoUrl: "assets/sample/p51.jpg",
        birthDate: "1995-05-14", birthDatePrecision: "exact",
        birthPlace: "Bengaluru, India", birthPlace_hi: "बेंगलुरु",
        gender: "male",
        occupation: "Software engineer", occupation_hi: "सॉफ़्टवेयर इंजीनियर",
        description: "Builds developer tools. Started this family tree in 2026 because his grandmother's sewing-machine story was worth keeping somewhere durable.",
        education: ["BE Computer Science — RV College of Engineering, Bengaluru, 2017"],
        contact: {
          phone: "+91 95350 14572", privatePhone: false,
          email: "ankit@virasat.family", privateEmail: false,
          address: "12 Jasmine Road, Indiranagar, Bengaluru 560038", privateAddress: true
        },
        parents: [id.p_anil, id.p_priya],
        stories: [
          story("s_ankit_1", "Why Virasat exists",
            "Sushila-dadi died on a Tuesday in February. Her sewing machine sat in the corner of the room. None of us could remember which year she was born. We knew the year of her death — there was a date on a certificate. But the year she came into the world, we had to phone three different cousins to triangulate. That call shouldn't have to happen for the next generation.",
            ["origin", "memory"])
        ]
      }),
      mk(id.c_neha, {
        name: "Neha Sharma", name_hi: "नेहा शर्मा",
        photoUrl: "assets/sample/p52.jpg",
        birthDate: "1998-11-08", birthDatePrecision: "exact",
        birthPlace: "Bengaluru, India", birthPlace_hi: "बेंगलुरु",
        gender: "female",
        occupation: "Architect", occupation_hi: "वास्तुकार",
        description: "Works on courtyard houses in Bengaluru and the Nilgiris. Sketches every building twice — once on paper, once again from memory the next morning, to see what stayed.",
        education: ["BArch — CEPT University, Ahmedabad, 2021"],
        contact: {
          phone: "+91 99800 14573", privatePhone: true,
          email: "neha.sharma.arch@example.com", privateEmail: false,
          address: "Studio 7, 4th Cross, Cooke Town, Bengaluru 560005", privateAddress: false
        },
        parents: [id.p_anil, id.p_priya]
      }),
      mk(id.c_aditya, {
        name: "Aditya Sharma", name_hi: "आदित्य शर्मा",
        photoUrl: "assets/sample/p53.jpg",
        birthDate: "2001-08-23", birthDatePrecision: "exact",
        birthPlace: "Mumbai, India", birthPlace_hi: "मुंबई",
        gender: "male",
        occupation: "Documentary cinematographer (assistant)", occupation_hi: "वृत्तचित्र कैमरामैन (सहायक)",
        description: "Inherited his father's Bolex and his mother's ear. Works on his first feature crew in 2026.",
        education: ["BA Film Studies — Whistling Woods, Mumbai, 2023"],
        contact: {
          phone: "+91 80800 99551", privatePhone: false,
          email: "aditya.cinematography@example.com", privateEmail: false,
          address: "", privateAddress: false
        },
        parents: [id.p_rohit, id.p_anjali]
      }),

      // ===== Pets =====
      mk(id.pet_kabir, {
        name: "Kabir", name_hi: "कबीर",
        photoUrl: "assets/sample/pet1.jpg",
        birthDate: "2019-03-08", birthDatePrecision: "exact",
        birthPlace: "Bengaluru, India", birthPlace_hi: "बेंगलुरु",
        gender: "male",
        occupation: "Beagle, chief biscuit officer",
        description: "Anil and Priya's beagle. Eight kilos of opinion. Sleeps on the third stair from the bottom because he can hear both the kitchen and the front door from there.",
        isPet: true,
        petOwners: [id.p_anil, id.p_priya],
        parents: [],
        spouses: [],
        stories: [
          story("s_kabir_1", "The biscuit shelf",
            "He learned which cabinet held the marie biscuits inside a week of moving in. Anil moved them to a higher shelf; Kabir watched. The next week the higher shelf was hit. The biscuits now live in a tin on top of the fridge and Kabir, undefeated, has begun staring at the fridge each morning at 7:14am sharp.",
            ["pet", "domestic", "discipline"])
        ]
      })
    ];

    // Marriage records — keyed by sorted "aId|bId" via marriageKey(). Stored
    // here directly with the literal sorted key so this object can be passed
    // to replaceAll without going through setMarriage (which would call
    // persist N times during sample-data load).
    function mkey(a, b) { return a < b ? a + "|" + b : b + "|" + a; }
    const marriages = {};
    marriages[mkey(id.gg_ms, id.gg_ld)] = {
      date: "1928", place: "Bikaner, Rajasthan",
      story: "Arranged by their families when he was twenty and she was sixteen. They had not seen each other before the wedding day. Lakshmi-bai later said the first thing she noticed was that he tied his shoelaces twice — once normally, then again, tighter.",
      createdAt: now, updatedAt: now
    };
    marriages[mkey(id.gg_dv, id.gg_sv)] = {
      date: "1934-05-21", place: "Lucknow, India",
      story: "He took the morning train from Delhi and arrived an hour late. The pandit had nearly given up. Saraswati's mother said afterwards: 'A man who runs after a train will run after a wife. We can work with that.'",
      createdAt: now, updatedAt: now
    };
    marriages[mkey(id.g_rs, id.g_su)] = {
      date: "1962-12-08", place: "Jaipur, India",
      story: "They met at a teachers' training programme in Jaipur in 1961. He proposed by passing a note across the lecture hall — a couplet she had written on the back of an exam paper, with one line altered. She married him for the line he changed.",
      createdAt: now, updatedAt: now
    };
    marriages[mkey(id.p_anil, id.p_priya)] = {
      date: "1994-02-18", place: "Delhi, India",
      story: "Anil's mother and Priya's aunt met at a wedding and decided two months later that the children should meet. Anil flew from a bridge site in Goa. Priya was on a paediatric rotation. They had ninety minutes for chai. He proposed within the hour; she said she'd think about it; she called the next morning.",
      createdAt: now, updatedAt: now
    };
    marriages[mkey(id.p_rohit, id.p_anjali)] = {
      date: "2002-11-04", place: "Bhuj, Gujarat",
      story: "Married on a film set during the Rann of Kutch shoot. The crew was the wedding party. Rohit wore a white kurta and his sound recordist's headphones around his neck. Anjali made him take them off for the photograph; he put them back on afterwards.",
      createdAt: now, updatedAt: now
    };

    return {
      version: SCHEMA_VERSION,
      meta: { familyName: "Sharma", familyTitle: "Sharma Family Tree", createdAt: now },
      people,
      marriages
    };
  }

  global.FamilyStore = {
    subscribe, getState, getPeople, getPerson,
    addPerson, updatePerson, deletePerson,
    replaceAll, clearAll,
    setMute, notifyAll, flushPersist,
    getChildrenOf, getSiblingsOf, buildGenerations,
    parseDate, getYear, isAlive, isDeceased, calcAge, formatDateRange,
    formatDateWithPrecision, DATE_PRECISIONS,
    fileToDataURL, initials, sampleData,
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
