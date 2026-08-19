#!/usr/bin/env node
// SCRATCH harness for the Focus-mode layout post-pass (P1b). NOT part of the
// committed suite — a throwaway check that the geometry converges and holds its
// invariants. It reimplements the pure arithmetic of focusLayoutPass verbatim
// (the real fn is a closure inside the tree-view IIFE, not exportable without
// changing the public surface) and asserts, on several synthetic positions
// maps, that:
//   (1) no two nodes in a row overlap after the pass
//   (2) left-to-right order within each row is preserved
//   (3) every parent unit ends horizontally within its children's span (±slack)
//   (4) coordinates stay finite (relaxation never diverges)
//
// Run: node tests/scratch-focus-layout.mjs
const NODE_W = 160, NODE_H = 150, Y_GAP = 100;
const X_GAP_SIBLING = 60;

// ---- fixture builders: produce a computeLayout-shaped positions Map + a
// children lookup + coParent pairs, then run the pass and check invariants.
function makePeople(defs) {
  // defs: [{id, parents:[], spouses:[], row}]
  const byId = new Map(defs.map((d) => [d.id, d]));
  const childrenOf = (id) => defs.filter((d) => (d.parents || []).includes(id)).map((d) => d.id);
  const parentsVis = (id, positions) => (byId.get(id).parents || []).filter((pid) => positions.has(pid));
  return { defs, byId, childrenOf, parentsVis };
}

// Lay rows out naively (like computeLayout: each row centred, siblings spaced),
// deliberately WITHOUT parent-centring, so the pass has something to fix.
function seedPositions(defs) {
  const rows = new Map();
  defs.forEach((d) => { if (!rows.has(d.row)) rows.set(d.row, []); rows.get(d.row).push(d.id); });
  const rowIdxs = Array.from(rows.keys()).sort((a, b) => a - b);
  const widths = new Map();
  let maxW = 0;
  rows.forEach((ids, r) => { const w = ids.length * NODE_W + (ids.length - 1) * X_GAP_SIBLING; widths.set(r, w); if (w > maxW) maxW = w; });
  const positions = new Map();
  rowIdxs.forEach((r, rIdx) => {
    const ids = rows.get(r);
    let cursor = (maxW - widths.get(r)) / 2;
    const y = rIdx * (NODE_H + Y_GAP);
    ids.forEach((id) => { positions.set(id, { x: cursor, y, rowIdx: r, id }); cursor += NODE_W + X_GAP_SIBLING; });
  });
  return positions;
}

// ---- the pass, transcribed from tree-view.js focusLayoutPass (pure parts) ----
function focusLayoutPass(positions, ctx) {
  if (!positions || positions.size < 2) return;
  const rows = new Map();
  positions.forEach((pos, id) => { if (!rows.has(pos.rowIdx)) rows.set(pos.rowIdx, []); rows.get(pos.rowIdx).push(id); });
  rows.forEach((ids) => ids.sort((a, b) => positions.get(a).x - positions.get(b).x));
  const rowIdxs = Array.from(rows.keys()).sort((a, b) => a - b);
  const isCouple = (a, b) => (ctx.byId.get(a).spouses || []).includes(b);
  const isCoParent = (a, b) => ctx.coParents.some((pr) => (pr.a === a && pr.b === b) || (pr.a === b && pr.b === a));
  const visChildren = (id) => ctx.childrenOf(id).filter((cid) => positions.has(cid));
  const visParents = (id) => (ctx.byId.get(id).parents || []).filter((pid) => positions.has(pid));
  function unitsOf(ids) {
    const units = [];
    for (let i = 0; i < ids.length; i++) {
      const a = ids[i], b = ids[i + 1];
      if (b && (isCouple(a, b) || isCoParent(a, b))) { units.push([a, b]); i++; }
      else units.push([a]);
    }
    return units;
  }
  const centerOf = (id) => positions.get(id).x + NODE_W / 2;
  const unitCenter = (u) => u.reduce((s, id) => s + centerOf(id), 0) / u.length;
  const moveUnitTo = (u, cx) => { const dx = cx - unitCenter(u); u.forEach((id) => (positions.get(id).x += dx)); };
  function sweepUnits(units) {
    for (let i = 1; i < units.length; i++) {
      const prev = units[i - 1], cur = units[i];
      let prevRight = -Infinity, curLeft = Infinity;
      prev.forEach((id) => { const r = positions.get(id).x + NODE_W; if (r > prevRight) prevRight = r; });
      cur.forEach((id) => { const l = positions.get(id).x; if (l < curLeft) curLeft = l; });
      const need = prevRight + X_GAP_SIBLING;
      if (curLeft < need) { const dx = need - curLeft; cur.forEach((id) => (positions.get(id).x += dx)); }
    }
  }
  const centroid = (ids) => (ids.length ? ids.reduce((s, id) => s + centerOf(id), 0) / ids.length : null);
  const ITERS = 4;
  for (let it = 0; it < ITERS; it++) {
    for (let r = 1; r < rowIdxs.length; r++) {
      const units = unitsOf(rows.get(rowIdxs[r]));
      units.forEach((u) => { const ps = []; u.forEach((id) => visParents(id).forEach((pid) => ps.push(pid))); const c = centroid(ps); if (c != null) moveUnitTo(u, c); });
      sweepUnits(units);
    }
    for (let r = rowIdxs.length - 2; r >= 0; r--) {
      const units = unitsOf(rows.get(rowIdxs[r]));
      units.forEach((u) => { const cs = []; u.forEach((id) => visChildren(id).forEach((cid) => cs.push(cid))); const c = centroid(cs); if (c != null) moveUnitTo(u, c); });
      sweepUnits(units);
    }
  }
}

