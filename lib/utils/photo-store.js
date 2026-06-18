/**
 * PhotoStore — manages photos out of localStorage so we don't blow the 5MB cap.
 *
 * Three sources for a person's photo, resolved in order:
 *   1. person.photoUrl  → committed to repo (e.g. "photos/p_xxx.jpg"). Used as-is.
 *   2. person.photoId   → IndexedDB blob. Resolved to an Object URL on demand.
 *   3. person.photo     → legacy base64 data URL (auto-migrated to IDB on load).
 *
 * Public API:
 *   PhotoStore.ready()                 — Promise resolved once IDB is open and migration done.
 *   PhotoStore.put(blob) -> Promise<id>
 *   PhotoStore.get(id)   -> Promise<Blob|null>
 *   PhotoStore.getUrl(person) -> Promise<string|null>  // resolves to a URL usable in <img src=...>
 *   PhotoStore.getUrlSync(person) -> string|null       // sync best-effort (cached)
 *   PhotoStore.delete(id)              — Promise
 *   PhotoStore.exportAll() -> Promise<{[id]: Blob}>    // for ZIP export
 *   PhotoStore.importMany({[id]: Blob}) -> Promise
 */
(function (global) {
  "use strict";

  const DB_NAME = "familyTree.photos";
  const STORE = "photos";
  const VERSION = 1;

  let dbPromise = null;
  const urlCache = new Map(); // id -> objectURL
  const readyPromise = open().then(migrateLegacy);

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!global.indexedDB) {
        // Graceful fallback: in-memory map. Photos won't persist but app still works.
        console.warn("IndexedDB unavailable; photos stored in memory only.");
        const mem = new Map();
        return resolve({
          __mem: true,
          put: (blob) => { const id = newPhotoId(); mem.set(id, blob); return Promise.resolve(id); },
          putWithKey: (id, blob) => { mem.set(id, blob); return Promise.resolve(id); },
          get: (id) => Promise.resolve(mem.get(id) || null),
          delete: (id) => { mem.delete(id); return Promise.resolve(); },
          all: () => { const out = {}; mem.forEach((v, k) => { out[k] = v; }); return Promise.resolve(out); }
        });
      }
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(wrap(req.result));
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  // Process-wide counter so two PhotoStore.put() calls in the same millisecond
  // can't mint the same key — the sync portion of `put` reads-back, retries.
  let putCounter = 0;
  function newPhotoId() {
    putCounter += 1;
    return "ph_"
      + Math.random().toString(36).slice(2, 8)
      + Date.now().toString(36).slice(-4)
      + putCounter.toString(36);
  }

  function wrap(db) {
    return {
      // Pick an unused key inside the transaction so concurrent puts can't
      // collide on the same id. The previous sync id-mint races when the
      // function is called twice on the same tick.
      put: (blob) => txValue("readwrite", (s, done, fail) => {
        function attempt() {
          const id = newPhotoId();
          const checkReq = s.get(id);
          checkReq.onerror = () => fail(checkReq.error);
          checkReq.onsuccess = () => {
            if (checkReq.result !== undefined) { attempt(); return; }
            const putReq = s.put(blob, id);
            putReq.onerror = () => fail(putReq.error);
            putReq.onsuccess = () => done(id);
          };
        }
        attempt();
      }),
      // Allow the importer to write blobs at known ids without spawning a
      // second IDB connection — fixes the schema-corruption race the audit
      // flagged in importPreservingIds.
      putWithKey: (id, blob) => txValue("readwrite", (s, done, fail) => {
        const putReq = s.put(blob, id);
        putReq.onerror = () => fail(putReq.error);
        putReq.onsuccess = () => done(id);
      }),
      get: (id) => txValue("readonly", (s, done, fail) => {
        const r = s.get(id);
        r.onerror = () => fail(r.error);
        r.onsuccess = () => done(r.result);
      }),
      delete: (id) => txValue("readwrite", (s, done, fail) => {
        const r = s.delete(id);
        r.onerror = () => fail(r.error);
        r.onsuccess = () => done(undefined);
      }),
      all: () => txValue("readonly", (s, done, fail) => {
        const out = {};
        const cursorReq = s.openCursor();
        cursorReq.onerror = () => fail(cursorReq.error);
        cursorReq.onsuccess = () => {
          const cur = cursorReq.result;
          if (cur) { out[cur.key] = cur.value; cur.continue(); }
          else done(out);
        };
      })
    };

    // One transaction → one resolved value. Captures the inner result via a
    // done/fail callback pair, then resolves the outer promise on
    // `t.oncomplete` so the IDB write is durable before we hand the value
    // back. Replaces the old `tx` whose `t.oncomplete` could resolve `null`
    // for sync results before the inner promise settled.
    function txValue(mode, fn) {
      return new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const s = t.objectStore(STORE);
        let value;
        let captured = false;
        let error = null;
        try {
          fn(s, (v) => { value = v; captured = true; }, (e) => { error = e; });
        } catch (e) {
          reject(e);
          try { t.abort(); } catch (_) {}
          return;
        }
        t.oncomplete = () => {
          if (error) reject(error);
          else if (captured) resolve(value);
          else resolve(undefined);
        };
        t.onerror = () => reject(error || t.error);
        t.onabort = () => reject(error || t.error || new Error("Transaction aborted"));
      });
    }
  }

  // Migrate any legacy base64 photos on each person into IDB blobs.
  async function migrateLegacy() {
    if (!global.FamilyStore || typeof FamilyStore.getPeople !== "function") return;
    const people = FamilyStore.getPeople();
    let migrated = 0;
    for (const p of people) {
      if (p.photo && !p.photoId && !p.photoUrl) {
        try {
          const blob = dataUrlToBlob(p.photo);
          if (blob) {
            const id = await put(blob);
            FamilyStore.updatePerson(p.id, { photo: null, photoId: id });
            migrated++;
          }
        } catch (e) {
          console.warn("Migration failed for", p.id, e);
        }
      }
    }
    if (migrated) console.log("PhotoStore: migrated", migrated, "photos to IndexedDB.");
  }

  function dataUrlToBlob(dataUrl) {
    const m = String(dataUrl).match(/^data:(.+?);base64,(.+)$/);
    if (!m) return null;
    const mime = m[1];
    const bin = atob(m[2]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function put(blob) { return open().then((db) => db.put(blob)); }
  function getBlob(id) { return open().then((db) => db.get(id)); }
  function delBlob(id) {
    if (urlCache.has(id)) {
      try { URL.revokeObjectURL(urlCache.get(id)); } catch (e) {}
      urlCache.delete(id);
    }
    return open().then((db) => db.delete(id));
  }
  function exportAll() { return open().then((db) => db.all()); }
  // Reuse the existing IDB connection — opening a second one races with
  // versionchange events and risks a schema upgrade in the middle of the
  // import. The wrapped `db.putWithKey` writes each entry under its
  // original id without minting a new one.
  function importPreservingIds(map) {
    return open().then(async (db) => {
      const ids = Object.keys(map || {});
      for (const id of ids) {
        await db.putWithKey(id, map[id]);
      }
    });
  }

  async function getUrl(person) {
    if (!person) return null;
    if (person.photoUrl) return person.photoUrl;
    if (person.photoId) {
      if (urlCache.has(person.photoId)) return urlCache.get(person.photoId);
      const blob = await getBlob(person.photoId);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      urlCache.set(person.photoId, url);
      return url;
    }
    if (person.photo) return person.photo; // legacy fallback
    return null;
  }

  function getUrlSync(person) {
    if (!person) return null;
    if (person.photoUrl) return person.photoUrl;
    if (person.photoId && urlCache.has(person.photoId)) return urlCache.get(person.photoId);
    if (person.photo) return person.photo;
    return null;
  }

  /**
   * Take a File, downscale to JPEG (max 512px, ~0.85 quality), store in IDB.
   * Returns the photoId.
   */
  async function fileToPhotoId(file, maxDim = 512, quality = 0.85) {
    if (!file) return null;
    if (!/^image\//.test(file.type)) throw new Error("Not an image");
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onerror = () => reject(new Error("Could not decode image"));
      i.onload = () => resolve(i);
      i.src = dataUrl;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    return put(blob);
  }

  /**
   * Set <img> src to the photo URL once it resolves. Falls back gracefully.
   */
  function bindImg(imgEl, person, fallback) {
    const url = getUrlSync(person);
    if (url) { imgEl.src = url; return; }
    if (!person || (!person.photoId && !person.photoUrl && !person.photo)) {
      if (fallback) imgEl.src = fallback;
      return;
    }
    getUrl(person).then((u) => { if (u) imgEl.src = u; else if (fallback) imgEl.src = fallback; });
  }

  /**
   * Wipe every photo blob and every cached object URL. Used by the global
   * "Reset everything" flow.
   */
  function clearAll() {
    // Revoke any cached object URLs first
    urlCache.forEach((u) => { try { URL.revokeObjectURL(u); } catch (_) {} });
    urlCache.clear();
    return open().then((db) => {
      if (db.__mem) {
        // In-memory fallback: nothing persistent to clear; the underlying
        // map is owned by the wrapped object and will be garbage-collected
        // once references drop, which is fine.
        return;
      }
      return new Promise((resolve, reject) => {
        const idb = global.indexedDB.open(DB_NAME, VERSION);
        idb.onsuccess = () => {
          const real = idb.result;
          const t = real.transaction(STORE, "readwrite");
          t.objectStore(STORE).clear();
          t.oncomplete = () => { real.close(); resolve(); };
          t.onerror = () => { real.close(); reject(t.error); };
        };
        idb.onerror = () => reject(idb.error);
      });
    });
  }

  global.PhotoStore = {
    ready: () => readyPromise,
    put, get: getBlob, delete: delBlob,
    getUrl, getUrlSync, fileToPhotoId, bindImg,
    exportAll, importMany: importPreservingIds,
    clearAll,
    migrateLegacy
  };
})(window);
