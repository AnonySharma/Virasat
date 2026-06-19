#!/usr/bin/env node
// Boot-smoke test for the lib/ scripts.
//
// Loads every <script src="lib/..."> from index.html (in order, with a
// minimal browser shim) and asserts every expected `window.X` global got
// attached. Catches:
//   • script load-order regressions (a module references window.UI before
//     dom.js loaded)
//   • temporal dead zones (let foo = clamp(...) where clamp is now const)
//   • missing globals after a rename (file moved, namespace forgotten)
//   • missing UI helpers after a rename (UI.something dropped from export)
//
// Does NOT catch DOM-rendering bugs, IDB / fetch / canvas behaviour, or
// any code path that's gated behind user interaction. Use the running
// app + tests/exif-strip.html for those.
//
// Run: node tests/smoke.mjs
// Exits 0 on pass, non-zero on any failure.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// --- DOM shim ---------------------------------------------------------------
// Minimal enough that every module's IIFE can register its globals without
// throwing. Don't try to make the rendered output meaningful — that's not
// what this test verifies.
function makeNode(tag) {
  return {
    tagName: tag,
    style: {},
    classList: {
      add() {}, remove() {}, toggle() {}, contains() { return false; }
    },
    dataset: {},
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    appendChild(c) { (this.children = this.children || []).push(c); return c; },
    removeChild() {},
    addEventListener() {},
    focus() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    contains() { return false; }
  };
}

global.window = global;
global.window.addEventListener = () => {};
global.window.removeEventListener = () => {};
global.document = {
  documentElement: { setAttribute() {}, removeAttribute() {}, getAttribute() { return null; } },
  body: { appendChild() {}, removeChild() {}, classList: { add() {}, remove() {}, toggle() {} }, style: {} },
  addEventListener() {}, removeEventListener() {},
  getElementById() { return null; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  createElement: makeNode,
  createElementNS: (_ns, t) => makeNode(t),
  createTextNode: (s) => ({ nodeType: 3, textContent: String(s) }),
  activeElement: null
};
// Modern Node ships a real navigator; defineProperty to override the readonly.
Object.defineProperty(global, "navigator", {
  value: { storage: null, serviceWorker: null, language: "en" },
  writable: true, configurable: true
});
global.location = { protocol: "http:", hostname: "localhost", hash: "" };
global.localStorage = (() => {
  const map = {};
  return {
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); },
    removeItem: (k) => { delete map[k]; }
  };
})();
global.sessionStorage = global.localStorage;
global.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
// Ignored IDB — fail it fast so PhotoStore.ready rejects rather than hangs.
global.indexedDB = {
  open() {
    const r = { onsuccess: null, onerror: null, onupgradeneeded: null };
    setTimeout(() => r.onerror && r.onerror({ target: { error: new Error("smoke: no idb") } }), 0);
    return r;
  }
};
global.URL = { createObjectURL: () => "blob:fake", revokeObjectURL() {} };
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.FileReader = class { readAsDataURL() {} };
global.Blob = class { constructor() {} };
global.Image = class { set src(_) {} };
global.CustomEvent = class {
  constructor(t, o) { this.type = t; Object.assign(this, o || {}); }
};
// Catch the IDB rejection so it doesn't crash the runner.
process.on("unhandledRejection", () => {});

// --- Boot every script in index.html order ---------------------------------
// Mirror of <script src="..."> tags in index.html. If you add or remove a
// script there, mirror the change here.
const order = [
  "lib/core/i18n.js",
  "lib/core/data-store.js",
  "lib/core/photo-store.js",
  "lib/ui/dom.js",
  "lib/components/heritage-datepicker.js",
  "lib/components/heritage-select.js",
  "lib/components/crop-editor.js",
  "lib/components/path-finder.js",
  "lib/components/inspector.js",
  "lib/views/people-view.js",
  "lib/views/tree-view.js",
  "lib/views/timeline-view.js",
  "lib/views/profile-view.js",
  "lib/features/image-export.js",
  "lib/features/export-import.js",
  "lib/features/collect-form.js",
  "lib/features/print-book.js"
];

const failures = [];

for (const f of order) {
  const full = path.resolve(repoRoot, f);
  try {
    const src = fs.readFileSync(full, "utf8");
    new Function(src).call(global);
  } catch (e) {
    failures.push("boot " + f + ": " + (e && e.message));
  }
}

// --- Globals that every shipped module must register -----------------------
const expectedGlobals = [
  "I18n",
  "FamilyStore",
  "PhotoStore",
  "UI",
  "HeritagePicker",
  "HeritageSelect",
  "CropEditor",
  "PathFinder",
  "Inspector",
  "PeopleView",
  "TreeView",
  "TimelineView",
  "ProfileView",
  "ImageExport",
  "ExportImport",
  "CollectForm",
  "PrintBook"
];
for (const g of expectedGlobals) {
  if (typeof global[g] === "undefined") failures.push("missing global: " + g);
}

// --- UI helpers that callers depend on -------------------------------------
const expectedUiHelpers = [
  "el", "clear", "clamp", "avatar", "toast", "openModal", "confirm",
  "emptyState", "cancelBtn", "saveBtn", "field", "downloadFile", "pastelFor"
];
for (const k of expectedUiHelpers) {
  if (typeof global.UI?.[k] !== "function") failures.push("missing UI." + k);
}

// --- PhotoStore additions --------------------------------------------------
if (typeof global.PhotoStore?.blobToDataUrl !== "function") {
  failures.push("missing PhotoStore.blobToDataUrl");
}

// --- Quick exercise of pure helpers ----------------------------------------
try {
  if (global.UI.clamp(5, 0, 3) !== 3) failures.push("UI.clamp incorrect");
  if (!global.UI.emptyState({ icon: "fa", title: "t" })) failures.push("UI.emptyState returned falsy");
  if (!global.UI.cancelBtn()) failures.push("UI.cancelBtn returned falsy");
  if (!global.UI.saveBtn("S")) failures.push("UI.saveBtn returned falsy");
} catch (e) {
  failures.push("helper exercise threw: " + (e && e.message));
}

// --- Sample data shape: every person has photo (no photoUrl field) ---------
try {
  const sample = global.FamilyStore.sampleData();
  for (const p of sample.people) {
    if ("photoUrl" in p) failures.push("sample person still has photoUrl: " + p.id);
    if (!p.photo && !p.photoId) failures.push("sample person without photo: " + p.id);
  }
} catch (e) {
  failures.push("sampleData() threw: " + (e && e.message));
}

// --- Report ----------------------------------------------------------------
if (failures.length) {
  console.error("smoke FAILED:");
  for (const f of failures) console.error("  • " + f);
  process.exit(1);
}
console.log("smoke ok — " + order.length + " scripts, "
  + expectedGlobals.length + " globals, "
  + expectedUiHelpers.length + " UI helpers");
