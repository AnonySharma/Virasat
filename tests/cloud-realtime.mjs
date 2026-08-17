#!/usr/bin/env node
// Behavioural test for cloud-store's realtime + offline replay.
//
// Runs the REAL cloud-store.js + data-store.js against a MOCK Supabase client
// whose realtime channel, 60s poll interval, and window "online" event are all
// capturable, so the test can fire them on demand instead of waiting on wall
// clock. Asserts:
//   • start() subscribes a channel to the active row + arms the poll heartbeat
//   • a remote UPDATE with a HIGHER version + a clean store → re-hydrates
//   • a remote UPDATE that's an echo (version <= ours) → ignored
//   • a remote UPDATE while we have unpushed local edits → ignored (our own
//     push will hit the version guard and reconcile via the conflict path)
//   • an edit stranded by an offline push replays on the next poll tick
//   • an edit stranded offline replays immediately on the "online" event
//   • with realtime blocked, the poll detects a server that moved ahead
//   • switchTree() removes the old channel and subscribes the new row
//   • stop() removes the channel, halts the poll, and drops the online listener
//
// Run: node tests/cloud-realtime.mjs

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

// Capture "online" listeners so we can fire the reconnect event by hand.
const onlineListeners = [];
global.addEventListener = (type, fn) => { if (type === "online") onlineListeners.push(fn); };
global.removeEventListener = (type, fn) => {
  if (type === "online") { const i = onlineListeners.indexOf(fn); if (i >= 0) onlineListeners.splice(i, 1); }
};
function fireOnline() { onlineListeners.slice().forEach((f) => f()); }

// body.classList so applyRole()'s is-viewer toggle has somewhere to land.
const bodyClasses = new Set();
global.document = {
  addEventListener() {},
  body: { classList: {
    toggle: (c, on) => { if (on) bodyClasses.add(c); else bodyClasses.delete(c); },
    contains: (c) => bodyClasses.has(c)
  } }
};
const events = [];
global.dispatchEvent = (e) => { events.push(e.type); return true; };
global.CustomEvent = class { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } };

// Capture the poll interval instead of running a real 60s timer.
let pollCb = null;
let pollHandle = null;
let pollCleared = 0;
global.setInterval = (cb) => { pollCb = cb; pollHandle = { unref() { return this; } }; return pollHandle; };
global.clearInterval = (h) => { pollCleared++; if (h === pollHandle) { pollCb = null; pollHandle = null; } };