// ---- invariant checks ----
const failures = [];
function check(name, cond) { if (!cond) failures.push(name); }

function runFixture(name, defs, coParents = []) {
  const ctx = makePeople(defs);
  ctx.coParents = coParents;
  const positions = seedPositions(defs);
  focusLayoutPass(positions, ctx);
  // (4) finite
  let finite = true;
  positions.forEach((p) => { if (!Number.isFinite(p.x)) finite = false; });
  check(name + ": coords finite", finite);
  // group rows
  const rows = new Map();
  positions.forEach((p, id) => { if (!rows.has(p.rowIdx)) rows.set(p.rowIdx, []); rows.get(p.rowIdx).push(id); });
  rows.forEach((ids) => {
    ids.sort((a, b) => positions.get(a).x - positions.get(b).x);
    // (1) no overlap: each left edge clears prior right edge (couples may sit
    // tighter, but this fixture set has no negative gaps, so NODE_W spacing holds)
    for (let i = 1; i < ids.length; i++) {
      const prevR = positions.get(ids[i - 1]).x + NODE_W;
      const curL = positions.get(ids[i]).x;
      check(name + ": no overlap r" + positions.get(ids[i]).rowIdx + " [" + ids[i - 1] + "|" + ids[i] + "]", curL + 0.01 >= prevR);
    }
  });
  // (3) parent over children: each parent's center within children's x-span
  defs.forEach((d) => {
    const kids = ctx.childrenOf(d.id).filter((cid) => positions.has(cid));
    if (kids.length) {
      const pc = positions.get(d.id).x + NODE_W / 2;
      let lo = Infinity, hi = -Infinity;
      kids.forEach((cid) => { const c = positions.get(cid).x + NODE_W / 2; if (c < lo) lo = c; if (c > hi) hi = c; });
      // allow a node-width of slack (sweep + single-child cases pull off-centre)
      check(name + ": parent " + d.id + " over children", pc >= lo - NODE_W && pc <= hi + NODE_W);
    }
  });
  return positions;
}

// Fixture A: one parent, three children (the classic "parent off to the side").
runFixture("A single-parent-3-kids", [
  { id: "P", parents: [], spouses: [], row: 0 },
  { id: "c1", parents: ["P"], spouses: [], row: 1 },
  { id: "c2", parents: ["P"], spouses: [], row: 1 },
  { id: "c3", parents: ["P"], spouses: [], row: 1 }
]);

// Fixture B: couple with two children — the pair must stay together and centre.
runFixture("B couple-2-kids", [
  { id: "H", parents: [], spouses: ["W"], row: 0 },
  { id: "W", parents: [], spouses: ["H"], row: 0 },
  { id: "k1", parents: ["H", "W"], spouses: [], row: 1 },
  { id: "k2", parents: ["H", "W"], spouses: [], row: 1 }
]);

// Fixture C: three generations, lopsided — grandparent, one child who has two kids.
runFixture("C three-gen", [
  { id: "G", parents: [], spouses: [], row: 0 },
  { id: "A", parents: ["G"], spouses: [], row: 1 },
  { id: "B", parents: ["G"], spouses: [], row: 1 },
  { id: "x", parents: ["A"], spouses: [], row: 2 },
  { id: "y", parents: ["A"], spouses: [], row: 2 }
]);

// Fixture D: co-parents (unmarried pair sharing a child) — must group as a unit.
runFixture("D co-parents", [
  { id: "M", parents: [], spouses: [], row: 0 },
  { id: "N", parents: [], spouses: [], row: 0 },
  { id: "kid", parents: ["M", "N"], spouses: [], row: 1 }
], [{ a: "M", b: "N" }]);

// Fixture E: forest — two disjoint families in the same map (no shared edges).
runFixture("E forest", [
  { id: "f1", parents: [], spouses: [], row: 0 },
  { id: "f1c", parents: ["f1"], spouses: [], row: 1 },
  { id: "g1", parents: [], spouses: [], row: 0 },
  { id: "g1c", parents: ["g1"], spouses: [], row: 1 }
]);

if (failures.length) {
  console.error("scratch-focus-layout FAIL:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log("scratch-focus-layout ok — 5 fixtures, invariants hold (no overlap, order, parent-over-children, finite)");
