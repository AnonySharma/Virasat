#!/usr/bin/env node
// SCRATCH harness for the Focus-mode folded-kin bucketing (bucketizeFolded).
// Same style as scratch-focus-layout.mjs: the real fn is a closure inside the
// tree-view IIFE, so this transcribes its PURE graph logic verbatim and asserts
// the one invariant the focus view rests on:
//
//   COMPLETENESS — every folded person lands in exactly one cluster. The union
//   of all buckets' members === the folded set, ALWAYS. Nothing is silently
//   dropped: not a person in a disconnected component (a not-yet-linked
//   relative), not one many hops from the ego. This is the D3 promise, and the
//   bug this harness guards against was exactly a folded person vanishing when
//   their nearest kept anchor was unreachable (disconnected, or past a hop cap).
//
// Also checks: (2) buckets partition (no person in two buckets), (3) every
// anchor is a kept person, (4) a disconnected person is anchored to the ego.
//
// Run: node tests/scratch-focus-clusters.mjs

// ---- the graph, transcribed from tree-view.js bucketizeFolded (pure parts) ----
// focusNeighbors: undirected kin adjacency (parents + spouses + children;
// petOwners omitted — the fixtures below use no pets, and the arithmetic is the
// same). buildGenerations() is faked by an explicit `gen` map per fixture.
function makeGraph(defs) {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const childrenOf = (id) => defs.filter((d) => (d.parents || []).includes(id)).map((d) => d.id);
  const neighbors = (id) => {
    const p = byId.get(id);
    if (!p) return [];
    const out = [];
    (p.parents || []).forEach((x) => out.push(x));
    (p.spouses || []).forEach((x) => out.push(x));
    childrenOf(id).forEach((c) => out.push(c));
    return out;
  };
  return { byId, neighbors };
}

// bucketizeFolded, transcribed: multi-source BFS from all kept people, folded
// person tagged by the wave that reached them first; unreachable → ego.
function bucketizeFolded(keep, foldedIds, egoId, gen, neighbors) {
  const buckets = new Map();
  if (!keep || !foldedIds || !foldedIds.length) return buckets;
  const anchorOf = new Map();
  const foldedSet = new Set(foldedIds);
  const seen = new Set();
  let frontier = [];
  keep.forEach((id) => { seen.add(id); frontier.push({ id: id, anchor: id }); });
  while (frontier.length) {
    const next = [];
    for (const cur of frontier) {
      for (const nid of neighbors(cur.id)) {
        if (seen.has(nid)) continue;
        seen.add(nid);
        if (foldedSet.has(nid)) anchorOf.set(nid, cur.anchor);
        next.push({ id: nid, anchor: cur.anchor });
      }
    }
    frontier = next;
  }
  foldedIds.forEach((fid) => {
    const anchorId = anchorOf.get(fid) || egoId;
    if (!anchorId) return;
    const ag = gen.get(anchorId) || 0;
    const fg = gen.get(fid) || 0;
    const side = fg > ag ? "down" : fg < ag ? "up" : "side";
    const key = anchorId + "#" + side;
    if (!buckets.has(key)) buckets.set(key, { key, anchorId, side, members: new Set() });
    buckets.get(key).members.add(fid);
  });
  return buckets;
}

// ---- invariant checks ----
const failures = [];
function check(name, cond) { if (!cond) failures.push(name); }

// A fixture: people defs, the kept spine, the ego, a generation map. The folded
// set is everyone not kept. Assert completeness + the supporting invariants.
function runFixture(name, defs, keepIds, egoId, gen) {
  const { neighbors } = makeGraph(defs);
  const keep = new Set(keepIds);
  const foldedIds = defs.map((d) => d.id).filter((id) => !keep.has(id));
  const buckets = bucketizeFolded(keep, foldedIds, egoId, gen, neighbors);

  // (1) COMPLETENESS: union of all bucket members === folded set.
  const union = new Set();
  buckets.forEach((b) => b.members.forEach((id) => union.add(id)));
  check(name + ": completeness (all " + foldedIds.length + " folded shown)",
    union.size === foldedIds.length && foldedIds.every((id) => union.has(id)));

  // (2) PARTITION: no folded person appears in two buckets.
  let total = 0;
  buckets.forEach((b) => { total += b.members.size; });
  check(name + ": buckets partition (no double-count)", total === union.size);

  // (3) every anchor is a kept (visible) person.
  let anchorsKept = true;
  buckets.forEach((b) => { if (!keep.has(b.anchorId)) anchorsKept = false; });
  check(name + ": every anchor is kept", anchorsKept);

  return buckets;
}

// Fixture A: a connected family. Ego + spouse kept; the two kids folded. Both
// kids should bucket to a kept parent (nearest anchor works normally).
runFixture("A connected",
  [
    { id: "H", parents: [], spouses: ["W"] },
    { id: "W", parents: [], spouses: ["H"] },
    { id: "k1", parents: ["H", "W"], spouses: [] },
    { id: "k2", parents: ["H", "W"], spouses: [] }
  ],
  ["H", "W"], "H",
  new Map([["H", 0], ["W", 0], ["k1", 1], ["k2", 1]]));

// Fixture B: THE BUG — a disconnected person. Main family kept; a separate,
// not-yet-linked person "solo" has NO kin path to the spine. Pre-fix they were
// dropped (nearestAnchor → null → skipped). Post-fix they anchor to the ego.
const fixB = runFixture("B disconnected person",
  [
    { id: "ego", parents: [], spouses: [] },
    { id: "child", parents: ["ego"], spouses: [] },
    { id: "solo", parents: [], spouses: [] }   // unlinked — separate component
  ],
  ["ego", "child"], "ego",
  new Map([["ego", 0], ["child", 1], ["solo", 0]]));
// (4) the disconnected person is anchored specifically to the ego.
let soloAnchoredToEgo = false;
fixB.forEach((b) => { if (b.members.has("solo") && b.anchorId === "ego") soloAnchoredToEgo = true; });
check("B disconnected person: solo anchored to ego", soloAnchoredToEgo);

// Fixture C: a deep chain — folded person many hops from the ego. Pre-fix a
// 12-hop cap could strand them; post-fix the uncapped BFS reaches them. Only
// the ego is kept; a 15-long ancestor chain is all folded.
const chain = [{ id: "n0", parents: [], spouses: [] }];
const genC = new Map([["n0", 0]]);
for (let i = 1; i <= 15; i++) {
  chain.push({ id: "n" + i, parents: ["n" + (i - 1)], spouses: [] });
  genC.set("n" + i, i);
}
runFixture("C deep chain (15 hops)", chain, ["n0"], "n0", genC);

// Fixture D: a forest of several disconnected singletons plus the ego — every
// one must still surface (all anchor to the ego).
runFixture("D forest of singletons",
  [
    { id: "me", parents: [], spouses: [] },
    { id: "a", parents: [], spouses: [] },
    { id: "b", parents: [], spouses: [] },
    { id: "c", parents: [], spouses: [] }
  ],
  ["me"], "me",
  new Map([["me", 0], ["a", 0], ["b", 0], ["c", 0]]));

if (failures.length) {
  console.error("scratch-focus-clusters FAIL:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log("scratch-focus-clusters ok — 4 fixtures, completeness holds (nothing dropped, incl. disconnected + deep-chain)");
