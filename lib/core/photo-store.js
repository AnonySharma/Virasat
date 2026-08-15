// @ts-check
/**
 * PhotoStore — manages photos out of localStorage so we don't blow the 5MB cap.
 *
 * Two local field-level sources on a person, resolved in order:
 *   1. person.photoId   → IndexedDB blob. Resolved to an Object URL on demand.
 *   2. person.photo     → base64 data URL (auto-migrated to IDB on load).
 *
 * The legacy `photoUrl` (committed-asset path) was removed 2026-06-19;
 * sample data is now inlined as base64 via tests/inline-sample-photos.mjs.
 *
 * CLOUD: when cloud sync is live (Auth.isCloud() && an active tree),
 * a photo has a THIRD home — a private Supabase Storage object at
 * "<treeId>/<photoId>.jpg". IDB is the fast, offline-first local cache; the
 * bucket is the durable, cross-device copy. fileToPhotoId uploads after the
 * IDB put; getUrl falls back to a Storage download when a blob is missing
 * locally (a fresh device that has the tree's JSON but not its photos yet),
 * repopulating IDB so the next read is instant and offline.
 *
 * IDB keys stay FLAT (the bare photoId), NOT compound "<treeId>|<photoId>":
 * newPhotoId() mints globally-unique ids so cross-tree collision is
 * impossible, flat keys let a switch-back to an already-visited tree repaint
 * from cache offline, and importing a local tree keeps photoIds verbatim. The
 * treeId lives only in the Storage object path, resolved fresh per call.
 * person.photoId in the JSONB blob therefore stays bare + portable.
 *
 * Public API:
 *   PhotoStore.ready()                 — Promise resolved once IDB is open and migration done.
 *   PhotoStore.put(blob) -> Promise<id>
 *   PhotoStore.get(id)   -> Promise<Blob|null>
 *   PhotoStore.getUrl(person) -> Promise<string|null>  // resolves to a URL usable in <img src=...>
 *   PhotoStore.getUrlSync(person) -> string|null       // sync best-effort (cached)
 *   PhotoStore.delete(id)              — Promise
 *   PhotoStore.resetCache()            — revoke + drop cached object URLs (tree switch)
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
      // Write a blob at a known id (rather than minting one) on the existing
      // IDB connection — opening a second one risks a schema-upgrade race. Used
      // by the cloud-download path to repopulate the cache under the photo's
      // original id.
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
    // back. The inner result must be captured separately from `t.oncomplete`:
    // resolving purely on completion would hand back `null` for sync results
    // before the inner promise settled.
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
      // Gallery items imported from a backup arrive as base64 on `photo`, same
      // as the primary once did. Convert each to an IDB blob so multi-KB
      // strings don't linger in the tree JSON forever. Rebuild the whole array
      // in one updatePerson so a partial failure can't half-write it.
      if (Array.isArray(p.gallery) && p.gallery.some((g) => g && g.photo && !g.photoId)) {
        try {
          const next = [];
          for (const g of p.gallery) {
            if (g && g.photo && !g.photoId) {
              const blob = dataUrlToBlob(g.photo);
              if (blob) { const id = await put(blob); next.push({ ...g, photo: null, photoId: id }); migrated++; continue; }
            }
            next.push(g);
          }
          FamilyStore.updatePerson(p.id, { gallery: next });
        } catch (e) {
          console.warn("Gallery migration failed for", p.id, e);
        }
      }
      // Document scans — same base64→IDB migration as the gallery. The blob is
      // already the encoded scan (no re-downscale on migration; put() stores it
      // verbatim), so a restored document keeps whatever resolution it shipped at.
      if (Array.isArray(p.documents) && p.documents.some((d) => d && d.photo && !d.photoId)) {
        try {
          const next = [];
          for (const d of p.documents) {
            if (d && d.photo && !d.photoId) {
              const blob = dataUrlToBlob(d.photo);
              if (blob) { const id = await put(blob); next.push({ ...d, photo: null, photoId: id }); migrated++; continue; }
            }
            next.push(d);
          }
          FamilyStore.updatePerson(p.id, { documents: next });
        } catch (e) {
          console.warn("Document migration failed for", p.id, e);
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
  // Write a blob under a known id (no minting). Used by the cloud
  // download-fallback to repopulate the local cache with the SAME id the
  // JSONB blob references, so a subsequent getUrlSync hits.
  function putWithKey(id, blob) { return open().then((db) => db.putWithKey(id, blob)); }
  function getBlob(id) { return open().then((db) => db.get(id)); }
  // Local-only blob removal: drops the IDB entry + any cached object URL, and
  // does NOT touch the bucket. purgeLocalTree needs exactly this — it reclaims a
  // DEPARTED tree's local cache, whose bucket objects live under that tree's own
  // path (not the now-active tree's, which is all cloudCtx()/removePhoto could
  // resolve), and in the leave-a-shared-tree case aren't the user's to delete at
  // all. Coupling a remote delete in here would fire a wrong-path/unauthorized
  // bucket remove. Bucket cleanup for a deleted tree is a separate, deferred
  // concern (owner-only, before the row delete) — never local reclaim's job.
  function deleteLocalBlob(id) {
    if (urlCache.has(id)) {
      try { URL.revokeObjectURL(urlCache.get(id)); } catch (e) {}
      urlCache.delete(id);
    }
    return open().then((db) => db.delete(id));
  }

  function delBlob(id) {
    // Best-effort remote delete alongside the local one. Callers are the
    // person-delete path and the edit-close reconcilers that clean up
    // superseded / speculatively-uploaded blobs — in every case the blob is
    // genuinely orphaned FROM THE ACTIVE TREE, so removing the bucket object
    // (which lives under the active tree's path) stops it leaking. Fire-and-
    // forget: a viewer's RLS rejection or a network blip is swallowed
    // (removePhoto never throws), and a re-surfaced photo (LWW delete/edit
    // race) degrades to initials via getUrl→null, not a broken img.
    removePhoto(id);
    return deleteLocalBlob(id);
  }

  // — Cloud Storage adapter ————————————————————————————————
  //
  // All three helpers are inert in local-only mode: cloudCtx() returns null
  // when Auth isn't live or no cloud tree is active, and every caller treats
  // null as "skip the network". So an offline PWA behaves byte-identically to
  // before — no client, no bucket, no uploads, no downloads.

  // Resolve the live cloud context, or null. Bundles the Storage bucket API
  // and the active tree id so a photo's object path is "<treeId>/<photoId>.jpg".
  function cloudCtx() {
    try {
      const auth = global.Auth;
      if (!auth || !auth.isCloud || !auth.isCloud()) return null;
      const c = auth.client && auth.client();
      if (!c || !c.storage) return null;
      const cfg = global.VirasatConfig;
      const bucketName = (cfg && cfg.bucket) || "tree-photos";
      const treeId = global.FamilyStore
        && typeof FamilyStore.getActiveTreeId === "function"
        && FamilyStore.getActiveTreeId();
      if (!treeId) return null;
      return { bucket: c.storage.from(bucketName), treeId: treeId };
    } catch (_) {
      return null;
    }
  }

  function objectPath(treeId, photoId) { return treeId + "/" + photoId + ".jpg"; }

  // Best-effort upload of a freshly-stored blob to the private bucket. Never
  // throws into the caller — a failed upload leaves the photo in IDB (visible
  // on THIS device) and the next successful push/edit won't resurrect it, but
  // the tree JSON still references it, so a later manual re-save recovers. We
  // log and move on rather than blocking the Save UX on a network round-trip.
  function uploadPhoto(photoId, blob) {
    const ctx = cloudCtx();
    if (!ctx || !photoId || !blob) return Promise.resolve(false);
    return Promise.resolve(
      ctx.bucket.upload(objectPath(ctx.treeId, photoId), blob, {
        contentType: "image/jpeg",
        upsert: true   // idempotent: re-uploading the same id overwrites cleanly
      })
    ).then((res) => {
      if (res && res.error) { console.warn("Photo upload failed:", res.error.message || res.error); return false; }
      return true;
    }).catch((e) => { console.warn("Photo upload threw:", e); return false; });
  }

  // Download a photo's bytes from the bucket (RLS-checked via the caller's
  // JWT). Returns a Blob or null. Used only as a fallback when IDB misses.
  async function downloadPhoto(photoId) {
    const ctx = cloudCtx();
    if (!ctx || !photoId) return null;
    try {
      const res = await ctx.bucket.download(objectPath(ctx.treeId, photoId));
      if (res && res.error) { console.warn("Photo download failed:", res.error.message || res.error); return null; }
      const blob = res && res.data;
      return (blob && blob.size >= 0) ? blob : null;
    } catch (e) {
      console.warn("Photo download threw:", e);
      return null;
    }
  }

  // Best-effort remote delete. Fire-and-forget from delBlob; RLS rejects it
  // for viewers (harmless — the local blob is already gone either way).
  function removePhoto(photoId) {
    const ctx = cloudCtx();
    if (!ctx || !photoId) return Promise.resolve();
    return Promise.resolve(ctx.bucket.remove([objectPath(ctx.treeId, photoId)]))
      .then((res) => { if (res && res.error) console.warn("Photo remote delete failed:", res.error.message || res.error); })
      .catch((e) => { console.warn("Photo remote delete threw:", e); });
  }

  // Push every locally-held photo the current tree references up to the bucket.
  //
  // Only `fileToPhotoId` uploads on the hot path, so a tree that arrives by
  // import / device-restore / sample — where photos land in IDB via
  // replaceAll (same-device blobs) or migrateLegacy (inlined base64) — has its
  // blobs on THIS device but nothing in the cloud. A second device would then
  // getUrl → IDB miss → download → 404 → initials forever. This walks the
  // active tree's people + marriage photoIds, reads each blob from IDB, and
  // uploads any that resolve so the photos follow the tree across devices.
  //
  // Best-effort and inert off-cloud: cloudCtx() null → immediate no-op, and a
  // per-photo failure is swallowed (uploadPhoto never throws). Idempotent via
  // upsert, so re-running on an already-synced tree just overwrites cleanly.
  // Run AFTER migrateLegacy resolves so freshly-minted photoIds are included.
  async function backfillToCloud() {
    const ctx = cloudCtx();
    if (!ctx || !global.FamilyStore) return { uploaded: 0, missing: 0, skipped: true };
    const ids = new Set();
    try {
      const people = (typeof FamilyStore.getPeople === "function") ? FamilyStore.getPeople() : [];
      for (const p of people) {
        if (p && p.photoId) ids.add(p.photoId);
        if (p && Array.isArray(p.gallery)) p.gallery.forEach((g) => { if (g && g.photoId) ids.add(g.photoId); });
        if (p && Array.isArray(p.documents)) p.documents.forEach((d) => { if (d && d.photoId) ids.add(d.photoId); });
      }
      const state = (typeof FamilyStore.getState === "function") ? FamilyStore.getState() : null;
      const marriages = state && state.marriages;
      if (marriages) {
        for (const key of Object.keys(marriages)) {
          const m = marriages[key];
          if (m && m.photoId) ids.add(m.photoId);
        }
      }
    } catch (e) { console.warn("Backfill: couldn't gather photoIds:", e); }

    let uploaded = 0, missing = 0;
    for (const id of ids) {
      let blob = null;
      try { blob = await getBlob(id); } catch (_) {}
      if (!blob) { missing++; continue; }       // referenced but not on this device — nothing to push
      if (await uploadPhoto(id, blob)) uploaded++;
    }
    if (uploaded) console.log("PhotoStore: backfilled", uploaded, "photos to cloud.");
    return { uploaded, missing, skipped: false };
  }

  async function getUrl(person) {
    if (!person) return null;
    if (person.photoId) {
      if (urlCache.has(person.photoId)) return urlCache.get(person.photoId);
      let blob = await getBlob(person.photoId);
      // Cold remote tree: the JSON references a photo whose blob isn't in this
      // device's IDB yet. Pull it from the bucket, then cache it locally so
      // every later read (and getUrlSync) is instant and works offline.
      if (!blob) {
        blob = await downloadPhoto(person.photoId);
        if (blob) { try { await putWithKey(person.photoId, blob); } catch (e) { console.warn("Cache write after download failed:", e); } }
      }
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
  // export-import.
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(blob);
    });
  }

  // A document scan reuses the entire fileToPhotoId pipeline — same IDB store,
  // same EXIF-strip via canvas re-encode, same cloud upload as "<id>.jpg" — but
  // at a larger maxDim and higher quality so a certificate's or letter's text
  // stays readable when zoomed. Kept here (not in the view) so the single
  // upload/strip/store path can't drift between photos and documents.
  function fileToDocumentId(file) {
    return fileToPhotoId(file, 1600, 0.9);
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
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    const id = await put(blob);
    // Upload in the background — the caller (Save UX) must not wait on a
    // network round-trip. If cloud is off this is a synchronous no-op. If the
    // upload fails the photo still lives in IDB and the tree JSON references
    // it; a later re-save retries. The blob is already EXIF-stripped by the
    // canvas re-encode above, so nothing sensitive leaves the device.
    uploadPhoto(id, blob);
    return id;
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
   * Drop the in-memory object-URL cache WITHOUT touching IDB. Called on a
   * cloud tree switch (and sign-out): a cached objectURL is keyed by bare
   * photoId, and although ids are globally unique, revoking on switch frees
   * the blobs the old tree's <img>s held and guarantees the next getUrl
   * re-resolves against the now-active tree's context. IDB blobs are left in
   * place on purpose — switching back to a visited tree then repaints from
   * cache, offline, with no re-download. (Full wipe is clearAll().)
   */
  function resetCache() {
    urlCache.forEach((u) => { try { URL.revokeObjectURL(u); } catch (_) {} });
    urlCache.clear();
  }

  /**
   * Wipe every photo blob and every cached object URL. Used by the global
   * "Reset everything" flow.
   */
  function clearAll() {
    // Revoke any cached object URLs first
    urlCache.forEach((u) => { try { URL.revokeObjectURL(u); } catch (_) {} });
    urlCache.clear();
    return open().then(/** @returns {Promise<void>|undefined} */ (db) => {
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
    put, get: getBlob, delete: delBlob, deleteLocal: deleteLocalBlob,
    getUrl, getUrlSync, fileToPhotoId, fileToDocumentId,
    blobToDataUrl,
    resetCache,
    clearAll,
    migrateLegacy,
    // Cloud Storage adapter. Exposed for cloud-store wiring + tests;
    // no-ops when cloud is off. Not called directly by the view layer.
    uploadPhoto, downloadPhoto, removePhoto, backfillToCloud,
    // Diagnostic — used by tests/exif-strip.html. Not part of the live UX.
    _inspectJpegMetadata: inspectJpegMetadata
  };
})(window);
