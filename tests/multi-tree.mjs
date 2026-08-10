#!/usr/bin/env node
// Behavioural test for cloud-store's multi-tree API + role gating.
//
// Runs the REAL cloud-store.js + data-store.js against a MOCK Supabase client
// backing an in-memory `trees` table + `tree_members` table, and asserts:
//   • start() honours a saved virasat.activeTreeId when still accessible
//   • listTrees() returns every visible tree tagged with role + active marker
//   • createTree() inserts + switches to the new tree, arming its own push
//   • switchTree() flushes the outgoing tree, repoints, and re-hydrates
//   • a viewer-role tree flips FamilyStore into read-only (mutators no-op)
//   • an editor/owner tree clears read-only
//   • deleteTree() of the active tree moves to another before deleting
//
// Run: node tests/multi-tree.mjs

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
global.window.addEventListener = () => {};
// body.classList so applyRole()'s is-viewer toggle has somewhere to land.
const bodyClasses = new Set();
global.document = {
  addEventListener() {},
  body: { classList: {
    toggle: (c, on) => { if (on) bodyClasses.add(c); else bodyClasses.delete(c); },
    contains: (c) => bodyClasses.has(c)
  } }
};
global.dispatchEvent = () => true;
global.CustomEvent = class { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } };

const failures = [];
function assert(cond, msg) { if (!cond) failures.push(msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Mock Supabase over in-memory trees + tree_members ----------------------
// A minimal but faithful PostgREST-builder mock. RLS is simulated by the
// caller only ever seeing rows for the fixed user id below.
const USER = "user-1";

const trees = [
  { id: "t-own", owner_id: USER, title: "My tree", family_name: "Mine", version: 2,
    data: { version: 2, people: [{ id: "p1", name: "Me", parents: [], spouses: [] }], marriages: {}, meta: { familyName: "Mine" } },
    updated_at: "2024-01-01" },
  { id: "t-editor", owner_id: "other-1", title: "Shared editable", family_name: "Friend", version: 5,
    data: { version: 2, people: [{ id: "p2", name: "Friend", parents: [], spouses: [] }], marriages: {}, meta: { familyName: "Friend" } },
    updated_at: "2024-02-01" },
  { id: "t-viewer", owner_id: "other-2", title: "Shared read-only", family_name: "Cousin", version: 8,
    data: { version: 2, people: [{ id: "p3", name: "Cousin", parents: [], spouses: [] }], marriages: {}, meta: { familyName: "Cousin" } },
    updated_at: "2024-03-01" }
];
const members = [
  { tree_id: "t-own", user_id: USER, role: "owner" },
  { tree_id: "t-editor", user_id: USER, role: "editor" },
  { tree_id: "t-viewer", user_id: USER, role: "viewer" }
];

function applyEqs(rows, eqs) {
  return rows.filter((r) => Object.keys(eqs).every((k) => r[k] === eqs[k]));
}

function makeClient() {
  return {
    from(table) {
      const data = table === "trees" ? trees : table === "tree_members" ? members : [];
      const q = { _table: table, _eqs: {}, _op: null, _patch: null };
      q.select = () => q;
      q.eq = (c, v) => { q._eqs[c] = v; return q; };
      q.order = () => q;
      q.insert = (patch) => { q._op = "insert"; q._patch = patch; return q; };
      q.update = (patch) => { q._op = "update"; q._patch = patch; return q; };
      q.delete = () => { q._op = "delete"; return q; };
      // limit() terminates a select chain → array result.
      q.limit = () => Promise.resolve({ data: applyEqs(data, q._eqs), error: null });
      // A bare select+eq (no limit/single) is awaited directly in listTrees for
      // members and in loadRole via single(); support thenable for the members
      // list query (select("tree_id, role").eq("user_id", USER)).
      q.then = (resolve) => resolve({ data: applyEqs(data, q._eqs), error: null });
      q.single = () => {
        if (q._op === "insert") {
          const row = Object.assign({ id: "t-new", version: 1, updated_at: "2024-04-01" }, q._patch);
          trees.push(row);
          members.push({ tree_id: row.id, user_id: USER, role: "owner" });
          return Promise.resolve({ data: { id: row.id }, error: null });
        }
        if (q._op === "update") {
          const hits = applyEqs(data, q._eqs);
          if (q._table === "trees" && q._eqs.version !== undefined) {
            // version-guarded push
            const row = trees.find((r) => r.id === q._eqs.id);
            if (row && row.version === q._eqs.version) {
              Object.assign(row, q._patch);
              return Promise.resolve({ data: { version: row.version }, error: null });
            }
            return Promise.resolve({ data: null, error: { code: "PGRST116", message: "0 rows" } });
          }
          hits.forEach((r) => Object.assign(r, q._patch));
          return Promise.resolve({ data: hits[0] || null, error: hits.length ? null : { code: "PGRST116" } });
        }
        const hit = applyEqs(data, q._eqs)[0];
        if (q._table === "tree_members") {
          return Promise.resolve({ data: hit ? { role: hit.role } : null, error: hit ? null : { code: "PGRST116" } });
        }
        // trees select single → data + version
        return Promise.resolve({ data: hit ? { data: hit.data, version: hit.version } : null, error: hit ? null : { code: "PGRST116" } });
      };
      q.delete().then; // no-op to keep shape; real delete handled below
      // delete() returns a thenable resolving after removal.
      const origDelete = q.delete;
      q.delete = () => {
        q._op = "delete";
        return {
          eq: (c, v) => {
            q._eqs[c] = v;
            return Promise.resolve().then(() => {
              if (q._table === "trees") {
                const i = trees.findIndex((r) => r.id === q._eqs.id);
                if (i >= 0) trees.splice(i, 1);
              }
              return { data: null, error: null };
            });
          }
        };
      };
      return q;
    }
  };
}

let cloudOn = true;
const client = makeClient();
global.Auth = {
  isCloud: () => cloudOn,
  client: () => client,
  getUser: () => ({ id: USER, email: "u@example.com" })
};

// --- Boot data-store + cloud-store ------------------------------------------
function load(file) { new Function(fs.readFileSync(path.resolve(repoRoot, file), "utf8")).call(global); }
load("lib/core/data-store.js");
load("lib/auth/cloud-store.js");
const FS = global.FamilyStore;
const CS = global.CloudStore;

for (const m of ["listTrees", "createTree", "switchTree", "renameTree", "deleteTree", "getRole", "canEdit", "isOwner"]) {
  assert(typeof CS[m] === "function", "CloudStore." + m + " missing");
}

await (async function run() {
  // --- start() with no saved id → oldest owned tree (t-own) ----------------
  await CS.start();
  assert(CS.activeTreeId() === "t-own", "start() should open the owned tree, got " + CS.activeTreeId());
  assert(CS.getRole() === "owner", "role on owned tree should be owner, got " + CS.getRole());
  assert(FS.isReadOnly() === false, "owner tree must not be read-only");
  assert(bodyClasses.has("is-viewer") === false, "owner tree must not set body.is-viewer");
  assert(lsMap["virasat.activeTreeId"] === "t-own", "start() should persist the active tree id");

  // --- listTrees() → all three, tagged with role + active ------------------
  const list = await CS.listTrees();
  assert(list.length === 3, "listTrees should return 3 trees, got " + list.length);
  const byId = Object.fromEntries(list.map((t) => [t.id, t]));
  assert(byId["t-own"].active === true, "t-own should be marked active");
  assert(byId["t-own"].owned === true && byId["t-own"].role === "owner", "t-own role/owned wrong");
  assert(byId["t-editor"].role === "editor" && byId["t-editor"].owned === false, "t-editor role/owned wrong");
  assert(byId["t-viewer"].role === "viewer", "t-viewer role wrong");

  // --- switchTree() to the viewer tree → read-only ON ----------------------
  await CS.switchTree("t-viewer");
  assert(CS.activeTreeId() === "t-viewer", "switchTree should repoint to t-viewer");
  assert(CS.getRole() === "viewer", "role should be viewer after switch, got " + CS.getRole());
  assert(FS.isReadOnly() === true, "viewer tree MUST be read-only");
  assert(bodyClasses.has("is-viewer") === true, "viewer tree should set body.is-viewer");
  assert(FS.getPeople().length === 1 && FS.getPeople()[0].name === "Cousin",
    "viewer tree data should hydrate, got " + JSON.stringify(FS.getPeople().map((p) => p.name)));
  // A mutation on a viewer tree must be a no-op.
  const before = FS.getPeople().length;
  FS.addPerson({ name: "Sneaky" });
  assert(FS.getPeople().length === before, "viewer read-only guard must block addPerson");

  // --- switchTree() to the editor tree → read-only OFF ---------------------
  await CS.switchTree("t-editor");
  assert(FS.isReadOnly() === false, "editor tree must clear read-only");
  assert(bodyClasses.has("is-viewer") === false, "editor tree must clear body.is-viewer");
  FS.addPerson({ name: "Editor Add" });
  assert(FS.getPeople().some((p) => p.name === "Editor Add"), "editor may add people");
  await CS.flush();
  const editorRow = trees.find((t) => t.id === "t-editor");
  assert(editorRow.data.people.some((p) => p.name === "Editor Add"), "editor edit should push to the row");

  // --- createTree() → inserts, switches, owner role ------------------------
  const newId = await CS.createTree("Fresh Tree", "Fresh");
  assert(CS.activeTreeId() === newId, "createTree should switch to the new tree");
  assert(CS.getRole() === "owner", "creator is owner of the new tree");
  assert(FS.isReadOnly() === false, "new owned tree must be editable");
  assert(trees.some((t) => t.id === newId), "new tree row should exist");

  // --- deleteTree() of the ACTIVE tree → moves away first, then deletes -----
  await CS.deleteTree(newId);
  assert(!trees.some((t) => t.id === newId), "deleted tree row should be gone");
  assert(CS.activeTreeId() !== newId, "after deleting the active tree we must be on another");
  assert(CS.isActive() === true, "still active on a surviving tree after delete");

  // --- saved-id restore: stop() clears it ----------------------------------
  CS.stop();
  assert(lsMap["virasat.activeTreeId"] == null, "stop() should clear the saved active tree id");
  assert(FS.isReadOnly() === false, "stop() should clear read-only");
})();

// --- Report ------------------------------------------------------------------
if (failures.length) {
  console.error("multi-tree FAILED:");
  for (const f of failures) console.error("  • " + f);
  process.exit(1);
}
console.log("multi-tree ok — list/create/switch/delete + role read-only gating hold");
