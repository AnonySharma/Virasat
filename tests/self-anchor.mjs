#!/usr/bin/env node
// Unit test for lib/features/self-anchor.js — the per-viewer "this is me" pin.
//
// Boots data-store + self-anchor under the same minimal shim the other tests
// use. The things worth testing are the invariants that make the anchor safe:
//   1. get/set/clear/isSelf round-trip through localStorage
//   2. onChange fires with the new id (and null on clear)
//   3. per-tree scoping — tree A's "me" is invisible from tree B (this is the
//      whole reason it's keyed by the active tree id, not a single global key)
//   4. self-heal — a pinned id whose person was deleted resolves to null and
//      wipes itself, so a stale anchor never drives a label or highlight
//
// Run: node tests/self-anchor.mjs   (exits 0 on pass, non-zero on any failure)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// --- minimal shim (self-anchor touches no DOM) ------------------------------
global.window = global;
global.window.addEventListener = () => {};
global.document = {
  documentElement: { setAttribute() {}, removeAttribute() {}, getAttribute() { return null; } },
  addEventListener() {},
  querySelector() { return null; },
  querySelectorAll() { return []; }
};
global.localStorage = (() => {
  const map = {};
  return { getItem: (k) => (k in map ? map[k] : null), setItem: (k, v) => { map[k] = String(v); }, removeItem: (k) => { delete map[k]; } };
})();

const boot = ["lib/core/i18n.js", "lib/core/data-store.js", "lib/features/self-anchor.js"];
for (const f of boot) {
  new Function(fs.readFileSync(path.resolve(repoRoot, f), "utf8")).call(global);
}

const { FamilyStore, SelfAnchor } = global;
const failures = [];
function check(name, cond) { if (!cond) failures.push(name); }

// Two people to pin.
FamilyStore.replaceAll({ people: [
  { id: "me", name: "Me", gender: "m", parents: [], spouses: [] },
  { id: "other", name: "Other", gender: "f", parents: [], spouses: [] }
] });

// ---- round-trip on the local-only (no active tree) key ----
check("get() null initially", SelfAnchor.get() === null);
check("isSelf false initially", SelfAnchor.isSelf("me") === false);

let heard = "unset";
const off = SelfAnchor.onChange((id) => { heard = id; });
SelfAnchor.set("me");
check("get() after set", SelfAnchor.get() === "me");
check("isSelf(me) true", SelfAnchor.isSelf("me") === true);
check("isSelf(other) false", SelfAnchor.isSelf("other") === false);
check("onChange heard the set", heard === "me");

SelfAnchor.clear();
check("get() null after clear", SelfAnchor.get() === null);
check("onChange heard the clear (null)", heard === null);
off();
SelfAnchor.set("other");
check("onChange unsubscribed", heard === null); // listener removed → still null
SelfAnchor.clear();

// ---- per-tree scoping: each tree keeps its own "me" ----
// The anchor is keyed by FamilyStore.getActiveTreeId(); switching trees must
// switch which anchor is visible, so one viewer's "me" on tree A can't bleed
// into tree B (and, in the real app, can't collide with another viewer).
FamilyStore.setActiveTree("treeA");
FamilyStore.replaceAll({ people: [{ id: "a1", name: "A-one", parents: [], spouses: [] }] });
SelfAnchor.set("a1");
check("treeA self = a1", SelfAnchor.get() === "a1");

FamilyStore.setActiveTree("treeB");
FamilyStore.replaceAll({ people: [{ id: "b1", name: "B-one", parents: [], spouses: [] }] });
check("treeB has no self yet", SelfAnchor.get() === null);
SelfAnchor.set("b1");
check("treeB self = b1", SelfAnchor.get() === "b1");

FamilyStore.setActiveTree("treeA");
FamilyStore.replaceAll({ people: [{ id: "a1", name: "A-one", parents: [], spouses: [] }] });
check("treeA self still a1 (isolated from B)", SelfAnchor.get() === "a1");

// ---- self-heal: pinned person deleted → get() returns null + wipes it ----
FamilyStore.setActiveTree("treeC");
FamilyStore.replaceAll({ people: [{ id: "gone", name: "Gone", parents: [], spouses: [] }] });
SelfAnchor.set("gone");
check("treeC self = gone", SelfAnchor.get() === "gone");
FamilyStore.deletePerson("gone");
// The heal must be SILENT: get() is called from inside consumers' render (the
// inspector's selfChip), so a notify here would re-enter that render mid-build
// and duplicate its output. Assert onChange does NOT fire on a heal.
let healFired = false;
const offHeal = SelfAnchor.onChange(() => { healFired = true; });
check("deleted self heals to null", SelfAnchor.get() === null);
check("heal did NOT fire onChange (no re-entrant render)", healFired === false);
offHeal();
// and the heal actually cleared storage (not just the in-memory read)
FamilyStore.replaceAll({ people: [{ id: "gone", name: "Reborn", parents: [], spouses: [] }] });
check("healed anchor did not resurrect", SelfAnchor.get() === null);

// --- report ---
if (failures.length) {
  console.error("self-anchor FAILED:");
  for (const f of failures) console.error("  • " + f);
  process.exit(1);
}
console.log("self-anchor ok — pin round-trips, per-tree isolation + self-heal hold");
