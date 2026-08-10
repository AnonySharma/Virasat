#!/usr/bin/env node
// Behavioural test for the photo-store.js cloud adapter (Phase 3, task #25).
//
// Runs the REAL photo-store.js against a MOCK Supabase Storage bucket and
// asserts the cloud seam without touching a real network or a real IDB:
//   • cloud OFF ⇒ upload/download/remove are no-ops, local put/get unchanged
//   • cloud ON but no active tree ⇒ still a no-op (cloudCtx null)
//   • cloud ON + active tree ⇒ upload targets "<treeId>/<photoId>.jpg" (upsert, jpeg)
//   • getUrl on an IDB miss ⇒ downloads from the bucket, repopulates IDB,
//     caches the object URL (a cold remote device paints, then works offline)
//   • a repeat getUrl serves the cache (no re-download)
//   • miss in BOTH IDB and bucket ⇒ null (initials, never a broken <img>)
//   • resetCache revokes + clears the sync cache (tree switch)
//   • removePhoto / delete fire a best-effort remote delete
//
// photo-store's built-in in-memory IDB fallback (used when global.indexedDB is
// undefined) stands in for IndexedDB, so no IDB shim is needed. fileToPhotoId's
// canvas→JPEG pipeline is NOT exercised here (it needs a real canvas/Image);
// its upload is the same uploadPhoto() call, tested directly below.
//
// Run: node tests/photo-cloud.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// --- Browser shim ------------------------------------------------------------
global.window = global;
// Deliberately leave global.indexedDB UNDEFINED → photo-store falls back to its
// in-memory Map (put/putWithKey/get/delete/all), a faithful IDB stand-in.
let urlCounter = 0;
const revoked = [];
global.URL = {
  createObjectURL: () => "blob:mock/" + (++urlCounter),
  revokeObjectURL: (u) => revoked.push(u)
};

const failures = [];
function assert(cond, msg) { if (!cond) failures.push(msg); }
const mkBlob = (s) => new Blob([s], { type: "image/jpeg" });

// --- Mock cloud: Auth + a single in-memory Storage bucket -------------------
let cloudOn = false;
let activeTree = null;
const bucketStore = {};   // object path -> Blob
const uploads = [];
const removes = [];
const bucket = {
  upload: (p, blob, opts) => {
    bucketStore[p] = blob; uploads.push({ path: p, opts: opts });
    return Promise.resolve({ data: { path: p }, error: null });
  },
  download: (p) => Promise.resolve(
    bucketStore[p] ? { data: bucketStore[p], error: null }
                   : { data: null, error: { message: "Object not found" } }
  ),
  remove: (paths) => {
    paths.forEach((p) => { delete bucketStore[p]; });
    removes.push(paths);
    return Promise.resolve({ data: {}, error: null });
  }
};
global.Auth = {
  isCloud: () => cloudOn,
  client: () => ({ storage: { from: () => bucket } })
};
global.VirasatConfig = { bucket: "tree-photos" };
// Minimal FamilyStore stub — photo-store needs getActiveTreeId (cloudCtx) and,
// for the load-time migrateLegacy no-op, getPeople()/getState().
global.FamilyStore = {
  getActiveTreeId: () => activeTree,
  getPeople: () => [],
  getState: () => ({ marriages: {} })
};

// --- Load photo-store --------------------------------------------------------
function load(file) { new Function(fs.readFileSync(path.resolve(repoRoot, file), "utf8")).call(global); }
load("lib/core/photo-store.js");
const PS = global.PhotoStore;
assert(typeof PS === "object", "PhotoStore missing");
for (const m of ["uploadPhoto", "downloadPhoto", "removePhoto", "resetCache", "getUrl"]) {
  assert(typeof PS[m] === "function", "PhotoStore." + m + " missing");
}

