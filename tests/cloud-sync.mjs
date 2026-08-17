#!/usr/bin/env node
// Behavioural test for the data-store cloud-sync seam.
//
// Locks in the invariants that make cloud sync safe AND keep the local-only
// app byte-identical to before:
//   • default (no active tree)  → writes go to "familyTree.v1" (legacy key)
//   • no dirty hook installed   → mutations never throw (markDirty is a no-op)
//   • onDirty(fn)               → fn fires on every mutation, even under mute
//   • setActiveTree(id)         → flushes go to "familyTree.<id>.v1"
//   • setActiveTree loads that key's cached snapshot for an instant paint
//   • hydrateFromRemote(data,v) → installs data, sets getVersion(v), writes
//                                 the active cache key, notifies listeners,
//                                 and does NOT markDirty (no push→echo loop)
//   • hydrateFromRemote(bad)    → throws, leaving state untouched
//
// Boots the REAL lib/core/data-store.js under a localStorage shim.
// Run: node tests/cloud-sync.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// --- Minimal browser shim (localStorage is what data-store actually uses) ---
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
global.window = global;
global.window.addEventListener = () => {};
global.document = { addEventListener() {} };
global.CustomEvent = class { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } };

const failures = [];
function assert(cond, msg) { if (!cond) failures.push(msg); }

// --- Boot data-store.js ------------------------------------------------------
const src = fs.readFileSync(path.resolve(repoRoot, "lib/core/data-store.js"), "utf8");
new Function(src).call(global);
const FS = global.FamilyStore;
assert(typeof FS === "object", "FamilyStore missing");

// --- API surface: the four new cloud methods are exported --------------------
for (const m of ["hydrateFromRemote", "setActiveTree", "getActiveTreeId", "getVersion", "onDirty"]) {
  assert(typeof FS[m] === "function", "FamilyStore." + m + " not exported");
}

// --- Default state: local-only, no active tree, version 0 --------------------
assert(FS.getActiveTreeId() === null, "activeTreeId should default to null");
assert(FS.getVersion() === 0, "version should default to 0");

// --- markDirty is a no-op with no hook: a mutation must not throw ------------
try {
  FS.addPerson({ name: "Local Only" });
  FS.flushPersist();
} catch (e) {
  failures.push("mutation with no dirty hook threw: " + e.message);
}
// ...and it wrote to the LEGACY key, not a per-tree key.
assert(store["familyTree.v1"] != null, "local-only write should land on familyTree.v1");
assert(JSON.parse(store["familyTree.v1"]).people.length === 1, "familyTree.v1 should hold the 1 added person");

// --- onDirty(fn) fires on mutation, even under mute --------------------------
let dirtyCount = 0;
const off = FS.onDirty(() => { dirtyCount++; });
FS.addPerson({ name: "Dirty One" });
assert(dirtyCount === 1, "dirty hook should fire once per mutation, got " + dirtyCount);
FS.setMute(true);
FS.addPerson({ name: "Muted But Dirty" });
FS.setMute(false);
assert(dirtyCount === 2, "dirty hook must fire even while muted (data changed), got " + dirtyCount);
off();
FS.addPerson({ name: "After Off" });
assert(dirtyCount === 2, "dirty hook must stop firing after unsubscribe, got " + dirtyCount);

// Local-only mode has now accumulated 4 people in memory (still debounced).
const localCount = FS.getPeople().length;
assert(localCount === 4, "expected 4 local-only people, got " + localCount);

// --- setActiveTree repoints the cache key ------------------------------------
// Switching flushes the OUTGOING (local-only) edits to the legacy key first,
// so none are lost — then repoints to the new tree's key.
FS.setActiveTree("T1");
assert(FS.getActiveTreeId() === "T1", "activeTreeId should be T1");
assert(FS.getVersion() === 0, "switching tree resets version to 0 (unknown until hydrate)");
assert(JSON.parse(store["familyTree.v1"]).people.length === localCount,
  "switching away should flush the outgoing local-only edits to familyTree.v1");
