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
          put: (blob) => { const id = "ph_" + Math.random().toString(36).slice(2, 10); mem.set(id, blob); return Promise.resolve(id); },
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

  function wrap(db) {
    return {
      put: (blob) => tx("readwrite", (s) => {
        const id = "ph_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
        s.put(blob, id);
        return id;
      }),
      get: (id) => tx("readonly", (s) => req(s.get(id))),
      delete: (id) => tx("readwrite", (s) => { s.delete(id); return undefined; }),
      all: () => tx("readonly", (s) => new Promise((res, rej) => {
        const out = {};
        const cursorReq = s.openCursor();
        cursorReq.onsuccess = () => {
          const cur = cursorReq.result;
          if (cur) { out[cur.key] = cur.value; cur.continue(); }
          else res(out);
        };
        cursorReq.onerror = () => rej(cursorReq.error);
      }))
    };
    function tx(mode, fn) {
      return new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const s = t.objectStore(STORE);
        const result = fn(s);
        t.oncomplete = () => resolve(result instanceof Promise ? null : result);
        t.onerror = () => reject(t.error);
        if (result instanceof Promise) result.then(resolve, reject);
      });
    }
    function req(r) {
      return new Promise((resolve, reject) => {
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
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
  function importMany(map) {
    return open().then(async (db) => {
      for (const id in map) await db.put(map[id]); // db.put creates new IDs; we want to preserve ids → use raw
      // Above creates new ids; for import we need to preserve. Re-implement:
    }).then(() => importPreservingIds(map));
  }
  function importPreservingIds(map) {
    return new Promise((resolve, reject) => {
      open().then((db) => {
        if (db.__mem) {
          for (const id in map) db._mem ? db._mem.set(id, map[id]) : null;
          // For the in-memory fallback we don't expose set-with-id directly; skip preservation.
          return resolve();
        }
        // Real IDB: open a new transaction and put with explicit keys.
        const idb = global.indexedDB.open(DB_NAME, VERSION);
        idb.onsuccess = () => {
          const real = idb.result;
          const t = real.transaction(STORE, "readwrite");
          const s = t.objectStore(STORE);
          for (const id in map) s.put(map[id], id);
          t.oncomplete = () => { real.close(); resolve(); };
          t.onerror = () => { real.close(); reject(t.error); };
        };
        idb.onerror = () => reject(idb.error);
      });
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

  global.PhotoStore = {
    ready: () => readyPromise,
    put, get: getBlob, delete: delBlob,
    getUrl, getUrlSync, fileToPhotoId, bindImg,
    exportAll, importMany: importPreservingIds
  };
})(window);
