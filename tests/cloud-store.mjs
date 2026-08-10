#!/usr/bin/env node
// Behavioural test for cloud-store.js (Phase 2, task #22) — the WRITE side.
//
// Runs the REAL cloud-store.js + data-store.js against a MOCK Supabase client
// backing a single in-memory `trees` row, and asserts:
//   • start() is a no-op when Auth.isCloud() is false (local-only untouched)
//   • start() resolves the tree, hydrates FamilyStore, sets the base version
//   • an edit → debounced → version-guarded UPDATE that advances the version
//   • a clean push bumps the server row version AND FamilyStore.getVersion()
//   • a stale base (row advanced underneath us) → 0-row UPDATE → conflict:
//       fires virasat:cross-tab-conflict AND re-hydrates the server copy
//   • stop() detaches the dirty hook (no further pushes)
//
// Run: node tests/cloud-store.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// --- Browser shim ------------------------------------------------------------
const lsMap = {};
global.localStorage = {
  getItem: (k) => (k in lsMap ? lsMap[k] : null),
  setItem: (k, v) => { lsMap[k] = String(v); },
  removeItem: (k) => { delete lsMap[k]; }
};
global.window = global;
const events = [];
global.window.addEventListener = () => {};
global.document = { addEventListener() {} };
global.dispatchEvent = (e) => { events.push(e.type); return true; };
global.CustomEvent = class { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } };

