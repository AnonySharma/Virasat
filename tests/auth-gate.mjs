#!/usr/bin/env node
// Behavioural test for the cloud boot-gate.
//
// Proves the property that lets the app run before Supabase is configured:
//   • empty/half-filled config  → isConfigured() false
//   • cloud off                 → Auth.ready() resolves { cloud:false }
//   • cloud off                 → the Supabase SDK is NEVER fetched
//                                 (no <script> appended to <head>)
//   • both fields filled        → isConfigured() true
//
// Boots the REAL config.js + auth-store.js source under a DOM shim that
// records any <script> injection. Run: node tests/auth-gate.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const injectedScripts = [];
function makeNode(tag) {
  const node = {
    tagName: tag, style: {}, dataset: {},
    setAttribute() {}, getAttribute() { return null; },
    appendChild(c) { return c; }, addEventListener() {}
  };
  return node;
}

global.window = global;
global.window.addEventListener = () => {};
global.document = {
  documentElement: { setAttribute() {} },
  head: {
    appendChild(node) {
      injectedScripts.push(node);
      // Simulate a load failure so any accidental load attempt still
      // resolves rather than hanging the test.
      setTimeout(() => node.onerror && node.onerror(), 0);
      return node;
    }
  },
  body: { appendChild() {} },
  createElement: makeNode,
  addEventListener() {}
};
global.location = { origin: "https://example.github.io", pathname: "/Virasat/", hash: "" };
// navigator is a read-only getter in modern Node — defineProperty to override.
Object.defineProperty(global, "navigator", {
  value: { language: "en" }, writable: true, configurable: true
});

const failures = [];
function assert(cond, msg) { if (!cond) failures.push(msg); }

function load(file) {
  const src = fs.readFileSync(path.resolve(repoRoot, file), "utf8");
  new Function(src).call(global);
}

// --- Boot config + auth-store (as index.html orders them) ------------------
load("lib/auth/config.js");
load("lib/auth/auth-store.js");

assert(typeof global.VirasatConfig === "object", "VirasatConfig missing");
assert(typeof global.Auth === "object", "Auth missing");

// --- Committed-secret safety: the anon key is public-safe BY DESIGN (RLS is
// the boundary), so a committed key is fine — but it must NEVER be the
// service_role key, which bypasses RLS. Decode the JWT and reject that. -----
const shippedKey = global.VirasatConfig.supabaseAnonKey;
if (shippedKey && shippedKey.split(".").length === 3) {
  try {
    const payload = JSON.parse(Buffer.from(shippedKey.split(".")[1], "base64url").toString("utf8"));
    assert(payload.role !== "service_role",
      "DANGER: config.js holds a service_role key — that bypasses RLS and must never be committed. Replace with the anon key.");
    assert(payload.role === "anon",
      "config.js key role is '" + payload.role + "', expected 'anon'");
  } catch (e) {
    if (!/service_role|expected 'anon'/.test(e.message)) failures.push("could not decode committed key JWT: " + e.message);
  }
}

// --- isConfigured() gating logic, with controlled values -------------------
global.VirasatConfig.supabaseUrl = "https://demo.supabase.co";
global.VirasatConfig.supabaseAnonKey = "";
assert(global.VirasatConfig.isConfigured() === false, "URL-only config should be OFF");

global.VirasatConfig.supabaseUrl = "";
global.VirasatConfig.supabaseAnonKey = "eyJhbGci.fake.key";
assert(global.VirasatConfig.isConfigured() === false, "key-only config should be OFF");

// --- Cloud OFF: ready() resolves {cloud:false}, SDK never loaded -----------
global.VirasatConfig.supabaseUrl = "";
global.VirasatConfig.supabaseAnonKey = "";
const res = await global.Auth.ready();
assert(res && res.cloud === false, "Auth.ready() with empty config should be {cloud:false}, got " + JSON.stringify(res));
assert(res.session === null, "cloud-off session should be null");
assert(global.Auth.isCloud() === false, "Auth.isCloud() should be false when off");
assert(injectedScripts.length === 0,
  "SDK was fetched while cloud is OFF (" + injectedScripts.length + " script(s) injected) — cloud-off must be zero-network");

// --- both fields filled → ON (idempotent ready() stays cached at OFF) ------
global.VirasatConfig.supabaseUrl = "https://demo.supabase.co";
global.VirasatConfig.supabaseAnonKey = "eyJhbGci.fake.key";
assert(global.VirasatConfig.isConfigured() === true, "fully-filled config should be ON");
// ready() is memoised — a second call must NOT re-evaluate and must NOT load
// the SDK (the gate was already decided at first boot).
const res2 = await global.Auth.ready();
assert(res2.cloud === false, "ready() must stay memoised at its first result");
assert(injectedScripts.length === 0, "memoised ready() must not trigger an SDK load");

if (failures.length) {
  console.error("auth-gate FAILED:");
  for (const f of failures) console.error("  • " + f);
  process.exit(1);
}
console.log("auth-gate ok — cloud-off boots local-only, zero SDK fetch, isConfigured() gates correctly");