FS.addPerson({ name: "Tree One Person" });
FS.flushPersist();
assert(store["familyTree.T1.v1"] != null, "active-tree write should land on familyTree.T1.v1");
// The legacy blob must be untouched by a cloud-tree edit.
assert(JSON.parse(store["familyTree.v1"]).people.length === localCount,
  "editing tree T1 must not touch the legacy familyTree.v1 blob");

// --- setActiveTree loads the target key's cached snapshot --------------------
// Pre-seed a cache for T2, switch to it, and confirm it's loaded instantly.
store["familyTree.T2.v1"] = JSON.stringify({
  version: 2, people: [{ id: "x1", name: "Cached Ancestor", parents: [], spouses: [] }],
  marriages: {}, meta: { familyName: "Cached" }
});
FS.setActiveTree("T2");
assert(FS.getActiveTreeId() === "T2", "activeTreeId should be T2");
const t2 = FS.getPeople();
assert(t2.length === 1 && t2[0].name === "Cached Ancestor",
  "setActiveTree should load the target key's cached snapshot, got " + JSON.stringify(t2.map((p) => p.name)));

// --- hydrateFromRemote: installs data, sets version, no dirty, notifies ------
let dirtyDuringHydrate = 0;
let notified = 0;
const offDirty = FS.onDirty(() => { dirtyDuringHydrate++; });
const unsub = FS.subscribe(() => { notified++; });
const remote = {
  version: 2,
  people: [
    { id: "r1", name: "Remote Root", parents: [], spouses: ["r2"] },
    { id: "r2", name: "Remote Spouse", parents: [], spouses: ["r1"] }
  ],
  marriages: { "r2|r1": { date: "1990" } },  // unsorted key — must be re-keyed to r1|r2
  meta: { familyName: "Remote" }
};
FS.hydrateFromRemote(remote, 7);
assert(FS.getVersion() === 7, "hydrate should set version to 7, got " + FS.getVersion());
assert(FS.getPeople().length === 2, "hydrate should install 2 people, got " + FS.getPeople().length);
assert(dirtyDuringHydrate === 0, "hydrate MUST NOT markDirty (would echo-loop back to a push)");
assert(notified >= 1, "hydrate should notify listeners at least once, got " + notified);
// Marriage key was normalised (sorted).
assert(FS.getMarriage("r1", "r2") && FS.getMarriage("r1", "r2").date === "1990",
  "hydrate should re-key marriages so getMarriage(a,b) works regardless of order");
// The active cache (T2) was written synchronously by hydrate (no debounce).
const cachedAfterHydrate = JSON.parse(store["familyTree.T2.v1"]);
assert(cachedAfterHydrate.people.length === 2,
  "hydrate should write the active cache key synchronously, got " + cachedAfterHydrate.people.length);
offDirty();
unsub();

// --- hydrateFromRemote(bad) throws, leaving state intact ---------------------
let threw = false;
try { FS.hydrateFromRemote({ notPeople: true }, 9); } catch (e) { threw = true; }
assert(threw, "hydrateFromRemote should throw on a blob missing the people array");
assert(FS.getVersion() === 7, "a failed hydrate must not bump the version");
assert(FS.getPeople().length === 2, "a failed hydrate must leave the previous state installed");

// --- Back to local-only: setActiveTree(null) restores the legacy key ---------
FS.setActiveTree(null);
assert(FS.getActiveTreeId() === null, "setActiveTree(null) should restore local-only mode");
const backLocal = FS.getPeople();
assert(backLocal.length === localCount && backLocal[0].name === "Local Only",
  "returning to local-only should reload the legacy familyTree.v1 blob, got "
    + JSON.stringify(backLocal.map((p) => p.name)));

// --- Report ------------------------------------------------------------------
if (failures.length) {
  console.error("cloud-sync FAILED:");
  for (const f of failures) console.error("  • " + f);
  process.exit(1);
}
console.log("cloud-sync ok — per-tree cache, dirty-hook, and hydrateFromRemote invariants hold");
