/**
 * PhotoStore — manages photos out of localStorage so we don't blow the 5MB cap.
 *
 * Two sources for a person's photo, resolved in order:
 *   1. person.photoId   → IndexedDB blob. Resolved to an Object URL on demand.
 *   2. person.photo     → base64 data URL (auto-migrated to IDB on load).
 *
 * The legacy `photoUrl` (committed-asset path) was removed 2026-06-19;
 * sample data is now inlined as base64 via tests/inline-sample-photos.mjs.
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
    // Wrap an IDB-callback so a sync throw inside it is forwarded to `fail`
    // (which aborts the transaction). Without this, an exception thrown in
    // `onsuccess` would let the transaction commit silently with stale data.
    function safe(cb, fail) {
      return function (ev) { try { return cb(ev); } catch (e) { fail(e); } };
    }
    return {
      // Pick an unused key inside the transaction so concurrent puts can't
      // collide on the same id. The previous sync id-mint races when the
      // function is called twice on the same tick.
      put: (blob) => txValue("readwrite", (s, done, fail) => {
        function attempt() {
          const id = newPhotoId();
          const checkReq = s.get(id);
          checkReq.onerror = safe(() => fail(checkReq.error), fail);
          checkReq.onsuccess = safe(() => {
            if (checkReq.result !== undefined) { attempt(); return; }
            const putReq = s.put(blob, id);
            putReq.onerror = safe(() => fail(putReq.error), fail);
            putReq.onsuccess = safe(() => done(id), fail);
          }, fail);
        }
        attempt();
      }),
      // Allow the importer to write blobs at known ids without spawning a
      // second IDB connection — fixes the schema-corruption race the audit
      // flagged in importPreservingIds.
      putWithKey: (id, blob) => txValue("readwrite", (s, done, fail) => {
        const putReq = s.put(blob, id);
        putReq.onerror = safe(() => fail(putReq.error), fail);
        putReq.onsuccess = safe(() => done(id), fail);
      }),
      get: (id) => txValue("readonly", (s, done, fail) => {
        const r = s.get(id);
        r.onerror = safe(() => fail(r.error), fail);
        r.onsuccess = safe(() => done(r.result), fail);
      }),
      delete: (id) => txValue("readwrite", (s, done, fail) => {
        const r = s.delete(id);
        r.onerror = safe(() => fail(r.error), fail);
        r.onsuccess = safe(() => done(undefined), fail);
      }),
      all: () => txValue("readonly", (s, done, fail) => {
        const out = {};
        const cursorReq = s.openCursor();
        cursorReq.onerror = safe(() => fail(cursorReq.error), fail);
        cursorReq.onsuccess = safe(() => {
          const cur = cursorReq.result;
          if (cur) { out[cur.key] = cur.value; cur.continue(); }
          else done(out);
        }, fail);
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
        // Capture an error from anywhere — sync inside `fn`, or async inside
        // any IDB callback the caller registers. Aborts the transaction so
        // it can't commit silently with stale data.
        function fail(e) {
          if (!error) error = e || new Error("Transaction failed");
          try { t.abort(); } catch (_) {}
        }
        try {
          fn(s, (v) => { value = v; captured = true; }, fail);
        } catch (e) {
          fail(e);
          reject(error);
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

  // Migrate any legacy base64 photos on each person AND on each marriage
  // record into IDB blobs. Imports inline photos as base64 on both layers,
  // so both need the same migration treatment to avoid leaving multi-KB
  // strings in localStorage forever.
  async function migrateLegacy() {
    if (!global.FamilyStore || typeof FamilyStore.getPeople !== "function") return;
    // Bulk update — mute store notifications so the tree doesn't re-render
    // once per migrated photo. We emit one final notification at the end.
    const canMute = typeof FamilyStore.setMute === "function";
    if (canMute) FamilyStore.setMute(true);
    const people = FamilyStore.getPeople();
    let migrated = 0;
    for (const p of people) {
      if (p.photo && !p.photoId) {
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
    // Marriage records — same shape (photo: base64, photoId: idb-key).
    if (typeof FamilyStore.getState === "function") {
      const state = FamilyStore.getState();
      const marriages = state && state.marriages;
      if (marriages && typeof FamilyStore.setMarriage === "function") {
        for (const key of Object.keys(marriages)) {
          const m = marriages[key];
          if (!m || !m.photo || m.photoId) continue;
          try {
            const blob = dataUrlToBlob(m.photo);
            if (!blob) continue;
            const id = await put(blob);
            const [a, b] = key.split("|");
            FamilyStore.setMarriage(a, b, { photo: null, photoId: id });
            migrated++;
          } catch (e) {
            console.warn("Marriage photo migration failed for", key, e);
          }
        }
      }
    }
    if (canMute) {
      FamilyStore.setMute(false);
      if (migrated && typeof FamilyStore.notifyAll === "function") FamilyStore.notifyAll();
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
    if (person.photoId) {
      if (urlCache.has(person.photoId)) return urlCache.get(person.photoId);
      const blob = await getBlob(person.photoId);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      urlCache.set(person.photoId, url);
      return url;
    }
    if (person.photo) return person.photo; // pre-migration data URL
    return null;
  }

  function getUrlSync(person) {
    if (!person) return null;
    if (person.photoId && urlCache.has(person.photoId)) return urlCache.get(person.photoId);
    if (person.photo) return person.photo;
    return null;
  }

  /**
   * Take a File, downscale to JPEG (max 512px, ~0.85 quality), store in IDB.
   * Returns the photoId.
   */
  // Resize to maxDim on the long edge, re-encode as JPEG.
  //
  // PRIVACY NOTE — by going through the canvas → toBlob path, the output
  // blob contains only re-encoded pixel data: no EXIF, no IPTC, no XMP,
  // no GPS coordinates, no thumbnail. This is by design (HTML5 canvas
  // 2D context never exposes original-image metadata) and the canonical
  // way to strip metadata from user uploads. Don't replace this pipeline
  // with a "preserve metadata for fidelity" path without an explicit
  // privacy review — family photos routinely carry home addresses in
  // GPS EXIF, and that's a leak we MUST avoid for shared trees.
  //
  // To verify on a specific browser, open `tests/exif-strip.html` and
  // upload a GPS-tagged JPEG. The page runs the same pipeline used by
  // the live app and prints whether EXIF survives the round-trip.
  // Read any Blob/File as a data: URL. Shared with image-export and
  // export-import (they used to define the same function privately).
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(blob);
    });
  }

  async function fileToPhotoId(file, maxDim = 512, quality = 0.85) {
    if (!file) return null;
    if (!/^image\//.test(file.type)) throw new Error("Not an image");
    const dataUrl = await blobToDataUrl(file);
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

  // Inspect a Blob/ArrayBuffer for JPEG metadata markers. Used by the
  // tests/exif-strip.html page to assert the canvas pipeline strips
  // EXIF (APP1 marker FFE1), IPTC (APP13 FFED), and XMP (APP1 with
  // "http://ns.adobe.com/xap/1.0/" prefix). Exposed for the test only;
  // not part of the live photo flow.
  async function inspectJpegMetadata(blobOrBuffer) {
    const buf = blobOrBuffer instanceof ArrayBuffer
      ? blobOrBuffer
      : await blobOrBuffer.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const findings = { hasEXIF: false, hasIPTC: false, hasXMP: false, gpsBytesFound: 0, totalSize: bytes.length };
    if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) {
      findings.error = "Not a JPEG (missing SOI)";
      return findings;
    }
    let p = 2;
    while (p < bytes.length - 1) {
      if (bytes[p] !== 0xFF) break;
      const marker = bytes[p + 1];
      if (marker === 0xD9 || marker === 0xDA) break; // EOI / SOS
      const segLen = (bytes[p + 2] << 8) | bytes[p + 3];
      const segStart = p + 4;
      const segEnd = p + 2 + segLen;
      if (marker === 0xE1) {
        // APP1 — could be EXIF ("Exif\0\0") or XMP ("http://ns.adobe.com/xap/1.0/\0").
        const tag = String.fromCharCode.apply(null, bytes.slice(segStart, Math.min(segStart + 30, segEnd)));
        if (tag.startsWith("Exif")) findings.hasEXIF = true;
        if (tag.indexOf("ns.adobe.com/xap") !== -1) findings.hasXMP = true;
      } else if (marker === 0xED) {
        findings.hasIPTC = true;
      }
      p = segEnd;
    }
    // Cross-check: search the entire blob for the GPS IFD signature
    // ("GPS\0" precedes GPS coords inside EXIF). Catches any bytes that
    // slipped through unparsed segments.
    const sig = [0x47, 0x50, 0x53, 0x00];
    for (let i = 0; i < bytes.length - sig.length; i++) {
      if (bytes[i] === sig[0] && bytes[i + 1] === sig[1]
          && bytes[i + 2] === sig[2] && bytes[i + 3] === sig[3]) {
        findings.gpsBytesFound++;
      }
    }
    return findings;
  }

  /**
   * Set <img> src to the photo URL once it resolves. Falls back gracefully.
   */
  function bindImg(imgEl, person, fallback) {
    const url = getUrlSync(person);
    if (url) { imgEl.src = url; return; }
    if (!person || (!person.photoId && !person.photo)) {
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
    blobToDataUrl,
    clearAll,
    migrateLegacy,
    // Diagnostic — used by tests/exif-strip.html. Not part of the live UX.
    _inspectJpegMetadata: inspectJpegMetadata
  };
})(window);
