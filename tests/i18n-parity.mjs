#!/usr/bin/env node
// Unit test for lib/core/i18n.js — EXACT key parity across every supported
// language in the translation dictionary.
//
// Guards against the most common i18n regression: a string added (or
// renamed) under one language's tree but forgotten in the other(s). i18n.js
// already falls back to EN whenever a key is missing (see get()), which is
// exactly why a hole can ship unnoticed — nothing throws, a Hindi session
// just quietly shows English for that one string. This test is the thing
// that catches that before it ships.
//
// What it checks:
//   1. Recursively flattens each language's dictionary into a set of
//      dot-paths (e.g. "rail.you", "auth.help", "help.treeHow"). Arrays are
//      treated as leaf values (e.g. landing.privacyBody is an array of
//      paragraphs) — only the key's presence has to match, not its shape.
//   2. Unions every path across every language, then reports — per
//      language — which union paths it's missing. Because the check is
//      union-based it's automatically symmetric: a key that exists only in
//      "hi" shows up as "missing from en" with no special-casing needed.
//   3. Flags structural divergence: the same path being an object (a
//      subtree) in one language but a leaf (string/array/etc.) in another —
//      a real bug class (e.g. a nested group added in en, left as a single
//      string in hi). Leaf-vs-leaf shape differences (string vs array) are
//      NOT flagged, only object-vs-leaf.
//   4. Languages are discovered dynamically from the dict's own top-level
//      keys — nothing here assumes exactly "en"/"hi" or exactly two
//      languages, so a third language added later is covered for free.
//
// --- How this test reaches the dictionary -----------------------------------
// i18n.js is a classic IIFE — `(function (global) { ... })(window)`. Its
// `dict` object (the thing with the `en:` / `hi:` keys, around lines 18 and
// 917) is a closure-local `const`; the only thing the module attaches to the
// outside world is:
//     global.I18n = { t, setLang, getLang, onChange, applyToDOM };
// (the literal last line of the file). There is no test-only hook that
// exposes the raw dict. And `t(path)` / `setLang(lang)` alone can't solve
// this: they only resolve a path you already know, which is circular for a
// parity check whose entire job is to discover the full key set first — you
// can't ask "does hi have key X" for every X without already having the
// list of every X from somewhere.
//
// So, per the same idiom every other test in this repo already uses to boot
// lib/*.js (new Function(src).call(global) over a minimal shim — see
// self-anchor.mjs / kin-terms.mjs), this test reads i18n.js's source text
// and, ONLY in the in-memory string used to boot it, patches that exact
// final export line to also stash the closure-local `dict` reference:
//     global.I18n = { t, setLang, getLang, onChange, applyToDOM, _dict: dict };
// The file on disk is never written to — only the string in memory. Node's
// own parser then builds the real `dict` object when the patched source
// runs, so this test does no hand-rolled parsing of the object literal's
// *contents* (no brace-counting, no regex over string bodies) — which would
// be fragile against the nested braces, escaped quotes, and the `//`
// comments that already live inside the literal. If the export line's exact
// text ever changes, the patch step below fails loudly with a clear message
// instead of silently reading `undefined`.
//
// Run: node tests/i18n-parity.mjs   (exits 0 on pass, non-zero on any failure)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// --- minimal shim ------------------------------------------------------------
// Mirrors self-anchor.mjs / kin-terms.mjs: i18n.js touches no real DOM at
// load, just document.documentElement.setAttribute(...) and localStorage.
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

// --- boot i18n.js from a PATCHED in-memory copy (the file on disk is never
// touched) — see the big comment above for why this is the mechanism. -------
const i18nPath = path.resolve(repoRoot, "lib/core/i18n.js");
const src = fs.readFileSync(i18nPath, "utf8");

const EXPORT_LINE = "global.I18n = { t, setLang, getLang, onChange, applyToDOM };";
const PATCHED_LINE = "global.I18n = { t, setLang, getLang, onChange, applyToDOM, _dict: dict };";
if (!src.includes(EXPORT_LINE)) {
  console.error("i18n-parity: mechanism broken — expected export line not found in lib/core/i18n.js.");
  console.error("  looked for: " + EXPORT_LINE);
  console.error("  i18n.js's export shape changed; update the patch in tests/i18n-parity.mjs to match.");
  process.exit(1);
}
new Function(src.replace(EXPORT_LINE, PATCHED_LINE)).call(global);

const dict = global.I18n && global.I18n._dict;
if (!dict || typeof dict !== "object") {
  console.error("i18n-parity: mechanism broken — global.I18n._dict was not set after boot.");
  process.exit(1);
}

const failures = [];
function check(name, cond) { if (!cond) failures.push(name); }

// --- derive supported languages dynamically — no hardcoded "en"/"hi" -------
const languages = Object.keys(dict);
check("dict has at least 2 languages", languages.length >= 2);

// --- flatten each language into path -> "object" | "leaf" -------------------
// Arrays count as leaves (per spec): landing.privacyBody is an array of
// paragraph strings; only the key's existence matters, not its element count.
function isContainer(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function flatten(node, prefix, kinds) {
  for (const key of Object.keys(node)) {
    const p = prefix ? prefix + "." + key : key;
    const val = node[key];
    if (isContainer(val)) {
      kinds.set(p, "object");
      flatten(val, p, kinds);
    } else {
      kinds.set(p, "leaf");
    }
  }
}

const kindsByLang = {};
for (const lang of languages) {
  const kinds = new Map();
  flatten(dict[lang], "", kinds);
  kindsByLang[lang] = kinds;
}

// --- union of every path seen in any language -------------------------------
const unionKeys = new Set();
for (const lang of languages) {
  for (const k of kindsByLang[lang].keys()) unionKeys.add(k);
}
const sortedUnion = [...unionKeys].sort();

// --- per-language missing keys ----------------------------------------------
// Union-based, so this is inherently symmetric: a key only in "hi" surfaces
// as "missing from en" automatically, no separate direction to check.
const missingByLang = {};
for (const lang of languages) {
  missingByLang[lang] = sortedUnion.filter((k) => !kindsByLang[lang].has(k));
  check(`${lang}: has all ${sortedUnion.length} union keys`, missingByLang[lang].length === 0);
}

// --- structural divergence: object in one language, leaf in another --------
const divergences = [];
for (const k of sortedUnion) {
  const byKind = new Map(); // kind -> [langs with that kind at this path]
  for (const lang of languages) {
    if (!kindsByLang[lang].has(k)) continue;
    const kind = kindsByLang[lang].get(k);
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(lang);
  }
  if (byKind.size > 1) {
    divergences.push(
      k + ": " + [...byKind.entries()].map(([kind, langs]) => kind + " in [" + langs.join(", ") + "]").join(" vs ")
    );
  }
}
check("no object-vs-leaf structural divergences", divergences.length === 0);

// --- report ------------------------------------------------------------------
if (failures.length) {
  console.error("i18n-parity FAILED:");
  for (const f of failures) console.error("  • " + f);
  for (const lang of languages) {
    if (missingByLang[lang].length) {
      console.error("");
      console.error(`Missing from "${lang}" (${missingByLang[lang].length}):`);
      for (const k of missingByLang[lang]) console.error("    - " + k);
    }
  }
  if (divergences.length) {
    console.error("");
    console.error(`Structural divergences — object vs leaf (${divergences.length}):`);
    for (const d of divergences) console.error("    - " + d);
  }
  process.exit(1);
}
console.log(`i18n-parity ok — ${sortedUnion.length} keys × ${languages.length} languages, all present`);