await (async function run() {
  await PS.ready();

  // === Cloud OFF: byte-identical local-only, zero network ===================
  cloudOn = false; activeTree = null;
  assert((await PS.uploadPhoto("ph_off", mkBlob("x"))) === false, "uploadPhoto is a no-op when cloud is off");
  assert((await PS.downloadPhoto("ph_off")) === null, "downloadPhoto returns null when cloud is off");
  assert(uploads.length === 0, "no upload may hit the bucket when cloud is off");

  // Local put/get is unchanged with cloud off.
  const localId = await PS.put(mkBlob("local"));
  assert(typeof localId === "string" && localId, "put returns an id locally");
  const gotLocal = await PS.get(localId);
  assert(gotLocal && gotLocal.size > 0, "get returns the stored blob locally");
  assert((await PS.getUrl({ photoId: "does-not-exist" })) === null, "getUrl null on miss when cloud off (no download)");

  // === Cloud ON but no active tree → still a no-op (cloudCtx null) ===========
  cloudOn = true; activeTree = null;
  assert((await PS.uploadPhoto("ph_noTree", mkBlob("x"))) === false, "uploadPhoto no-op when cloud on but no active tree");
  assert(uploads.length === 0, "no active tree ⇒ no bucket write");

  // === Cloud ON + active tree: upload targets <treeId>/<photoId>.jpg ========
  cloudOn = true; activeTree = "tree-1";
  const okUp = await PS.uploadPhoto("ph_1", mkBlob("one"));
  assert(okUp === true, "uploadPhoto resolves true on success");
  assert(uploads.length === 1 && uploads[0].path === "tree-1/ph_1.jpg",
    "upload path must be <treeId>/<photoId>.jpg, got " + (uploads[0] && uploads[0].path));
  assert(uploads[0].opts && uploads[0].opts.upsert === true, "upload should be idempotent (upsert:true)");
  assert(uploads[0].opts.contentType === "image/jpeg", "upload should set image/jpeg content type");

  // === Download-fallback: a cold device that has the JSON, not the blob =====
  // Simulate another device having already uploaded ph_remote to the bucket.
  bucketStore["tree-1/ph_remote.jpg"] = mkBlob("remote-bytes");
  const url = await PS.getUrl({ photoId: "ph_remote" });   // IDB miss → download
  assert(typeof url === "string" && url.startsWith("blob:"),
    "getUrl returns an object URL after download-fallback, got " + url);
  const repop = await PS.get("ph_remote");
  assert(repop && repop.size > 0, "download-fallback must repopulate IDB for offline reuse");
  assert(PS.getUrlSync({ photoId: "ph_remote" }) === url, "getUrlSync should hit the warm cache after getUrl");

  // A repeat getUrl serves the cache — no second download.
  const url2 = await PS.getUrl({ photoId: "ph_remote" });
  assert(url2 === url, "repeat getUrl serves the cached URL");

  // === Missing in BOTH IDB and bucket → null (initials, not a broken img) ===
  assert((await PS.getUrl({ photoId: "ph_ghost" })) === null, "getUrl null when neither IDB nor bucket has it");

  // === resetCache revokes + clears (tree switch) ============================
  const revokedBefore = revoked.length;
  PS.resetCache();
  assert(revoked.length > revokedBefore, "resetCache should revoke cached object URLs");
  assert(PS.getUrlSync({ photoId: "ph_remote" }) === null, "resetCache should clear the sync cache");

  // === removePhoto / delete fire a best-effort remote delete ================
  await PS.removePhoto("ph_1");
  assert(removes.length === 1 && removes[0][0] === "tree-1/ph_1.jpg", "removePhoto targets <treeId>/<photoId>.jpg");
  assert(!("tree-1/ph_1.jpg" in bucketStore), "removePhoto should delete the bucket object");

  const rlen = removes.length;
  await PS.delete("ph_remote");
  assert(removes.length === rlen + 1, "delete() should also fire a remote delete when cloud is active");
})();

// --- Report ------------------------------------------------------------------
if (failures.length) {
  console.error("photo-cloud FAILED:");
  for (const f of failures) console.error("  • " + f);
  process.exit(1);
}
console.log("photo-cloud ok — upload path, download-fallback repopulate, cache reset, and remote delete hold");
