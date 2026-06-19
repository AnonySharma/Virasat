#!/usr/bin/env node
// Inline assets/sample/*.jpg as base64 inside lib/core/data-store.js's
// sampleData(). Replaces every line of the form
//
//   photoUrl: "assets/sample/p12.jpg",
//
// with
//
//   photo: "data:image/jpeg;base64,/9j/4AAQ...",
//
// Why: photoUrl is a "fetch this from disk" reference. It only resolves
// when the bundled asset is reachable (local dev / production host /
// PWA cache hit). Backups produced via the Save backup flow are
// supposed to be portable to any device — a photoUrl field is a path,
// not data. Inlining as base64 makes the sample data fully self-
// contained, lets us drop the photoUrl schema field entirely, and
// gives us one consistent rendering path (PhotoStore.getUrl reads from
// IDB after migrateLegacy runs).
//
// Idempotent: running this twice on an already-inlined data-store.js
// is a no-op (the regex won't match the inlined `photo: "data:..."`
// lines). Verified at the end of the script by re-grepping.
//
// Run: node tests/inline-sample-photos.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataStorePath = path.join(repoRoot, "lib/core/data-store.js");
const sampleDir = path.join(repoRoot, "assets/sample");

const src = fs.readFileSync(dataStorePath, "utf8");

// Match: any indentation, then `photoUrl: "assets/sample/<file>.jpg",`
// We capture leading whitespace so we can preserve the surrounding
// indentation when we rewrite.
const re = /^([ \t]*)photoUrl:\s*"assets\/sample\/([^"]+)",?\s*$/gm;

let totalReplaced = 0;
let totalBytesOut = 0;

const out = src.replace(re, (full, indent, file) => {
  const jpegPath = path.join(sampleDir, file);
  if (!fs.existsSync(jpegPath)) {
    console.warn("  skip (missing): " + file);
    return full;
  }
  const buf = fs.readFileSync(jpegPath);
  const b64 = buf.toString("base64");
  const dataUrl = "data:image/jpeg;base64," + b64;
  totalReplaced++;
  totalBytesOut += dataUrl.length;
  console.log("  inlined " + file.padEnd(10) + " — " + buf.length + " B → " + dataUrl.length + " ch base64");
  // Trailing comma preserved — every inlined line sits inside an object
  // literal where the next line is also a property.
  return indent + "photo: \"" + dataUrl + "\",";
});

if (totalReplaced === 0) {
  // Re-grep to verify there's nothing to do (rather than a regex regression).
  const stillHas = /photoUrl:\s*"assets\/sample/.test(src);
  if (stillHas) {
    console.error("FAIL: regex didn't match but the file still has photoUrl entries.");
    process.exit(1);
  }
  console.log("Nothing to inline — file is already in the inlined shape.");
  process.exit(0);
}

fs.writeFileSync(dataStorePath, out);

console.log("");
console.log("Replaced " + totalReplaced + " photoUrl entries.");
console.log("Total inlined data: " + (totalBytesOut / 1024).toFixed(1) + " KB of base64.");
console.log("data-store.js: " + (Buffer.byteLength(src, "utf8") / 1024).toFixed(1) + " KB → "
  + (Buffer.byteLength(out, "utf8") / 1024).toFixed(1) + " KB");
