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
  const SCHEMA_VERSION = 1;

  const listeners = new Set();
  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return emptyState();
      // Normalize every person
      const people = Array.isArray(parsed.people) ? parsed.people.map(normalizePerson) : [];
      return {
        version: SCHEMA_VERSION,
        people,
        meta: parsed.meta || { familyName: "Sharma Family", createdAt: new Date().toISOString() }
      };
    } catch (e) {
      console.warn("Failed to load store, resetting", e);
      return emptyState();
    }
  }

  function emptyState() {
    return {
      version: SCHEMA_VERSION,
      people: [],
      meta: { familyName: "Sharma Family", createdAt: new Date().toISOString() }
    };
  }

  function normalizePerson(p) {
    return {
      id: p.id || genId(),
      name: (p.name || "Unknown").trim(),
      name_hi: p.name_hi || "",
      photo: p.photo || null,           // base64 data URL (auto-migrated to IDB)
      photoId: p.photoId || null,       // IndexedDB blob id
      birthDate: p.birthDate || null,
      deathDate: p.deathDate || null,
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
      parents: Array.isArray(p.parents) ? p.parents.filter(Boolean) : [],
      spouses: Array.isArray(p.spouses) ? p.spouses.filter(Boolean) : [],
      createdAt: p.createdAt || new Date().toISOString(),
      updatedAt: p.updatedAt || new Date().toISOString()
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

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error("Persist failed (storage full?)", e);
      throw new Error("Storage full — try removing photos or exporting your data.");
    }
    listeners.forEach((fn) => {
      try { fn(state); } catch (err) { console.error(err); }
    });
  }

  function genId() {
    return "p_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
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
    state = {
      version: SCHEMA_VERSION,
      people: newState.people.map(normalizePerson),
      meta: newState.meta || state.meta
    };
    persist();
  }

  function clearAll() {
    state = emptyState();
    persist();
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
    const left  = by != null ? String(by) : "?";
    const right = dy != null ? String(dy)
                : person.deathDate ? "?"
                : "present";
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
  function sampleData() {
    const now = new Date().toISOString();
    const ids = { gp1: "p_gp1", gp2: "p_gp2", gm1: "p_gm1", gm2: "p_gm2",
                  f: "p_f", m: "p_m", c1: "p_c1", c2: "p_c2", u1: "p_u1" };
    const mk = (id, o) => ({ id, parents: [], spouses: [], createdAt: now, updatedAt: now, ...o });
    return {
      version: SCHEMA_VERSION,
      meta: { familyName: "Sharma Family", createdAt: now },
      people: [
        mk(ids.gp1, { name: "Ramesh Sharma",  birthDate: "1935-04-12", deathDate: "2010-08-03", birthPlace: "Jaipur, India", spouses: [ids.gm1],
          occupation: "Schoolteacher",
          description: "A patient teacher who started a small village school in 1962. Loved gardening and Hindi poetry.",
          achievements: ["Founded the village primary school", "President's Award for Teaching, 1985", "Wrote a book of Hindi couplets"],
          education: ["MA, Hindi Literature — University of Rajasthan, 1958", "BEd — Jaipur, 1960"] }),
        mk(ids.gm1, { name: "Sushila Sharma", birthDate: "1940-09-01", deathDate: "2018-02-14", birthPlace: "Jaipur, India", spouses: [ids.gp1] }),
        mk(ids.gp2, { name: "Vikram Verma",   birthDate: "1938-01-22", deathDate: "2005-11-20", birthPlace: "Delhi, India",  spouses: [ids.gm2] }),
        mk(ids.gm2, { name: "Kamala Verma",   birthDate: "1942-06-30", birthPlace: "Delhi, India", spouses: [ids.gp2] }),
        mk(ids.f,   { name: "Anil Sharma",    birthDate: "1965-07-19", birthPlace: "Jaipur, India", parents: [ids.gp1, ids.gm1], spouses: [ids.m],
          occupation: "Civil engineer",
          description: "Built bridges in three states. Quiet, methodical, and a serious cricket fan.",
          achievements: ["Lead engineer on the Yamuna river bridge project", "Chartered Engineer, ICE 1994"],
          education: ["BTech Civil Engineering — IIT Roorkee, 1987"] }),
        mk(ids.m,   { name: "Priya Verma",    birthDate: "1968-03-25", birthPlace: "Delhi, India", parents: [ids.gp2, ids.gm2], spouses: [ids.f] }),
        mk(ids.u1,  { name: "Rohit Sharma",   birthDate: "1970-12-05", birthPlace: "Jaipur, India", parents: [ids.gp1, ids.gm1] }),
        mk(ids.c1,  { name: "Ankit Sharma",   birthDate: "1995-05-14", birthPlace: "Bengaluru, India", parents: [ids.f, ids.m] }),
        mk(ids.c2,  { name: "Neha Sharma",    birthDate: "1998-11-08", birthPlace: "Bengaluru, India", parents: [ids.f, ids.m] })
      ]
    };
  }

  global.FamilyStore = {
    subscribe, getState, getPeople, getPerson,
    addPerson, updatePerson, deletePerson,
    replaceAll, clearAll,
    getChildrenOf, getSiblingsOf, buildGenerations,
    parseDate, getYear, isAlive, isDeceased, calcAge, formatDateRange,
    fileToDataURL, initials, sampleData,
    getField, isMissingHindi,
    SCHEMA_VERSION
  };
})(window);