const failures = [];
function assert(cond, msg) { if (!cond) failures.push(msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Fire one poll tick and let its async body settle.
async function tick() { if (pollCb) pollCb(); await sleep(15); }
const names = (arr) => arr.map((p) => p.name);

// --- Mock Supabase over in-memory trees + tree_members ----------------------
const USER = "user-1";
const trees = [
  { id: "t-1", owner_id: USER, title: "Primary", family_name: "One", version: 3,
    data: { version: 2, people: [{ id: "root", name: "Root", parents: [], spouses: [] }], marriages: {}, meta: { familyName: "One" } } },
  { id: "t-2", owner_id: USER, title: "Second", family_name: "Two", version: 20,
    data: { version: 2, people: [{ id: "t2root", name: "T2 Root", parents: [], spouses: [] }], marriages: {}, meta: { familyName: "Two" } } }
];
const members = [
  { tree_id: "t-1", user_id: USER, role: "owner" },
  { tree_id: "t-2", user_id: USER, role: "owner" }
];
function applyEqs(rows, eqs) { return rows.filter((r) => Object.keys(eqs).every((k) => r[k] === eqs[k])); }

// Realtime capture: the channel callback + name of the live subscription.
let channelCb = null;
let channelName = null;
let removed = 0;

const db = { offline: false };
function makeClient() {
  return {
    channel(name) {
      channelName = name;
      const ch = {
        on(_event, _opts, cb) { channelCb = cb; return ch; },
        subscribe() { return ch; },
        unsubscribe() { return ch; }
      };
      return ch;
    },
    removeChannel() { removed++; channelCb = null; return Promise.resolve({ error: null }); },
    from(table) {
      const rows = table === "trees" ? trees : table === "tree_members" ? members : [];
      const q = { _table: table, _eqs: {}, _op: null, _patch: null };
      q.select = () => q;
      q.eq = (c, v) => { q._eqs[c] = v; return q; };
      q.order = () => q;
      q.update = (patch) => { q._op = "update"; q._patch = patch; return q; };
      q.limit = () => (db.offline
        ? Promise.reject(new Error("network"))
        : Promise.resolve({ data: applyEqs(rows, q._eqs), error: null }));
      q.then = (resolve) => resolve({ data: applyEqs(rows, q._eqs), error: null });
      q.single = () => {
        if (db.offline) return Promise.reject(new Error("network"));
        if (q._table === "tree_members") {
          const hit = applyEqs(members, q._eqs)[0];
          return Promise.resolve({ data: hit ? { role: hit.role } : null, error: hit ? null : { code: "PGRST116" } });
        }
        if (q._op === "update") {
          const row = trees.find((r) => r.id === q._eqs.id);
          if (row && q._eqs.version !== undefined && row.version === q._eqs.version) {
            Object.assign(row, q._patch);   // patch carries data + version = base+1
            return Promise.resolve({ data: { version: row.version }, error: null });
          }
          return Promise.resolve({ data: null, error: { code: "PGRST116", message: "0 rows" } });
        }
        const row = trees.find((r) => r.id === q._eqs.id);
        return Promise.resolve({ data: row ? { data: row.data, version: row.version } : null, error: row ? null : { code: "PGRST116" } });
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

function load(file) { new Function(fs.readFileSync(path.resolve(repoRoot, file), "utf8")).call(global); }
load("lib/core/data-store.js");
load("lib/auth/cloud-store.js");
const FS = global.FamilyStore;
const CS = global.CloudStore;

// Set a person on the active tree's data + advance its version, as another
// device would have. Used to stage remote-change / poll-ahead scenarios.
function serverAdvance(id, version, people) {
  const row = trees.find((r) => r.id === id);
  row.version = version;
  row.data = { version: 2, people: people.map((n) => ({ id: n, name: n, parents: [], spouses: [] })), marriages: {}, meta: row.data.meta };
}
function fireRemote(version) { if (channelCb) channelCb({ new: { version } }); }

await (async function run() {
  // --- start() subscribes + arms the poll ----------------------------------
  await CS.start();
  assert(CS.activeTreeId() === "t-1", "start() should open t-1, got " + CS.activeTreeId());
  assert(FS.getVersion() === 3, "hydrate should set base version 3, got " + FS.getVersion());
  assert(channelName === "virasat:tree:t-1", "start() should subscribe the active row, got " + channelName);
  assert(typeof channelCb === "function", "the channel should register an UPDATE handler");
  assert(pollCb !== null, "start() should arm the 60s poll heartbeat");

  // --- remote UPDATE, higher version, clean store → re-hydrate -------------
  serverAdvance("t-1", 5, ["Root", "Remote A"]);
  fireRemote(5);
  await sleep(15);
  assert(FS.getVersion() === 5, "a newer remote change should re-hydrate to v5, got " + FS.getVersion());
  assert(names(FS.getPeople()).includes("Remote A"), "remote change should install the other device's people, got " + JSON.stringify(names(FS.getPeople())));

  // --- remote echo (version <= ours) → ignored -----------------------------
  fireRemote(5);           // equal
  fireRemote(2);           // stale
  await sleep(15);
  assert(FS.getVersion() === 5 && FS.getPeople().length === 2, "an echo/stale remote change must be ignored");

  // --- remote UPDATE while we hold unpushed edits → ignored (push races) ----
  FS.addPerson({ name: "Local X" });      // pendingPush = true, base = 5
  serverAdvance("t-1", 8, ["Root", "Remote A", "Remote B"]);
  fireRemote(8);
  await sleep(15);
  assert(names(FS.getPeople()).includes("Local X"), "a remote change must NOT clobber unpushed local edits");
  assert(!names(FS.getPeople()).includes("Remote B"), "realtime should defer to the push/version-guard while dirty");

  // Now our push runs → 0 rows (base 5 vs server 8) → conflict reconcile.
  events.length = 0;
  await CS.flush();
  assert(events.includes("virasat:cross-tab-conflict"), "a stale push should fire the conflict event, got " + JSON.stringify(events));
  assert(FS.getVersion() === 8, "after conflict we adopt the server version 8, got " + FS.getVersion());
  assert(names(FS.getPeople()).includes("Remote B") && !names(FS.getPeople()).includes("Local X"),
    "after conflict we hold the server copy, got " + JSON.stringify(names(FS.getPeople())));

  // --- offline edit stranded → replays on the next poll tick ---------------
  FS.addPerson({ name: "Offline Edit" });  // base = 8
  db.offline = true;
  await CS.flush();                         // push rejects → stranded (pendingPush stays true)
  assert(trees[0].version === 8, "an offline push must not advance the server row, got " + trees[0].version);
  db.offline = false;
  await tick();                             // poll replays the stranded edit
  assert(trees[0].version === 9, "the poll should replay the stranded edit → v9, got " + trees[0].version);
  assert(trees[0].data.people.some((p) => p.name === "Offline Edit"), "the replayed edit should reach the row");
  assert(FS.getVersion() === 9, "our base should advance to 9 after replay, got " + FS.getVersion());

  // --- offline edit stranded → replays on the "online" event ---------------
  FS.addPerson({ name: "Offline Edit 2" }); // base = 9
  db.offline = true;
  await CS.flush();                          // stranded
  assert(trees[0].version === 9, "still v9 while offline, got " + trees[0].version);
  db.offline = false;
  fireOnline();
  await sleep(15);
  assert(trees[0].version === 10, "the online event should replay the stranded edit → v10, got " + trees[0].version);
  assert(trees[0].data.people.some((p) => p.name === "Offline Edit 2"), "the online-replayed edit should reach the row");

  // --- realtime blocked: the poll detects a server that moved ahead --------
  serverAdvance("t-1", 12, ["Root", "Poll Adopted"]);   // no fireRemote — as if the WS is blocked
  await tick();
  assert(FS.getVersion() === 12, "the poll should detect the ahead server → v12, got " + FS.getVersion());
  assert(names(FS.getPeople()).includes("Poll Adopted"), "the poll should hydrate the ahead server copy");

  // --- switchTree() removes the old channel and subscribes the new ---------
  const removedBefore = removed;
  await CS.switchTree("t-2");
  assert(removed > removedBefore, "switchTree should remove the old channel");
  assert(channelName === "virasat:tree:t-2", "switchTree should subscribe the new row, got " + channelName);
  assert(CS.activeTreeId() === "t-2", "switchTree should repoint to t-2");
  assert(names(FS.getPeople()).length === 1 && names(FS.getPeople())[0] === "T2 Root",
    "t-2 data should hydrate, got " + JSON.stringify(names(FS.getPeople())));

  // --- stop() tears down channel + poll + online listener ------------------
  const removedBeforeStop = removed;
  const clearedBefore = pollCleared;
  CS.stop();
  assert(removed > removedBeforeStop, "stop() should remove the live channel");
  assert(pollCleared > clearedBefore, "stop() should clear the poll interval");
  assert(pollCb === null, "stop() should drop the poll callback");
  assert(onlineListeners.length === 0, "stop() should remove the online listener");
  // A late remote event after stop must be inert.
  channelCb = null;
  fireRemote(999);
  await sleep(5);
  assert(FS.isReadOnly() === false, "stop() returns to editable local-only mode");
})();

// --- Report ------------------------------------------------------------------
if (failures.length) {
  console.error("cloud-realtime FAILED:");
  for (const f of failures) console.error("  • " + f);
  process.exit(1);
}
console.log("cloud-realtime ok — subscribe/hydrate, dirty-guard, poll + online replay, switch re-subscribe, stop teardown");