const failures = [];
function assert(cond, msg) { if (!cond) failures.push(msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Mock Supabase client over one in-memory trees row ----------------------
// Mirrors just the PostgREST builder chain cloud-store uses:
//   from(t).select(...).eq(...).order(...).limit(...)          → { data:[], error }
//   from(t).select(...).eq(...).single()                       → { data, error }
//   from(t).insert(row).select(...).single()                   → { data, error }
//   from(t).update(patch).eq(id).eq(version).select().single() → { data|null, error }
// The .eq("version", base) filter is the optimistic lock: an UPDATE whose base
// doesn't equal the row's current version matches 0 rows (PGRST116).
function makeDb(row) {
  return {
    from(table) {
      const q = { _op: null, _patch: null, _eqs: {}, _row: row, _table: table };
      q.select = () => q;
      q.order = () => q;
      q.limit = () => Promise.resolve({ data: q._row ? [{ id: q._row.id }] : [], error: null });
      q.eq = (col, val) => { q._eqs[col] = val; return q; };
      q.insert = (patch) => { q._op = "insert"; q._patch = patch; return q; };
      q.update = (patch) => { q._op = "update"; q._patch = patch; return q; };
      q.single = () => {
        // tree_members: cloud-store.loadRole() reads the caller's role. The
        // owner (on_tree_created trigger) always has an 'owner' row.
        if (q._table === "tree_members") {
          return Promise.resolve({ data: { role: "owner" }, error: null });
        }
        if (q._op === "insert") {
          Object.assign(q._row, q._patch, { id: q._row.id, version: 1 });
          return Promise.resolve({ data: { id: q._row.id }, error: null });
        }
        if (q._op === "update") {
          // Optimistic lock: only apply if the base version matches.
          if (q._eqs.version === q._row.version) {
            Object.assign(q._row, q._patch);   // patch carries version = base+1
            return Promise.resolve({ data: { version: q._row.version }, error: null });
          }
          // 0 rows → PostgREST .single() returns PGRST116.
          return Promise.resolve({ data: null, error: { code: "PGRST116", message: "0 rows" } });
        }
        // plain select().single()
        return Promise.resolve({ data: { data: q._row.data, version: q._row.version }, error: null });
      };
      return q;
    }
  };
}

// The server row. Starts at version 3 with one ancestor.
const serverRow = {
  id: "tree-uuid-1",
  owner_id: "user-1",
  version: 3,
  data: { version: 2, people: [{ id: "a1", name: "Server Ancestor", parents: [], spouses: [] }], marriages: {}, meta: { familyName: "Server" } }
};

let cloudOn = true;
let mockClient = makeDb(serverRow);
global.Auth = {
  isCloud: () => cloudOn,
  client: () => mockClient,
  getUser: () => ({ id: "user-1", email: "u@example.com" })
};

// --- Boot data-store + cloud-store ------------------------------------------
function load(file) { new Function(fs.readFileSync(path.resolve(repoRoot, file), "utf8")).call(global); }
load("lib/core/data-store.js");
load("lib/auth/cloud-store.js");
const FS = global.FamilyStore;
const CS = global.CloudStore;
assert(typeof CS === "object", "CloudStore missing");
for (const m of ["start", "stop", "flush", "isActive"]) {
  assert(typeof CS[m] === "function", "CloudStore." + m + " missing");
}

await (async function run() {
  // --- start() is a no-op when cloud is off --------------------------------
  cloudOn = false;
  await CS.start();
  assert(CS.isActive() === false, "start() must be a no-op when Auth.isCloud() is false");
  assert(FS.getActiveTreeId() === null, "local-only: no active tree after a no-op start()");

  // --- start() with cloud on: resolve + hydrate ----------------------------
  cloudOn = true;
  await CS.start();
  assert(CS.isActive() === true, "start() should mark active when cloud is on");
  assert(CS.activeTreeId() === "tree-uuid-1", "start() should resolve the owned tree id");
  assert(FS.getActiveTreeId() === "tree-uuid-1", "FamilyStore should be pointed at the tree");
  assert(FS.getVersion() === 3, "hydrate should set base version to the server's (3), got " + FS.getVersion());
  const loaded = FS.getPeople();
  assert(loaded.length === 1 && loaded[0].name === "Server Ancestor",
    "hydrate should install the server's people, got " + JSON.stringify(loaded.map((p) => p.name)));

  // --- an edit → debounced → clean version-guarded push --------------------
  FS.addPerson({ name: "Locally Added" });
  await CS.flush();   // force the pending push now instead of waiting the debounce
  assert(serverRow.version === 4, "a clean push should bump the server version 3→4, got " + serverRow.version);
  assert(FS.getVersion() === 4, "a clean push should advance our base version to 4, got " + FS.getVersion());
  assert(serverRow.data.people.length === 2, "the push should persist the 2-person tree, got " + serverRow.data.people.length);

  // --- conflict: server advances underneath us → 0-row UPDATE → reconcile --
  // Simulate another device: bump the row + change its data behind our back.
  serverRow.version = 9;
  serverRow.data = { version: 2, people: [
    { id: "a1", name: "Server Ancestor", parents: [], spouses: [] },
    { id: "b2", name: "Other Device Person", parents: [], spouses: [] }
  ], marriages: {}, meta: { familyName: "Server" } };
  events.length = 0;

  FS.addPerson({ name: "Doomed Local Edit" });   // our base is 4, server is 9
  await CS.flush();

  assert(events.includes("virasat:cross-tab-conflict"),
    "a stale push should fire virasat:cross-tab-conflict, got " + JSON.stringify(events));
  assert(FS.getVersion() === 9, "after conflict we should adopt the server version (9), got " + FS.getVersion());
  const afterConflict = FS.getPeople().map((p) => p.name);
  assert(afterConflict.includes("Other Device Person") && !afterConflict.includes("Doomed Local Edit"),
    "after conflict we should hold the server copy (last-writer-wins), got " + JSON.stringify(afterConflict));
  // The server row must NOT have been clobbered by our stale push.
  assert(serverRow.version === 9, "a stale push must not advance the server row, got " + serverRow.version);
  assert(serverRow.data.people.length === 2, "a stale push must not overwrite the server data");

  // --- stop() detaches the dirty hook and halts all pushes -----------------
  // Realistic order is flush()-then-stop() on sign-out; after stop() the store
  // is torn down (treeId cleared), so neither a later edit nor an explicit
  // flush() may touch the server. "stop means stop."
  CS.stop();
  assert(CS.isActive() === false, "stop() should mark inactive");
  const versionBefore = serverRow.version;
  FS.addPerson({ name: "After Stop" });   // dirty hook detached → schedules nothing
  await sleep(30);
  await CS.flush();                        // guarded no-op (treeId cleared)
  assert(serverRow.version === versionBefore,
    "after stop() no push may reach the server, got " + serverRow.version + " (was " + versionBefore + ")");
})();

// --- Report ------------------------------------------------------------------
if (failures.length) {
  console.error("cloud-store FAILED:");
  for (const f of failures) console.error("  • " + f);
  process.exit(1);
}
console.log("cloud-store ok — resolve/hydrate, version-guarded push, and conflict reconcile hold");
