// @ts-check
/**
 * Tree view — renders the family as a top-down generational tree in SVG with
 * pan, pinch-zoom, wheel-zoom, and zoom controls.
 *
 * Exposes window.TreeView =
 *   { mount(rootEl), render, setFilter, applyHighlightClasses, revealPerson,
 *     getLineageFocus, clearLineageFocus }.
 * A sticky lineage focus also broadcasts a `virasat:lineage-focus` event so
 * other views can show a cross-view "focused on X" cue.
 */
(function (global) {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const XLINK_NS = "http://www.w3.org/1999/xlink";

  // Layout constants — photo-first heritage cards
  const NODE_W = 160;
  const NODE_H = 150;
  // Couples render with overlapping card boxes so the two PHOTOS sit close
  // but with a small visible gap (~14px between ring edges) — enough room
  // for the gold "wedding ring" knot to centre cleanly between them.
  // (NODE_W - 2*PHOTO_R) = 76; X_GAP_COUPLE of -62 leaves photo edges 14px
  // apart, with 98px between name centres.
  const X_GAP_COUPLE  = -62;
  // Two people who share a child but are NOT married sit as a loose pair:
  // closer than siblings so they read as one parental unit (the child's trunk
  // drops from between them), but wider than a married couple so their photos
  // don't overlap — leaving room for a neutral, knot-less co-parent bar to span
  // the gap. (NODE_W - 20) = 140px between name centres; ring edges ~56px apart.
  const X_GAP_COPARENT = -20;
  const X_GAP_SIBLING = 60;
  const Y_GAP = 100;
  const PHOTO_R = 42;       // larger circular portrait
  const PHOTO_CY = 50;      // photo centred near top
  const PAD = 80;

  // Module state
  let rootEl = null;
  let svgEl = null;
  let edgesG = null;
  let nodesG = null;
  let knotsG = null;
  let labelsG = null;
  let stageEl = null;

  // Current viewBox state and bbox of last layout
  let viewBox = { x: 0, y: 0, w: 1000, h: 600 };
  let lastBBox = null;
  // Last computed layout (id → { x, y, person, ... }). Lifted to module scope
  // so revealPerson() can pan/zoom to a node without recomputing the layout.
  let lastPositions = null;
  // Adjacent unmarried co-parent id-pairs [{ a, b }] from the last layout —
  // computeLayout places these side-by-side; drawEdges spans a neutral bar
  // between their photos so a shared child's trunk reads as connected.
  let coParentPairsLayout = [];
  let userInteracted = false;
  // Sticky lineage focus — set via the "Focus this lineage" node-menu item.
  // Survives Inspector.clear so the dim/highlight state doesn't disappear
  // when the inspector closes (the actual reason this state exists: on
  // phone the inspector covers the tree, so the user couldn't see the
  // highlight effect until they closed the inspector — at which point
  // the selection had cleared and so had the highlight).
  let lineageFocusId = null;
  // Which way the sticky focus walks: "descendants" (down only — the default,
  // and what a transient selection always uses) or "bloodline" (also up through
  // every ancestor). Only consulted while lineageFocusId is set.
  let lineageFocusMode = "descendants";
  // On-canvas relationship-path highlighting (#94). Shift-click (desktop) or the
  // "Compare" toggle (touch/keyboard) picks two people; the shortest chain
  // between them lights up along the real .t-edge / knot elements using the
  // SAME visual vocabulary as lineage focus (is-selected / is-lineage /
  // is-faded). Path mode is mutually exclusive with lineageFocusId — picking a
  // path anchor clears the sticky lineage focus and vice-versa. These carry NO
  // new DOM: they only toggle classes the exporter already strips/ignores.
  let pathAId = null;         // first anchor (gold)
  let pathBId = null;         // second anchor (gold); null while awaiting pick 2
  let pathIds = null;         // Set<id> of every person on the chain, or null
  let pathOrdered = null;     // ordered id[] of the chain (for the kin-term label)
  let pathLen = 0;            // number of people on the chain (for the banner)
  let pathEdgePairs = null;   // Set<"a|b"> of parent-child hops → light .t-edge
  let pathSpousePairs = null; // Set<"a|b"> of spouse hops → light the couple knot
  let compareArmed = false;   // touch/keyboard "Compare" mode: taps pick anchors
  let compareBtnEl = null;    // the tree-controls Compare button (state toggling)
  let modeBtnEl = null;       // the tree-controls Focus-mode toggle (state toggling)
  let undoBtnEl = null;       // tree-controls Undo button (disabled-state synced)
  let redoBtnEl = null;       // tree-controls Redo button (disabled-state synced)
  // View-option toggles — each persists in localStorage so they survive
  // reloads. The View Options popover (sliders icon in the tree controls)
  // surfaces them; nothing else writes here.
  let showPets = readBool("virasat.showPets", true);
  // showAge — the tree-node age badge. One-time migration of the legacy key
  // "virasat.showStoryCount" (this toggle used to show a story count) to the
  // current "virasat.showAge", so upgrading users keep their saved preference
  // under a name that matches what the toggle now does. Runs at module load,
  // before the export modal or any other reader touches the new key.
  try {
    if (localStorage.getItem("virasat.showAge") == null) {
      const legacyShowAge = localStorage.getItem("virasat.showStoryCount");
      if (legacyShowAge != null) localStorage.setItem("virasat.showAge", legacyShowAge);
    }
    localStorage.removeItem("virasat.showStoryCount");
  } catch (_) {}
  let showAge = readBool("virasat.showAge", true);
  let showDates = readBool("virasat.showDates", true);
  // Left-gutter era markers — one per generation row, labelled by the row's
  // median birth decade ("1950s"). An orientation aid, so it's opt-outable.
  let showEras = readBool("virasat.showEras", true);
  // Relation-to-me pills — when a "self" is pinned (SelfAnchor), each close-kin
  // node can show how they relate to you (chacha, bua…). Defaults on, but only
  // ever shows anything while a self is set; deselecting "this is me" flips it
  // off (see the SelfAnchor.onChange handler) so the pills don't linger dead.
  let showRelationToMe = readBool("virasat.showRelationToMe", true);
  function readBool(key, dflt) {
    try {
      const v = localStorage.getItem(key);
      if (v === null) return dflt;
      return v !== "0";
    } catch (_) { return dflt; }
  }
  function writeBool(key, v) {
    try { localStorage.setItem(key, v ? "1" : "0"); } catch (_) {}
  }
  // Tree display mode. "full" is the original whole-tree layout (unchanged);
  // "focus" is the ego-centric view built in the Focus-mode work — it prunes to
  // a person's near kin and folds distant relatives into cluster nodes so a
  // sparse tree stays legible. focusId is the person the focus view centres on;
  // resolveFocusId() picks a sensible default (pinned self → a root → the
  // current selection) whenever it's unset or points at a deleted person.
  // Persisted like the other view prefs so a reload restores the chosen mode.
  function readStr(key, dflt) {
    try { const v = localStorage.getItem(key); return v == null ? dflt : v; } catch (_) { return dflt; }
  }
  function writeStr(key, v) {
    try { if (v == null) localStorage.removeItem(key); else localStorage.setItem(key, v); } catch (_) {}
  }
  let treeMode = readStr("virasat.treeMode", "full") === "focus" ? "focus" : "full";
  // treeMode is a global display preference (like showPets); focusId is the
  // per-tree centre — "who is 'me'" is meaningless across trees, so we key it by
  // active tree id exactly like SelfAnchor. focusId is an in-memory cache of the
  // active tree's centre; focusTreeId tracks which tree it belongs to so a tree
  // switch drops the stale centre and re-reads the new tree's saved focus.
  let focusId = null;
  let focusTreeId = null;
  // How many people the focus view folded away this render (subtitle cue, so a
  // pruned relative is never silently gone). Set in render(), read in updateSubtitle.
  let focusHiddenCount = 0;
  // The visible spine (Set<id>) from the last focus prune, and the ids folded
  // away, captured in render() so drawClusters() (a post-pass) can bucket the
  // folded people against their nearest visible anchor. Empty in full mode.
  let focusKeepSet = null;
  let focusFoldedIds = null;
  // Clusters the user has expanded (tapped open) — their members render as real
  // nodes instead of a stack. Keyed by a stable cluster id (anchor + side). Held
  // across renders and folded into the topology signature so an expand re-lays out.
  let expandedClusters = new Set();
  // Live cluster-peek popover element (desktop hover / keyboard focus preview),
  // or null. One at a time; torn down on leave/blur, re-center, and re-render.
  let clusterPeekEl = null;
  function focusIdKey() {
    const tid = (FamilyStore.getActiveTreeId && FamilyStore.getActiveTreeId()) || null;
    return tid ? "virasat.focusId." + tid : "virasat.focusId";
  }
  function readFocusId() { return readStr(focusIdKey(), null) || null; }
  function writeFocusId(v) { writeStr(focusIdKey(), v); }
  function setShowPets(v) { showPets = !!v; writeBool("virasat.showPets", showPets); render(); }
  function setShowAge(v) { showAge = !!v; writeBool("virasat.showAge", showAge); render(); }
  function setShowDates(v) { showDates = !!v; writeBool("virasat.showDates", showDates); render(); }
  function setShowEras(v) { showEras = !!v; writeBool("virasat.showEras", showEras); render(); }
  // Relation pills are a pure overlay keyed by person id (see decorateSelf), so
  // toggling them never needs a re-layout — just repaint the overlay.
  function setShowRelationToMe(v) { showRelationToMe = !!v; writeBool("virasat.showRelationToMe", showRelationToMe); decorateSelf(); }

  // Keep the in-memory focusId aligned with the active tree. On a tree switch
  // the cached centre belongs to the old tree, so drop it and re-read the new
  // tree's saved focus (per-tree key). Called at the top of render(), which
  // runs on every store change including the swap to another tree.
  function syncFocusToActiveTree() {
    const tid = (FamilyStore.getActiveTreeId && FamilyStore.getActiveTreeId()) || null;
    if (tid !== focusTreeId) {
      focusTreeId = tid;
      focusId = readFocusId();
    }
  }

  // Resolve the person the focus view should centre on. Preference order:
  //   1. the current focusId, if it still names a living person
  //   2. the pinned "self" (SelfAnchor) — the most personal centre
  //   3. a root (someone with no parents) — the natural top of a lineage
  //   4. the current inspector selection, then simply the first non-pet person
  // Returns null only for an empty tree. Never throws; every lookup is guarded.
  function resolveFocusId() {
    const has = (id) => !!(id && FamilyStore.getPerson && FamilyStore.getPerson(id));
    if (has(focusId)) return focusId;
    try {
      if (window.SelfAnchor && SelfAnchor.get) { const s = SelfAnchor.get(); if (has(s)) return s; }
    } catch (_) {}
    const people = FamilyStore.getPeople();
    if (!people.length) return null;
    const root = people.find((p) => !p.isPet && !(p.parents && p.parents.length));
    if (root) return root.id;
    try {
      const sel = window.Inspector && Inspector.getSelected ? Inspector.getSelected() : null;
      if (has(sel)) return sel;
    } catch (_) {}
    // A pet is a poor ego (no ancestors, bond-only edges) — prefer a real person
    // as the terminal fallback; only centre on a pet if the tree is all pets.
    const firstReal = people.find((p) => !p.isPet);
    return (firstReal || people[0]).id;
  }

  // Switch between "full" (whole tree) and "focus" (ego-centric) display. Both
  // persist. Toggling always re-renders; the mode + focusId are folded into the
  // topology signature (see render) so the gated-render cache can't skip the
  // rebuild. In focus mode we lock in a concrete focusId up front so the button
  // state, the signature, and the layout all agree on the same centre.
  function setTreeMode(mode) {
    const next = mode === "focus" ? "focus" : "full";
    if (next === treeMode) return;
    treeMode = next;
    if (treeMode === "focus") {
      syncFocusToActiveTree();
      focusId = resolveFocusId();
      writeFocusId(focusId);
    } else {
      // Leaving focus mode: any open peek belongs to a canvas that's about to
      // become the full tree — drop it so it can't dangle.
      hideClusterPeek();
    }
    writeStr("virasat.treeMode", treeMode);
    updateModeBtn();
    render();
    if (treeMode === "focus") maybeShowFocusHint();
  }
  function toggleTreeMode() { setTreeMode(treeMode === "focus" ? "full" : "focus"); }

  // ===== Degree-of-interest (focus mode) =====
  // Which people the focus view keeps "in the spine" vs. folds away. A single
  // breadth-first walk out from focusId over the undirected kin graph (parents,
  // children, spouses, co-parents, and pet bonds) assigns each reachable person
  // a hop-distance; anyone within FOCUS_RADIUS is drawn, the rest are folded
  // (into clusters in a later phase — for now they're simply pruned, and the
  // count is surfaced in the subtitle so nothing looks silently dropped).
  //
  // ONE BFS from the ego — O(n) over the graph — not N² pairwise path calls.
  // Spouses are pulled in at distance 0 (a couple is one unit), and every kept
  // person's spouse is always kept so no knot ever dangles half-drawn.
  const FOCUS_RADIUS = 3;
  function focusNeighbors(id) {
    // Undirected adjacency for the DOI walk. Mirrors the relations that draw an
    // edge in the tree so "distance" tracks visual connectedness, not raw data.
    const p = FamilyStore.getPerson(id);
    if (!p) return [];
    const out = [];
    (p.parents || []).forEach((x) => out.push(x));
    (p.spouses || []).forEach((x) => out.push(x));
    (p.petOwners || []).forEach((x) => out.push(x));
    FamilyStore.getChildrenOf(id).forEach((c) => out.push(c.id));
    return out;
  }
  // Returns { keep:Set<id>, dist:Map<id,number> } for the ego at focusId. keep
  // is the visible spine; every spouse of a kept person is force-kept so couples
  // never split. Guarded for a missing/empty ego (returns empty sets).
  function focusVisibleSet(egoId) {
    const keep = new Set();
    const dist = new Map();
    if (!egoId || !FamilyStore.getPerson(egoId)) return { keep, dist };
    // Seed the frontier with the ego AND its spouses at distance 0 — partners
    // share the centre so the couple reads as the root of the focus view.
    const seeds = [egoId];
    const ego = FamilyStore.getPerson(egoId);
    (ego.spouses || []).forEach((sid) => { if (FamilyStore.getPerson(sid)) seeds.push(sid); });
    let frontier = [];
    seeds.forEach((sid) => { if (!dist.has(sid)) { dist.set(sid, 0); keep.add(sid); frontier.push(sid); } });
    let d = 0;
    while (frontier.length && d < FOCUS_RADIUS) {
      d++;
      const next = [];
      frontier.forEach((id) => {
        focusNeighbors(id).forEach((nid) => {
          if (dist.has(nid) || !FamilyStore.getPerson(nid)) return;
          dist.set(nid, d);
          keep.add(nid);
          next.push(nid);
        });
      });
      frontier = next;
    }
    // Force-keep the spouse of every kept person, even if the spouse sits one
    // hop past the radius — a couple knot with only one photo drawn reads as a
    // rendering bug. The added spouse is a leaf here (not re-expanded).
    Array.from(keep).forEach((id) => {
      const p = FamilyStore.getPerson(id);
      if (!p) return;
      (p.spouses || []).forEach((sid) => {
        if (!keep.has(sid) && FamilyStore.getPerson(sid)) { keep.add(sid); if (!dist.has(sid)) dist.set(sid, dist.get(id) || FOCUS_RADIUS); }
      });
    });
    return { keep, dist };
  }

  // One-time, phone-only nudge that the long-press node menu exists. The
  // desktop pan-hint mentions right-click; touch users get no equivalent
  // cue, so surface it once — localStorage-gated, coarse-pointer only, and
  // only while the tree view is actually on screen with people drawn.
  function maybeShowTouchMenuHint() {
    try {
      if (localStorage.getItem("virasat.touchMenuHintShown")) return;
      const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
      if (!coarse) return;
      if (!rootEl || !rootEl.classList.contains("is-active")) return;
      // Set the flag synchronously so a rapid second render (activate →
      // subscribe) can't double-fire before the deferred toast lands.
      localStorage.setItem("virasat.touchMenuHintShown", "1");
      setTimeout(() => { if (window.UI && UI.toast) UI.toast(I18n.t("tree.touchMenuHint")); }, 900);
    } catch (_) {}
  }

  // Coarse-pointer (touch) detection, memoized. Drives larger invisible SVG
  // hit targets for the knot + add-relative disc, which are otherwise ~22-28px
  // — below the 44px touch minimum the .tree-controls buttons already honour.
  let _coarse = null;
  function isCoarsePointer() {
    if (_coarse === null) {
      try { _coarse = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches); }
      catch (_) { _coarse = false; }
    }
    return _coarse;
  }

  // Pointer tracking for pan / pinch
  const activePointers = new Map();
  let panStart = null; // { svgX, svgY, vbx, vby }
  let pinchStart = null; // { dist, midX, midY, vb: {...} }

  // ===== SVG element helper =====
  function svgEl_(tag, attrs, children) {
    const node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === "class") node.setAttribute("class", v);
        else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === "xlink:href") node.setAttributeNS(XLINK_NS, "href", v);
        else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
        else if (v === true) node.setAttribute(k, "");
        else node.setAttribute(k, v);
      }
    }
    if (children != null) {
      const arr = Array.isArray(children) ? children : [children];
      arr.forEach((c) => {
        if (c == null || c === false) return;
        node.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
      });
    }
    return node;
  }

  // The node's "no photo" state: an accent-soft disc with the person's
  // initials. Used both when a person has no photo at all and when an async
  // photo resolve comes back empty (blob missing from this device's IDB), so
  // the two paths render identically. cx/cy are the photo-circle centre.
  function appendPhotoInitials(g, cx, cy, displayName) {
    g.appendChild(svgEl_("circle", {
      cx, cy, r: PHOTO_R,
      fill: "var(--accent-soft)"
    }));
    g.appendChild(svgEl_("text", {
      x: cx, y: cy + 5,
      "text-anchor": "middle",
      "font-size": "16",
      "font-family": "var(--font-display)",
      "font-weight": "600",
      fill: "var(--accent)"
    }, FamilyStore.initials(displayName)));
  }

  // ===== Mount =====
  function mount(root) {
    rootEl = root;
    UI.clear(rootEl);

    // Editable title: shows the family name (heritage feel — "The Sharma
    // Family"). Clicking the pencil opens an inline edit. Persisted on
    // state.meta.
    const subEl = UI.el("span", { class: "view-head__sub" }, "");
    const eyebrowEl = UI.el("span", { class: "view-head__eyebrow" }, "");
    const titleEl = UI.el("h2", { class: "view-head__title" });
    function renderTitle() {
      while (titleEl.firstChild) titleEl.removeChild(titleEl.firstChild);
      const title = FamilyStore.getFamilyTitle ? FamilyStore.getFamilyTitle() : "Family tree";
      // Highlight the leading word(s) up to the first whitespace before
      // "family"/"tree" so a typed title like "Sharma Family Tree" still
      // gets the gold accent on "Sharma".
      const m = /^(\S+)(\s+.*)?$/.exec(title);
      if (m) {
        titleEl.appendChild(UI.el("span", { class: "view-head__title-accent" }, m[1]));
        if (m[2]) titleEl.appendChild(document.createTextNode(m[2]));
      } else {
        titleEl.appendChild(document.createTextNode(title));
      }
      const pen = UI.el("button", {
        class: "view-head__rename js-edit-only",
        type: "button",
        "aria-label": I18n.t("tree.renameTitle"),
        title: I18n.t("tree.renameTitle")
      }, [UI.el("i", { class: "fa-solid fa-pen" })]);
      pen.addEventListener("click", openRename);
      titleEl.appendChild(pen);
      // Eyebrow above the title — derives a soft "Established c. NNNN" from
      // the earliest known birth year. Falls back to nothing if every record
      // is dateless.
      const earliest = (FamilyStore.getPeople() || []).reduce((acc, p) => {
        const y = FamilyStore.getYear(p.birthDate);
        return (y != null && (acc == null || y < acc)) ? y : acc;
      }, null);
      eyebrowEl.textContent = earliest != null
        ? I18n.t("tree.establishedC", { year: Math.floor(earliest / 10) * 10 })
        : "";
    }
    function openRename() {
      const current = FamilyStore.getFamilyTitle ? FamilyStore.getFamilyTitle() : "";
      const input = UI.el("input", {
        class: "input",
        type: "text",
        value: current,
        placeholder: I18n.t("tree.namePlaceholder"),
        maxlength: 80
      });
      const body = UI.el("div", { class: "form-stack" }, [
        UI.el("p", { style: { margin: 0, color: "var(--text-3)", fontSize: "13px" } },
          I18n.t("tree.renameBody")),
        UI.field(I18n.t("tree.nameLabel"), input)
      ]);
      const cancelBtn = UI.cancelBtn(I18n.t("actions.cancel"));
      const saveBtn = UI.saveBtn(I18n.t("actions.save"));
      const dlg = UI.openModal({ title: I18n.t("tree.renameTitle"), body, footer: [cancelBtn, saveBtn] });
      cancelBtn.addEventListener("click", () => dlg.close());
      saveBtn.addEventListener("click", () => {
        if (FamilyStore.setFamilyTitle) FamilyStore.setFamilyTitle(input.value);
        // Keep the legacy familyName roughly in sync (first word) so anything
        // still reading meta.familyName has a sensible value.
        const firstWord = String(input.value || "").trim().split(/\s+/)[0];
        if (firstWord && FamilyStore.setFamilyName) FamilyStore.setFamilyName(firstWord);
        UI.toast(I18n.t("tree.renamed"), "success");
        dlg.close();
      });
      setTimeout(() => { input.focus(); input.select(); }, 50);
    }
    renderTitle();

    const header = UI.el("div", { class: "view-head" }, [
      UI.el("div", { class: "view-head__title-wrap" }, [eyebrowEl, titleEl, subEl]),
      UI.el("div", { class: "view-head__actions" }, [
        UI.el("button", {
          class: "btn js-edit-only", type: "button",
          onclick: () => window.PeopleView && PeopleView.openForm && PeopleView.openForm(null)
        }, [UI.el("i", { class: "fa-solid fa-user-plus" }), UI.el("span", { "data-i18n": "tree.addPerson" }, I18n.t("tree.addPerson"))])
      ])
    ]);
    rootEl.__subEl = subEl;
    rootEl.__renderTitle = renderTitle;

    stageEl = UI.el("div", { class: "tree-stage" });

    svgEl = svgEl_("svg", {
      class: "tree-svg",
      xmlns: SVG_NS,
      preserveAspectRatio: "xMidYMid meet"
    });
    labelsG = svgEl_("g", { class: "tree-eras", "aria-hidden": "true" });
    edgesG = svgEl_("g", { class: "tree-edges" });
    nodesG = svgEl_("g", { class: "tree-nodes" });
    knotsG = svgEl_("g", { class: "tree-knots" });
    svgEl.appendChild(labelsG);  // era gutter paints first → behind everyone
    svgEl.appendChild(edgesG);
    svgEl.appendChild(nodesG);
    svgEl.appendChild(knotsG);  // knots paint last → above the photo rings

    const optionsBtn = UI.el("button", {
      class: "btn", type: "button",
      "aria-label": I18n.t("tree.viewOptions"), title: I18n.t("tree.viewOptions"),
      onclick: (ev) => { ev.stopPropagation(); openViewOptions(optionsBtn); }
    }, [UI.el("i", { class: "fa-solid fa-sliders" })]);

    // Compare (relationship-path) toggle. On touch there's no shift-click, so
    // this arms a mode where the next two node taps become the path anchors.
    // On desktop it's an equal alternative to shift-clicking. aria-pressed
    // reflects the armed state for screen readers.
    compareBtnEl = UI.el("button", {
      class: "btn", type: "button",
      "aria-label": I18n.t("tree.compare"), title: I18n.t("tree.compare"),
      "aria-pressed": "false",
      onclick: (ev) => { ev.stopPropagation(); toggleCompareMode(); }
    }, [UI.el("i", { class: "fa-solid fa-people-arrows" })]);

    // Focus-mode toggle. "Full tree" (default) is the whole-tree layout; pressing
    // this flips to the ego-centric focus view. aria-pressed reflects focus mode
    // for screen readers, matching the Compare button's pattern.
    modeBtnEl = UI.el("button", {
      class: "btn", type: "button",
      "aria-label": I18n.t("tree.focusMode"), title: I18n.t("tree.focusMode"),
      "aria-pressed": "false",
      onclick: (ev) => { ev.stopPropagation(); toggleTreeMode(); }
    }, [UI.el("i", { class: "fa-solid fa-crosshairs" })]);

    // Undo / redo — moved here from the header (the chrome was too busy). They
    // dispatch virasat:undo / virasat:redo; app.js owns doUndo/doRedo (the
    // guard + toast) and the global Cmd/Ctrl+Z shortcuts, so this toolbar and
    // the keyboard stay in lockstep. Editing-only (js-edit-only hides them for
    // viewers, who have no history). Start disabled; refreshUndoRedo() syncs the
    // disabled state at the top of render(), which fires on every store change.
    // .tree-controls__hist marks the undo/redo trio (2 buttons + divider) so CSS
    // can drop them on phone, where the kebab menu already carries undo/redo
    // from every view — there they'd only duplicate and crowd the cluster.
    undoBtnEl = UI.el("button", {
      class: "btn js-edit-only tree-controls__hist", type: "button", disabled: true,
      "aria-label": I18n.t("actions.undoAria"), title: I18n.t("actions.undo"),
      onclick: () => { try { window.dispatchEvent(new CustomEvent("virasat:undo")); } catch (_) {} }
    }, [UI.el("i", { class: "fa-solid fa-rotate-left" })]);
    redoBtnEl = UI.el("button", {
      class: "btn js-edit-only tree-controls__hist", type: "button", disabled: true,
      "aria-label": I18n.t("actions.redoAria"), title: I18n.t("actions.redo"),
      onclick: () => { try { window.dispatchEvent(new CustomEvent("virasat:redo")); } catch (_) {} }
    }, [UI.el("i", { class: "fa-solid fa-rotate-right" })]);

    const controls = UI.el("div", { class: "tree-controls" }, [
      undoBtnEl,
      redoBtnEl,
      UI.el("span", { class: "tree-controls__divider js-edit-only tree-controls__hist" }),
      UI.el("button", { class: "btn", type: "button", "aria-label": I18n.t("actions.zoomOut"),
        onclick: () => zoomBy(1.25) }, [UI.el("i", { class: "fa-solid fa-minus" })]),
      UI.el("span", { class: "tree-controls__pct", id: "tree-zoom-pct" }, "100%"),
      UI.el("button", { class: "btn", type: "button", "aria-label": I18n.t("actions.zoomIn"),
        onclick: () => zoomBy(0.8) }, [UI.el("i", { class: "fa-solid fa-plus" })]),
      UI.el("span", { class: "tree-controls__divider" }),
      modeBtnEl,
      compareBtnEl,
      optionsBtn,
      UI.el("button", { class: "btn", type: "button", "aria-label": I18n.t("tree.fitView"), title: I18n.t("tree.fitView"),
        onclick: () => resetView() }, [UI.el("i", { class: "fa-solid fa-expand" })])
    ]);

    const panHint = UI.el("div", { class: "tree-pan-hint" }, [
      UI.el("i", { class: "fa-solid fa-arrows-up-down-left-right" }),
      UI.el("span", { "data-i18n": "tree.panHint" }, I18n.t("tree.panHint"))
    ]);

    stageEl.appendChild(svgEl);
    stageEl.appendChild(controls);
    stageEl.appendChild(panHint);

    rootEl.appendChild(header);
    rootEl.appendChild(stageEl);

    attachInteractions();
  }

  // ===== Render =====
  // Topology signature for the gated render below — only the structural
  // bits that drive layout + edge geometry. If this string is unchanged
  // since the last render, we skip the SVG rebuild and just patch the
  // mutable cosmetic bits (name, dates, age badge, photo) on the
  // existing nodes. Cuts the per-keystroke cost of editing a name on a
  // 100-person tree from a full re-layout to ~ms of textContent updates.
  let lastTopoSig = null;
  function topoSignature(people, marriages, viewOpts) {
    const parts = [];
    // Stable order for diffing — sort by id rather than rendering order
    // so reordering within a row doesn't bust the cache.
    people.slice().sort((a, b) => a.id.localeCompare(b.id)).forEach((p) => {
      parts.push(p.id
        + "|" + (p.parents || []).slice().sort().join(",")
        // Explicitly-unknown parent roles drive the dashed placeholder phantoms
        // (drawPhantomParents). Toggling the flag must bust the layout cache so
        // the phantom appears / disappears on the next render.
        + "|" + (p.unknownParents || []).slice().sort().join(",")
        + "|" + (p.spouses || []).slice().sort().join(",")
        + "|" + (p.petOwners || []).slice().sort().join(",")
        + "|" + (p.isPet ? "1" : "0")
        + "|" + (p.deathDate ? "1" : "0")
        // Age-badge presence (a parseable birth date → calcAge non-null) drives
        // whether the badge exists in the DOM — bust the cache when it crosses
        // that boundary so adding/clearing a birth date adds/removes it. (The
        // age VALUE changing is cosmetic and handled by the soft-update path;
        // deathDate above is already structural, so switching current-age ↔
        // age-at-death forces a full render that redraws the number.)
        + "|" + (FamilyStore.calcAge(p) != null ? "a" : "_")
        // Same for whether the person has any photo at all (the photo
        // ring + image element are structural).
        + "|" + ((p.photo || p.photoId) ? "p" : "_"));
    });
    const mkeys = Object.keys(marriages || {}).slice().sort().join(";");
    // Read-only state is structural here: the per-node "+" add-relative disc is
    // built only when NOT read-only (see the node loop). Toggling preview flips
    // read-only without changing people/marriages, so without this the signature
    // would match, the SVG rebuild would be skipped, and the "+" discs would be
    // stranded in the DOM (visible in preview, or absent when a viewer's session
    // later becomes editable). Folding it in busts the cache exactly when the
    // affordance set changes.
    const ro = (FamilyStore.isReadOnly && FamilyStore.isReadOnly()) ? "1" : "0";
    return parts.join("\n") + "\n#m=" + mkeys + "\n#opts=" + viewOpts + "\n#ro=" + ro;
  }
  function updateSubtitle(people) {
    if (!rootEl || !rootEl.__subEl) return;
    const gens = (function () { const g = FamilyStore.buildGenerations(); let m = 0; g.forEach((v) => { if (v > m) m = v; }); return people.length ? m + 1 : 0; })();
    const memberStr = people.length === 1 ? I18n.t("tree.memberOne") : I18n.t("tree.memberMany", { n: people.length });
    const genStr = gens === 1 ? I18n.t("tree.generationOne") : I18n.t("tree.generationMany", { n: gens });
    // Count "memories" — total stories across the tree. A heritage-app
    // metric, not just a roster size.
    const memoryCount = people.reduce((n, p) => n + ((p.stories || []).length), 0);
    const memoryStr = memoryCount === 0 ? null
      : memoryCount === 1 ? I18n.t("tree.memoryOne")
      : I18n.t("tree.memoryMany", { n: memoryCount });
    // Focus mode folds distant kin out of view — surface the count so a pruned
    // relative is never silently gone ("… · 12 more relatives"). Only shown when
    // focus mode actually hid someone.
    const hiddenStr = (treeMode === "focus" && focusHiddenCount > 0)
      ? (focusHiddenCount === 1 ? I18n.t("tree.focusHiddenOne") : I18n.t("tree.focusHiddenMany", { n: focusHiddenCount }))
      : null;
    rootEl.__subEl.textContent = [memberStr, genStr, memoryStr, hiddenStr].filter(Boolean).join(" · ");
  }

  // Soft update — refresh the cosmetic bits on existing .t-node elements
  // without touching layout or edges.
  function softUpdateNodes(people) {
    const byId = new Map(people.map((p) => [p.id, p]));
    // Keep the collision index in sync with the initial-render path so a soft
    // update recomputes surname initials if a rename introduced/removed a clash.
    buildFirstNameIndex(people);
    nodesG.querySelectorAll(".t-node").forEach((g) => {
      const id = g.getAttribute("data-person-id");
      const p = byId.get(id);
      if (!p) return;
      const nameEl = g.querySelector(".t-node-name");
      if (nameEl) {
        const displayName = (FamilyStore.getField && FamilyStore.getField(p, "name")) || p.name;
        // Tree shows only the first word (+ surname initial on collision); the
        // full name lives in the inspector and the SVG <title> tooltip. Keep
        // parity with the initial render path (nodeLabel) so a soft update
        // doesn't swap first→full and suddenly fill the canvas with long names.
        const truncated = nodeLabel(p, displayName);
        if (nameEl.textContent !== truncated) {
          nameEl.textContent = truncated;
          // Refresh the <title> tooltip too in case the full name changed
          let titleEl = nameEl.querySelector("title");
          if (!titleEl) {
            titleEl = document.createElementNS("http://www.w3.org/2000/svg", "title");
            nameEl.appendChild(titleEl);
          }
          titleEl.textContent = displayName;
        }
      }
      const dateEl = g.querySelector(".t-node-dates");
      if (dateEl && showDates) {
        const next = formatYears(p);
        if (dateEl.textContent !== next) dateEl.textContent = next;
      }
      // Age badge — text only; the badge's existence is structural (added on
      // full render when calcAge is non-null). For soft updates we just refresh
      // the number, since editing a birth/death date is a soft update (topology
      // unchanged) and must update the shown age. If the age went null (birth
      // date cleared) we leave the stale value; the next full render drops it.
      const densityNum = g.querySelector(".t-node-density-num");
      if (densityNum) {
        const age = FamilyStore.calcAge(p);
        if (age != null) {
          const next = String(age);
          if (densityNum.textContent !== next) densityNum.textContent = next;
        }
      }
      g.setAttribute("aria-label", (FamilyStore.getField && FamilyStore.getField(p, "name")) || p.name);
    });
    // Era labels read birth years, which don't bust the topology signature, so
    // a soft update (e.g. editing a birth date) must repaint them. Topology is
    // unchanged, so lastPositions' geometry (row y, x) still holds — only refresh
    // the person objects so the medians reflect the just-edited years.
    if (lastPositions) {
      const fresh = new Map();
      lastPositions.forEach((pos, id) => {
        const p = byId.get(id);
        fresh.set(id, p ? Object.assign({}, pos, { person: p }) : pos);
      });
      drawEraLabels(fresh);
    }
  }

  // Sync the toolbar undo/redo disabled state to the store's history. Called at
  // the very top of render() (which runs on every store change AND on view
  // activation) so it stays fresh even when the topology signature is unchanged
  // and the render short-circuits below. The app.js keyboard handler consults
  // the same FamilyStore.canUndo/canRedo, so buttons and shortcuts never drift.
  function refreshUndoRedo() {
    if (undoBtnEl) undoBtnEl.disabled = !(FamilyStore.canUndo && FamilyStore.canUndo());
    if (redoBtnEl) redoBtnEl.disabled = !(FamilyStore.canRedo && FamilyStore.canRedo());
  }

  function render() {
    if (!svgEl) return;
    refreshUndoRedo();

    // Remove any prior empty-state overlay
    const prior = stageEl.querySelector(".tree-empty-overlay");
    if (prior) prior.remove();

    // If the focused person was just deleted, clear the sticky focus so
    // the highlight code doesn't try to walk a broken graph.
    if (lineageFocusId && !FamilyStore.getPerson(lineageFocusId)) {
      lineageFocusId = null;
    }
    // In focus mode, keep focusId pointing at a living person in the ACTIVE tree.
    // syncFocusToActiveTree() drops a centre carried over from another tree (per-
    // tree key); resolveFocusId() then re-picks a default if it's unset/deleted.
    // Persist any change so a reload is consistent.
    if (treeMode === "focus") {
      syncFocusToActiveTree();
      const resolved = resolveFocusId();
      if (resolved !== focusId) { focusId = resolved; writeFocusId(focusId); }
    }
    // Same guard for the relationship-path anchors (#94): if either endpoint
    // was deleted, drop the whole comparison so applyHighlightClasses doesn't
    // paint a stale path. An edit that changes the graph can also invalidate
    // the chain, so recompute when both anchors still exist.
    if (pathAId && !FamilyStore.getPerson(pathAId)) resetComparePathState();
    if (pathBId && !FamilyStore.getPerson(pathBId)) resetComparePathState();
    if (pathAId && pathBId) {
      const fresh = FamilyStore.findRelationPath(pathAId, pathBId);
      if (fresh && fresh.length >= 2) buildPathSets(fresh);
      else resetComparePathState();
    }
    updateCompareBtn();
    updateModeBtn();

    const allPeople = FamilyStore.getPeople();
    const basePeople = showPets ? allPeople : allPeople.filter((p) => !p.isPet);
    // Focus mode prunes the drawn set to the ego's degree-of-interest spine
    // (focusVisibleSet). Everyone else is folded away — counted here for the
    // subtitle cue, and (in a later phase) shown as cluster nodes. Full mode
    // keeps the whole set, so `people` is exactly basePeople and computeLayout
    // sees no difference. This is the pruning SEAM: computeLayout itself is
    // never focus-aware — it just lays out whichever array it's handed.
    let people = basePeople;
    focusHiddenCount = 0;
    focusKeepSet = null;
    focusFoldedIds = null;
    if (treeMode === "focus" && focusId) {
      const { keep } = focusVisibleSet(focusId);
      // Reveal any expanded clusters: add their members back into the kept set
      // so they lay out as REAL nodes, not a stack. Buckets are computed over
      // the base folded set (base minus the DOI spine) so a key stays stable;
      // stale expanded keys (cluster no longer exists after a re-center) are
      // dropped so they can't leak members or bust the signature forever.
      if (expandedClusters.size) {
        const baseFolded = basePeople.filter((p) => !keep.has(p.id)).map((p) => p.id);
        const baseBuckets = bucketizeFolded(keep, baseFolded);
        const live = new Set();
        expandedClusters.forEach((key) => {
          const b = baseBuckets.get(key);
          if (b) { live.add(key); b.members.forEach((id) => keep.add(id)); }
        });
        if (live.size !== expandedClusters.size) expandedClusters = live;
      }
      const pruned = basePeople.filter((p) => keep.has(p.id));
      // Guard: never blank the canvas. If the walk somehow kept nobody (e.g. a
      // transient state where the ego isn't in basePeople), fall back to the
      // full set rather than render an empty tree.
      if (pruned.length) {
        focusHiddenCount = basePeople.length - pruned.length;
        people = pruned;
        focusKeepSet = keep;
        // Ids folded away = base set minus the kept spine (post-expansion).
        // drawClusters re-buckets these against their nearest visible anchor;
        // expanded clusters are now in `keep`, so they won't re-appear as stacks.
        focusFoldedIds = basePeople.filter((p) => !keep.has(p.id)).map((p) => p.id);
      }
    } else {
      // Not in focus mode → no expanded clusters carry meaning; reset so a stale
      // expansion doesn't linger and silently bust the full-mode signature.
      if (expandedClusters.size) expandedClusters = new Set();
    }
    const state = FamilyStore.getState();
    const sig = topoSignature(people, state.marriages || {},
      // View toggles that change DOM structure (chip presence, dates row)
      // need to bust the cache. showPets removes pets from layout entirely;
      // showAge + showDates add/remove SVG children per node.
      // Focus-mode descriptor (mode + centre) is folded in too: switching modes
      // or re-centring the focus view changes which people are drawn and how
      // they're laid out, so the gated-render cache must never skip that rebuild.
      // In full mode the tail is the constant "|full|", so the signature stays
      // stable render-to-render (no spurious rebuilds) and — since `people` and
      // computeLayout are untouched in full mode — the drawn output is identical
      // to pre-focus-mode. (The tail shifts the string once vs. the old format,
      // a one-time rebuild already covered by the CACHE_VERSION bump.)
      [showPets ? 1 : 0, showAge ? 1 : 0, showDates ? 1 : 0].join(",")
        + "|" + treeMode + "|" + (treeMode === "focus" ? (focusId || "") : "")
        // Expanded clusters change which people are drawn as real nodes, so an
        // expand/collapse must bust the layout cache. Sorted for stability.
        + "|" + (treeMode === "focus" ? Array.from(expandedClusters).sort().join(".") : ""));
    const sigStable = sig === lastTopoSig && nodesG.childElementCount > 0;
    lastTopoSig = sig;

    if (sigStable) {
      // Topology hasn't changed — patch cosmetic bits in place. Header /
      // age badge / dates still need a refresh, but no layout, no DOM
      // rebuild, no edges.
      if (rootEl && rootEl.__renderTitle) rootEl.__renderTitle();
      updateSubtitle(people);
      softUpdateNodes(people);
      applyHighlightClasses();
      // Nodes survived intact, so prior chips are still on them — let the
      // signature guard decide whether anything (gender/year/lang/anchor)
      // actually changed before re-walking paths.
      decorateSelf();
      return;
    }

    // A live cluster peek points at nodes we're about to destroy — tear it down
    // before the rebuild so it can't dangle over a re-laid-out canvas.
    hideClusterPeek();
    UI.clear(edgesG);
    UI.clear(nodesG);
    if (knotsG) UI.clear(knotsG);
    if (labelsG) UI.clear(labelsG);

    // Update title (family name may have changed) + subtitle counts
    if (rootEl && rootEl.__renderTitle) rootEl.__renderTitle();
    updateSubtitle(people);

    if (people.length === 0) {
      // Wrapped in a centring overlay because the SVG canvas it floats over
      // is positioned absolutely; the inner UI.emptyState carries the visual.
      // z-index: 2 — the SVG underneath has `z-index: 1` (see views.css
       // .tree-svg), so without an explicit stack on the overlay the SVG
       // wins event capture and the CTA button's click never fires even
       // though it's painted on top. Outer wrapper still has
       // `pointer-events: none` so the canvas below stays interactive
       // around the card; only the .empty card opts back in.
      const empty = UI.el("div", {
        class: "tree-empty-overlay",
        style: {
          position: "absolute", inset: "0",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "24px", pointerEvents: "none",
          zIndex: "2"
        }
      }, [
        UI.emptyState({
          icon: "fa-solid fa-tree",
          title: I18n.t("tree.emptyTitle"),
          text: I18n.t("tree.emptyText"),
          // Inline CTA — the rail is hidden on phones, so the rail "add"
          // button gives mobile users no path. A button right here is a
          // one-tap rescue for any viewport.
          cta: {
            label: I18n.t("actions.addFirst") || "Add your first relative",
            icon: "fa-solid fa-user-plus",
            style: { marginTop: "16px" },
            onClick: () => {
              if (window.PeopleView && PeopleView.openForm) PeopleView.openForm(null);
            }
          },
          style: { pointerEvents: "auto", background: "var(--bg-elev)" }
        })
      ]);
      stageEl.appendChild(empty);
      return;
    }

    const positions = computeLayout(people);
    // Focus-only refinement: nudge parents over children (and vice-versa), then
    // de-overlap each row. No-op in full mode — keeps the whole-tree layout as-is.
    if (treeMode === "focus" && focusId) focusLayoutPass(positions);
    lastPositions = positions;
    drawEraLabels(positions);
    drawEdges(positions);
    drawNodes(positions);
    // Explicitly-unknown parents render as dashed placeholder "nodes" in the
    // row above their child. Drawn as a pure overlay pass AFTER real nodes/edges
    // so that lastPositions, soft-update, filter/highlight, revealPerson, and
    // the export strip all keep operating on real people only — the phantoms
    // carry their own .t-phantom-* classes and never a data-person-id.
    drawPhantomParents(positions);
    // Focus-mode: fold the pruned-away kin into stacked cluster overlays,
    // anchored to their nearest visible relative. Same overlay contract as
    // phantoms (.t-node-cluster, no data-person-id, own pass). No-op in full mode.
    drawClusters(positions);

    const bbox = computeBBox(positions);
    lastBBox = bbox;

    if (!userInteracted || !isViewBoxReasonable(viewBox, bbox)) {
      viewBox = fitViewBox(bbox);
      applyViewBox();
    } else {
      applyViewBox();
    }

    applyFilterClasses();
    applyHighlightClasses();
    // Nodes were just rebuilt, so any prior chips are gone — force past the
    // signature guard to repaint them onto the fresh DOM.
    decorateSelf(true);

    maybeShowTouchMenuHint();
  }

  // ===== Layout =====
  function computeLayout(people) {
    const gen = FamilyStore.buildGenerations();
    const byId = new Map(people.map((p) => [p.id, p]));

    // Group by generation
    const rows = new Map();
    people.forEach((p) => {
      const g = gen.get(p.id) || 0;
      if (!rows.has(g)) rows.set(g, []);
      rows.get(g).push(p);
    });

    const sortedGens = Array.from(rows.keys()).sort((a, b) => a - b);

    // Sort gen 0 by birth year. For subsequent generations, sort children
    // by their parents' positions in the previous generation so cousin
    // groups stay together (otherwise interleaving by birth year scatters
    // siblings across the row and rails cross over each other).
    function birthYearCmp(a, b) {
      const ya = FamilyStore.getYear(a.birthDate);
      const yb = FamilyStore.getYear(b.birthDate);
      if (ya == null && yb == null) return a.name.localeCompare(b.name);
      if (ya == null) return 1;
      if (yb == null) return -1;
      return ya - yb;
    }
    if (sortedGens.length) {
      rows.get(sortedGens[0]).sort(birthYearCmp);
    }

    // Place couples adjacently within each row, and record which adjacent
    // PAIRS are partners. We do this iteratively gen by gen because the
    // ordering of gen N+1 depends on gen N's placement.
    const placedOrder = new Map();        // gen -> [personId, ...]
    const placedIndex = new Map();        // personId -> { gen, index }
    const coupleAdjacency = new Map();    // gen -> Set<i> (left of a couple pair)
    const coParentAdjacency = new Map();  // gen -> Set<i> (left of a co-parent pair)

    // Who shares a child with whom. Two people are co-parents if they both
    // appear in some child's `parents`. This is what lets an UNMARRIED pair
    // (not each other's spouse) still read as a parental unit: we place them
    // adjacently and draw a neutral connector bar so their shared child's trunk
    // drops from between them instead of out of an empty gap. Spouse pairs are
    // filtered out at read time — those already pair as a couple (knot).
    const coParents = new Map(); // personId -> Set<personId>
    people.forEach((child) => {
      const par = (child.parents || []).filter((pid) => byId.has(pid));
      for (let i = 0; i < par.length; i++) {
        for (let j = i + 1; j < par.length; j++) {
          if (!coParents.has(par[i])) coParents.set(par[i], new Set());
          if (!coParents.has(par[j])) coParents.set(par[j], new Set());
          coParents.get(par[i]).add(par[j]);
          coParents.get(par[j]).add(par[i]);
        }
      }
    });
    function coParentOf(p) {
      const set = coParents.get(p.id);
      if (!set) return [];
      return Array.from(set).filter((id) => !(p.spouses || []).includes(id));
    }

    function placeRow(g) {
      const row = rows.get(g);
      const placed = new Set();
      const order = [];
      const pairs = new Set();
      const coPairs = new Set();
      row.forEach((p) => {
        if (placed.has(p.id)) return;
        order.push(p.id);
        placed.add(p.id);
        // A spouse partner in this gen wins — the pair renders as a tight,
        // overlapping couple with the gold knot between the photos.
        const spouseInGen = p.spouses.find((sid) => {
          const s = byId.get(sid);
          return s && (gen.get(sid) === g) && !placed.has(sid);
        });
        if (spouseInGen) {
          pairs.add(order.length - 1);
          order.push(spouseInGen);
          placed.add(spouseInGen);
          return;
        }
        // Otherwise pull an unmarried co-parent adjacent so their shared child
        // hangs from between them. Looser gap than a couple, no knot.
        const coParentInGen = coParentOf(p).find((cid) => {
          const c = byId.get(cid);
          return c && (gen.get(cid) === g) && !placed.has(cid);
        });
        if (coParentInGen) {
          coPairs.add(order.length - 1);
          order.push(coParentInGen);
          placed.add(coParentInGen);
        }
      });
      placedOrder.set(g, order);
      coupleAdjacency.set(g, pairs);
      coParentAdjacency.set(g, coPairs);
      order.forEach((id, i) => placedIndex.set(id, { gen: g, index: i }));
    }

    if (sortedGens.length) placeRow(sortedGens[0]);

    // For every subsequent generation, sort children by the position of
    // their leftmost parent in the previous gen, then by birth year.
    // For pets, use their owners as the anchor — they sit alongside the
    // owners' actual children in the layout.
    function parentAnchorIndex(person) {
      let best = Infinity;
      const anchors = person.isPet && (person.petOwners || []).length
        ? person.petOwners
        : person.parents;
      anchors.forEach((pid) => {
        const idx = placedIndex.get(pid);
        if (idx && idx.index < best) best = idx.index;
      });
      return best === Infinity ? Infinity : best;
    }
    for (let i = 1; i < sortedGens.length; i++) {
      const g = sortedGens[i];
      rows.get(g).sort((a, b) => {
        const ai = parentAnchorIndex(a);
        const bi = parentAnchorIndex(b);
        if (ai !== bi) return ai - bi;
        return birthYearCmp(a, b);
      });
      placeRow(g);
    }

    function gapBefore(g, indexOfRight) {
      // indexOfRight is the index of the right node of the gap. The couple /
      // co-parent marker is stored on the index of the LEFT node of a pair —
      // i.e. the gap between i and i+1 is a couple iff coupleAdjacency.has(i),
      // a co-parent unit iff coParentAdjacency.has(i).
      const left = indexOfRight - 1;
      if (coupleAdjacency.get(g).has(left)) return X_GAP_COUPLE;
      if (coParentAdjacency.get(g).has(left)) return X_GAP_COPARENT;
      return X_GAP_SIBLING;
    }

    // Compute per-row width and find widest
    const rowWidths = new Map();
    let maxRowW = 0;
    placedOrder.forEach((order, g) => {
      let w = order.length ? NODE_W : 0;
      for (let i = 1; i < order.length; i++) w += gapBefore(g, i) + NODE_W;
      rowWidths.set(g, w);
      if (w > maxRowW) maxRowW = w;
    });

    // Generate positions, centering each row
    const positions = new Map();
    sortedGens.forEach((g, rIdx) => {
      const order = placedOrder.get(g);
      const rowW = rowWidths.get(g);
      const offsetX = (maxRowW - rowW) / 2;
      const y = rIdx * (NODE_H + Y_GAP);
      let cursor = offsetX;
      order.forEach((id, i) => {
        if (i > 0) cursor += gapBefore(g, i);
        positions.set(id, { x: cursor, y, person: byId.get(id), gen: g, rowIdx: rIdx });
        cursor += NODE_W;
      });
    });

    // Derive the adjacent co-parent id-pairs for drawEdges. The adjacency Set
    // holds the LEFT index of each pair within that gen's placed order.
    coParentPairsLayout = [];
    coParentAdjacency.forEach((leftIdxs, g) => {
      const order = placedOrder.get(g) || [];
      leftIdxs.forEach((i) => {
        if (order[i] && order[i + 1]) coParentPairsLayout.push({ a: order[i], b: order[i + 1] });
      });
    });

    return positions;
  }

  // ===== Focus-mode layout refinement (Approach-B phase 1) =====
  // A POST-PASS that nudges x-coordinates so parents sit over their children
  // and vice-versa, then guarantees no in-row overlap. Runs ONLY in focus mode,
  // over the already-pruned (small) positions map — computeLayout is never
  // touched, so full-tree layout is byte-for-byte unchanged.
  //
  // Why a post-pass and not a rewrite of computeLayout: computeLayout centres
  // each row independently (offsetX = (maxRowW - rowW)/2) with no per-subtree
  // width reservation, so in a sparse tree a parent with two children can end
  // up far to the side of them. Relaxing toward the child/parent centroid fixes
  // that; the per-row sweep then removes any overlap the nudge introduced.
  //
  // Units: couples and adjacent co-parents move together (they share the tight
  // X_GAP_COUPLE / X_GAP_COPARENT spacing and a knot between them). Everyone
  // else is a unit of one. Only x changes — y, rowIdx, gen and the person ref
  // are left exactly as computeLayout set them.
  function focusLayoutPass(positions) {
    if (!positions || positions.size < 2) return;
    try {
      // Rows, each as an id list sorted left-to-right by current x.
      const rows = new Map();
      positions.forEach((pos, id) => {
        if (!rows.has(pos.rowIdx)) rows.set(pos.rowIdx, []);
        rows.get(pos.rowIdx).push(id);
      });
      rows.forEach((ids) => ids.sort((a, b) => positions.get(a).x - positions.get(b).x));
      const rowIdxs = Array.from(rows.keys()).sort((a, b) => a - b);

      const isCouple = (a, b) => (positions.get(a).person.spouses || []).includes(b);
      const isCoParent = (a, b) => coParentPairsLayout.some(
        (pr) => (pr.a === a && pr.b === b) || (pr.a === b && pr.b === a));
      const visChildren = (id) => FamilyStore.getChildrenOf(id).filter((c) => positions.has(c.id)).map((c) => c.id);
      const visParents = (id) => (positions.get(id).person.parents || []).filter((pid) => positions.has(pid));

      // Partition a row's sorted ids into units (contiguous couple/co-parent
      // pairs group; the rest are singletons). computeLayout already places
      // partners adjacently, so a pair is always two neighbours in the list.
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
      function unitCenter(u) { let s = 0; u.forEach((id) => (s += centerOf(id))); return s / u.length; }
      function moveUnitTo(u, cx) { const dx = cx - unitCenter(u); u.forEach((id) => (positions.get(id).x += dx)); }
      // Left-to-right sweep: push each unit right just enough that its left edge
      // clears the previous unit's right edge by a sibling gap. Only ever pushes
      // right, so it removes overlap without changing left-to-right order.
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
      function centroid(ids) { let s = 0; ids.forEach((id) => (s += centerOf(id))); return ids.length ? s / ids.length : null; }

      // Bounded relaxation: alternate pulling children under their parents'
      // centroid (top rows down) and parents over their children's centroid
      // (bottom rows up), sweeping each row after it moves. A handful of passes
      // settle a focus-sized tree; each pass is O(nodes).
      const ITERS = 4;
      for (let it = 0; it < ITERS; it++) {
        for (let r = 1; r < rowIdxs.length; r++) {
          const units = unitsOf(rows.get(rowIdxs[r]));
          units.forEach((u) => {
            const ps = []; u.forEach((id) => visParents(id).forEach((pid) => ps.push(pid)));
            const c = centroid(ps); if (c != null) moveUnitTo(u, c);
          });
          sweepUnits(units);
        }
        for (let r = rowIdxs.length - 2; r >= 0; r--) {
          const units = unitsOf(rows.get(rowIdxs[r]));
          units.forEach((u) => {
            const cs = []; u.forEach((id) => visChildren(id).forEach((cid) => cs.push(cid)));
            const c = centroid(cs); if (c != null) moveUnitTo(u, c);
          });
          sweepUnits(units);
        }
      }
    } catch (e) {
      // Any anomaly: leave the computeLayout positions untouched. They're valid
      // (non-overlapping, centred rows) — just not refined. Never break render.
      if (window.console) console.error("focusLayoutPass failed, using base layout", e);
    }
  }

  // ===== Edges =====
  function drawEdges(positions) {
    const drawnCouples = new Set();

    // Couple marker — gold rings sitting at the seam between the two photos.
    // With photos touching, the knot reads as a wedding band. Clicking it
    // opens a small marriage-details popover.
    positions.forEach((pos, id) => {
      const person = pos.person;
      person.spouses.forEach((sid) => {
        const sp = positions.get(sid);
        if (!sp) return;
        if (sp.rowIdx !== pos.rowIdx) return;
        const key = id < sid ? id + "|" + sid : sid + "|" + id;
        if (drawnCouples.has(key)) return;
        drawnCouples.add(key);

        const left  = (pos.x < sp.x ? pos : sp);
        const right = (pos.x < sp.x ? sp : pos);
        const cx = (left.x + NODE_W + right.x) / 2;
        const cy = Math.max(left.y, right.y) + PHOTO_CY;
        const leftId = left.person.id;
        const rightId = right.person.id;

        const openKnot = (ev) => {
          ev.stopPropagation();
          showMarriageModal(left.person, right.person);
        };
        const knot = svgEl_("g", {
          class: "t-couple-knot",
          "data-couple-key": key,
          "data-left-id": leftId,
          "data-right-id": rightId,
          // Keyboard-reachable: Tab lands on the knot, Enter/Space opens the
          // wedding record — the mouse-only gold dot was invisible to keyboard
          // and screen-reader users.
          tabindex: "0",
          role: "button",
          "aria-label": I18n.t("inspector.marriageDetails") + " · "
            + (FamilyStore.getField(left.person, "name") || left.person.name) + " & "
            + (FamilyStore.getField(right.person, "name") || right.person.name),
          style: { cursor: "pointer" },
          onclick: openKnot,
          onkeydown: (ev) => {
            if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openKnot(ev); }
          }
        });
        // Wider invisible hit target so the knot is easy to click. On coarse
        // pointers grow it to a 44px-diameter touch target (r22).
        knot.appendChild(svgEl_("circle", {
          cx, cy, r: isCoarsePointer() ? 22 : 14, fill: "transparent", stroke: "transparent",
          class: "t-couple-knot__hit"
        }));
        // Wedding emblem — render the supplied wedding-rings.svg directly.
        const KNOT_SIZE = 22;
        const wedImg = svgEl_("image", {
          class: "t-couple-knot__icon",
          href: "assets/wedding-rings.svg",
          x: cx - KNOT_SIZE / 2,
          y: cy - KNOT_SIZE / 2,
          width: KNOT_SIZE,
          height: KNOT_SIZE,
          preserveAspectRatio: "xMidYMid meet"
        });
        wedImg.setAttributeNS(XLINK_NS, "href", "assets/wedding-rings.svg");
        knot.appendChild(wedImg);
        (knotsG || edgesG).appendChild(knot);
      });
    });

    // Co-parent bar — a neutral, knot-less connector between two people who
    // share a child but aren't married. computeLayout has already placed them
    // adjacently (X_GAP_COPARENT); this spans the gap between their photo rings
    // at portrait height so their shared child's trunk reads as descending from
    // a joined unit, not out of empty space. Deliberately a plain .t-edge (the
    // structural ink colour), NOT gold — gold + the knot are reserved for
    // marriage. Tagged with both ids so lineage / compare focus fades it in
    // lockstep with the rest of the skeleton.
    coParentPairsLayout.forEach(({ a, b }) => {
      const pa = positions.get(a);
      const pb = positions.get(b);
      if (!pa || !pb) return;
      if (pa.rowIdx !== pb.rowIdx) return;
      const left  = pa.x < pb.x ? pa : pb;
      const right = pa.x < pb.x ? pb : pa;
      const x1 = left.x + NODE_W / 2 + PHOTO_R;   // right edge of left photo
      const x2 = right.x + NODE_W / 2 - PHOTO_R;  // left edge of right photo
      const y = Math.max(left.y, right.y) + PHOTO_CY;
      if (x2 <= x1) return; // photos overlap — no room for a bar, skip cleanly
      edgesG.appendChild(svgEl_("path", {
        class: "t-edge t-edge--coparent",
        d: `M ${x1} ${y} L ${x2} ${y}`,
        "data-edge-ids": [a, b].join(",")
      }));
    });

    // Parent -> child edges
    //
    // Group children by their parent-set (sorted parent ids). For each group:
    //   - draw ONE vertical drop from the parents' anchor point
    //   - draw ONE shared horizontal rail at the midpoint between the
    //     parents' bottom and the children's top
    //   - draw ONE vertical riser per child from the rail to the child top
    //   - round all corners with small quadratic-curve fillets
    //
    // This avoids the "stack of overlapping L-paths" that produced the messy
    // tangle when each child got its own copy of the rail.
    const groups = new Map(); // key = sorted parent ids → { parents, children }
    positions.forEach((pos) => {
      const person = pos.person;
      // Pets borrow their owners as "parents" for layout purposes — same
      // group, same trunk, same rail, but the riser into the pet is
      // marked .is-pet so CSS dashes it.
      const anchorIds = person.isPet && (person.petOwners || []).length
        ? person.petOwners
        : person.parents;
      const placedParents = anchorIds
        .map((pid) => positions.get(pid))
        .filter(Boolean);
      if (placedParents.length === 0) return;
      const key = placedParents.map((pp) => pp.person.id).sort().join("|");
      if (!groups.has(key)) groups.set(key, { parents: placedParents, children: [] });
      groups.get(key).children.push(pos);
    });

    const R = 10; // corner fillet radius

    function fillet(x1, y1, x2, y2, x3, y3, r) {
      // Round the corner at (x2, y2) given the line from (x1,y1) and onward to
      // (x3,y3). Returns the path commands "L … Q …" that approximate the
      // rounded corner, where the move-to (M) is assumed to already be set
      // by the caller.
      const v1 = sub(x1, y1, x2, y2);
      const v2 = sub(x3, y3, x2, y2);
      const len1 = Math.hypot(v1.x, v1.y);
      const len2 = Math.hypot(v2.x, v2.y);
      const k = Math.min(r, len1 / 2, len2 / 2);
      const a = { x: x2 + (v1.x / len1) * k, y: y2 + (v1.y / len1) * k };
      const b = { x: x2 + (v2.x / len2) * k, y: y2 + (v2.y / len2) * k };
      return `L ${a.x} ${a.y} Q ${x2} ${y2}, ${b.x} ${b.y}`;
    }
    function sub(ax, ay, bx, by) { return { x: ax - bx, y: ay - by }; }

    groups.forEach(({ parents: pp, children: cc }) => {
      const parentIds = pp.map((x) => x.person.id);
      const childIds = cc.map((x) => x.person.id);
      const groupIds = parentIds.concat(childIds).join(",");
      let anchorX, anchorY;
      if (pp.length === 2 && pp[0].rowIdx === pp[1].rowIdx) {
        const left  = pp[0].x < pp[1].x ? pp[0] : pp[1];
        const right = pp[0].x < pp[1].x ? pp[1] : pp[0];
        anchorX = (left.x + NODE_W + right.x) / 2;
        anchorY = Math.max(pp[0].y, pp[1].y) + NODE_H;
      } else if (pp.length === 2) {
        anchorX = (pp[0].x + pp[1].x) / 2 + NODE_W / 2;
        anchorY = Math.max(pp[0].y, pp[1].y) + NODE_H;
      } else {
        anchorX = pp[0].x + NODE_W / 2;
        anchorY = pp[0].y + NODE_H;
      }

      // Sort children left-to-right. Humans get the standard solid trunk +
      // rail + risers. Pets get a dedicated dashed connector each so the
      // pet-bond reads as fully dotted end-to-end (trunk → corner → riser),
      // not just the riser portion.
      const ordered = cc.slice().sort((a, b) => a.x - b.x);
      const orderedHumans = ordered.filter((cpos) => !cpos.person.isPet);
      const orderedPets = ordered.filter((cpos) => cpos.person.isPet);

      const allChildTops = ordered.map((c) => ({ x: c.x + NODE_W / 2, y: c.y }));
      const railY = (anchorY + allChildTops[0].y) / 2;

      // Solid trunk + rail + risers serve the human children. If there are
      // no humans (group is all-pets), skip them — every pet gets its own
      // dashed path below.
      if (orderedHumans.length) {
        const humanTops = orderedHumans.map((c) => ({ x: c.x + NODE_W / 2, y: c.y }));

        // Trunk: from parent anchor down to the rail
        const trunk = `M ${anchorX} ${anchorY} L ${anchorX} ${railY}`;
        edgesG.appendChild(svgEl_("path", { class: "t-edge", d: trunk, "data-edge-ids": groupIds, "data-edge-parents": parentIds.join(",") }));

        // Per-child riser radius — same formula every child uses (defines
        // where the rail-to-riser curve enters the rail). We need this to
        // clip the rail's extreme ends so the rail ends at the curve's
        // entry point rather than overshooting it.
        function riserRadius(cx) {
          const dx = Math.abs(cx - anchorX);
          return Math.min(R, Math.max(2, dx / 2));
        }
        // Horizontal rail, split into per-child segments. A SINGLE spanning
        // rail tagged with the whole sibling group faded out entirely the
        // moment ONE sibling fell outside a lineage focus — which hid the
        // focused child's own link up to their parents whenever those parents
        // had other children (focus a person → the line above them vanishes).
        // Splitting at every "post" (the trunk at anchorX + each child's riser
        // point) and tagging each segment with only the children whose
        // through-line crosses it lets the paint pass light just the in-lineage
        // portion. Extreme ends are still clipped to the riser-curve entry so
        // the rail doesn't overshoot into a corner; the trunk side (anchorX) is
        // a hard T-junction, never clipped. Interior boundaries are exact post
        // positions, so adjacent segments meet with no gap or overlap.
        const childMinX = Math.min(...humanTops.map((c) => c.x));
        const childMaxX = Math.max(...humanTops.map((c) => c.x));
        const posts = Array.from(new Set([anchorX].concat(humanTops.map((c) => c.x)))).sort((a, b) => a - b);
        for (let s = 0; s < posts.length - 1; s++) {
          const ps = posts[s], pe = posts[s + 1];
          // Children whose through-line (parents → trunk → rail → riser) crosses
          // this segment: those on its far side from the trunk. A child at cx
          // uses the rail span between anchorX and cx, so segment [ps,pe] serves
          // it iff [ps,pe] lies within that span.
          const segChildIds = orderedHumans.filter((cpos, i) => {
            const cx = humanTops[i].x;
            if (cx > anchorX) return ps >= anchorX && pe <= cx;
            if (cx < anchorX) return ps >= cx && pe <= anchorX;
            return false; // child directly under the trunk uses no rail
          }).map((cpos) => cpos.person.id);
          // Clip only the two outermost ends (toward the corner curves).
          let drawL = ps, drawR = pe;
          if (ps === childMinX && childMinX < anchorX) drawL = childMinX + riserRadius(childMinX);
          if (pe === childMaxX && childMaxX > anchorX) drawR = childMaxX - riserRadius(childMaxX);
          if (drawL >= drawR) continue;
          edgesG.appendChild(svgEl_("path", {
            class: "t-edge",
            d: `M ${drawL} ${railY} L ${drawR} ${railY}`,
            "data-edge-ids": parentIds.concat(segChildIds).join(","),
            "data-edge-parents": parentIds.join(",")
          }));
        }

        // Risers, one per human child.
        orderedHumans.forEach((cpos, i) => {
          const c = humanTops[i];
          const riserIds = parentIds.concat([cpos.person.id]).join(",");
          const r = riserRadius(c.x);
          const sign = c.x === anchorX ? 0 : (c.x > anchorX ? 1 : -1);
          if (sign === 0) {
            edgesG.appendChild(svgEl_("path", {
              class: "t-edge",
              "data-edge-ids": riserIds,
              d: `M ${c.x} ${railY} L ${c.x} ${c.y}`
            }));
          } else {
            const enter = c.x - sign * r;
            edgesG.appendChild(svgEl_("path", {
              class: "t-edge",
              "data-edge-ids": riserIds,
              d: `M ${enter} ${railY} Q ${c.x} ${railY}, ${c.x} ${railY + r} L ${c.x} ${c.y}`
            }));
          }
        });
      }

      // Pets get their own dashed end-to-end path: trunk segment from the
      // parents' anchor down + rail segment across to the pet's column +
      // riser down to the pet, all in one stroke so the dash pattern is
      // continuous rather than restarting at each segment boundary.
      orderedPets.forEach((cpos) => {
        const c = { x: cpos.x + NODE_W / 2, y: cpos.y };
        const riserIds = parentIds.concat([cpos.person.id]).join(",");
        const dx = Math.abs(c.x - anchorX);
        const r = Math.min(R, Math.max(2, dx / 2));
        const sign = c.x === anchorX ? 0 : (c.x > anchorX ? 1 : -1);
        let d;
        if (sign === 0) {
          // Pet sits directly under the anchor — straight drop.
          d = `M ${anchorX} ${anchorY} L ${anchorX} ${c.y}`;
        } else {
          // Anchor → straight down to (railY - r) → quadratic corner → rail
          // segment to (c.x - sign*r) → quadratic corner → straight down
          // into the pet. One continuous path so the dash pattern is
          // seamless across both corners.
          const railEnter = c.x - sign * r;
          d = `M ${anchorX} ${anchorY}`
            + ` L ${anchorX} ${railY - r}`
            + ` Q ${anchorX} ${railY}, ${anchorX + sign * r} ${railY}`
            + ` L ${railEnter} ${railY}`
            + ` Q ${c.x} ${railY}, ${c.x} ${railY + r}`
            + ` L ${c.x} ${c.y}`;
        }
        edgesG.appendChild(svgEl_("path", {
          class: "t-edge t-edge--pet",
          "data-edge-ids": riserIds,
          d
        }));
      });
    });
  }

  // Apply the avatar crop focal point to a tree-node <image>.
  //
  // SVG <image> can't express an arbitrary object-position — preserveAspectRatio
  // only anchors Min/Mid/Max — and it exposes no intrinsic dimensions. So, ONLY
  // when a non-trivial crop exists, we decode the photo to learn its aspect
  // ratio and size the <image> box to a cover-fit that lands the focal point at
  // the circle centre, then switch to preserveAspectRatio="none" (no distortion:
  // the box keeps the image's aspect). This mirrors the canvas math in
  // image-export.js exportFullProfile so tree / People / Timeline / Profile all
  // frame the same face. <foreignObject>+<img object-position> is NOT an option:
  // the tree SVG is serialised to data:image/svg+xml and rasterised for export,
  // where foreignObject content doesn't render.
  //
  // The clip circle lives in the same user space and is independent of the image
  // box, so it stays put while the box shifts underneath. Trivial crops keep the
  // default synchronous xMidYMid-slice geometry (already set on the element) —
  // zero decode, byte-for-byte unchanged. drawNodes runs per-layout, not per
  // pan/zoom frame, so the one-time decode is cheap. The exported PNG inherits
  // this geometry verbatim (inlineSvgImages only rewrites href).
  function applyNodePhotoCrop(img, person, cx, cy, r, url) {
    const crop = person && person.photoCropAvatar;
    if (!crop || !url) return;
    const nonTrivial = (crop.scale || 1) > 1.001
      || (crop.x ?? 50) !== 50
      || (crop.y ?? 50) !== 50;
    if (!nonTrivial) return;
    let done = false;
    const probe = new Image();
    const apply = function () {
      if (done) return;
      const iw = probe.naturalWidth, ih = probe.naturalHeight;
      if (!(iw > 0 && ih > 0)) return;
      done = true;
      const baseScale = Math.max((r * 2) / iw, (r * 2) / ih);
      const userScale = Math.max(1, crop.scale || 1);
      const dw = iw * baseScale * userScale;
      const dh = ih * baseScale * userScale;
      // Focal point at (crop.x%, crop.y%) of the image must land at (cx, cy);
      // then clamp so the box still covers the circle (no gaps at the rim).
      const x = Math.min(cx - r, Math.max(cx + r - dw, cx - dw * ((crop.x ?? 50) / 100)));
      const y = Math.min(cy - r, Math.max(cy + r - dh, cy - dh * ((crop.y ?? 50) / 100)));
      img.setAttribute("x", x);
      img.setAttribute("y", y);
      img.setAttribute("width", dw);
      img.setAttribute("height", dh);
      img.setAttribute("preserveAspectRatio", "none");
    };
    probe.onload = apply;
    probe.src = url;
    if (probe.complete) apply();
  }

  // ===== Nodes =====
  function drawNodes(positions) {
    // Index first-name collisions across everyone being drawn so nodeLabel()
    // can disambiguate with a surname initial.
    buildFirstNameIndex(Array.from(positions.values()).map((pos) => pos.person));
    positions.forEach((pos, id) => {
      const p = pos.person;
      const nodeAriaName = (FamilyStore.getField && FamilyStore.getField(p, "name")) || p.name;
      // Long-press tracking — phone has no right-click, so a 500 ms touch
      // hold opens the same node menu desktop gets via contextmenu. Tap
      // (released before the timer) still opens the inspector. A drag
      // (movement past 8 px) cancels both, so panning the tree is unaffected.
      let pressTimer = null;
      let pressOrigin = null;
      let longPressed = false;
      function clearPress() {
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
        pressOrigin = null;
      }
      const g = svgEl_("g", {
        class: "t-node",
        transform: `translate(${pos.x},${pos.y})`,
        "data-person-id": p.id,
        // Make every node keyboard-focusable: Tab walks them in render order
        // (which matches generation top-down, then sibling left-to-right),
        // Enter/Space opens the inspector. Without this, keyboard-only users
        // can't reach a person's profile from the tree at all.
        tabindex: "0",
        role: "button",
        "aria-label": nodeAriaName,
        style: { cursor: "pointer" },
        onclick: (ev) => {
          ev.stopPropagation();
          // Suppress the synthetic click that fires after a long-press —
          // otherwise iOS would open the inspector on top of the menu we
          // just summoned.
          if (longPressed) { longPressed = false; return; }
          // Relationship-path pick (#94): shift-click on desktop, or any tap
          // while "Compare" mode is armed (touch/keyboard). Routes to the
          // path picker instead of opening the inspector.
          if (ev.shiftKey || compareArmed) { handleComparePick(p.id); return; }
          // A plain click while a path overlay is showing dismisses it and
          // selects normally — otherwise the path-owns-highlight guard in
          // applyHighlightClasses would swallow the new selection.
          if (pathAId) { resetComparePathState(); updateCompareBtn(); }
          // Focus mode (D2): a plain tap on a NON-ego node brings that person to
          // the centre and re-prunes around them; tapping the already-centred
          // ego opens their profile. Full mode is unchanged — tap always opens
          // the inspector. The profile stays reachable for any focus-mode node
          // via the node menu's "View profile" item (long-press / right-click).
          if (treeMode === "focus" && focusId && p.id !== focusId) { recenterFocus(p.id); return; }
          if (window.Inspector) Inspector.show(p.id); else applyHighlightClasses();
        },
        onkeydown: (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            // Shift+Enter, or Enter while Compare is armed, picks a path anchor.
            if (ev.shiftKey || compareArmed) { handleComparePick(p.id); return; }
            if (pathAId) { resetComparePathState(); updateCompareBtn(); }
            if (treeMode === "focus" && focusId && p.id !== focusId) { recenterFocus(p.id); return; }
            if (window.Inspector) Inspector.show(p.id); else applyHighlightClasses();
          }
        },
        onfocus: () => {
          // Keyboard Tab can land focus on a node outside the visible viewBox
          // (nodes are focusable in DOM order, not screen order). Pan it into
          // view so focus is never invisible. Guarded to skip when focus was
          // moved programmatically during a pointer gesture.
          panIntoView(p.id);
        },
        oncontextmenu: (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          showNodeMenu(p, pos, ev);
        },
        onpointerdown: (ev) => {
          // Only react to primary pointer (touch / left mouse). Ignore
          // right-button presses — contextmenu handles those.
          if (ev.button && ev.button !== 0) return;
          longPressed = false;
          pressOrigin = { x: ev.clientX, y: ev.clientY };
          pressTimer = setTimeout(() => {
            longPressed = true;
            pressTimer = null;
            // Light haptic feedback on touch devices that support it.
            if (navigator.vibrate) try { navigator.vibrate(10); } catch (_) {}
            showNodeMenu(p, pos, ev);
          }, 500);
        },
        onpointermove: (ev) => {
          if (!pressOrigin) return;
          const dx = ev.clientX - pressOrigin.x;
          const dy = ev.clientY - pressOrigin.y;
          if (dx * dx + dy * dy > 64) clearPress(); // 8 px threshold
        },
        onpointerup: clearPress,
        onpointercancel: clearPress,
        onpointerleave: clearPress
      });

      // (No card rect — the photo IS the card. We add a soft white halo as a
      // drop-shadow approximation via a slightly larger backing circle.)
      const cx = NODE_W / 2;
      const cy = PHOTO_CY;
      g.appendChild(svgEl_("circle", {
        class: "t-node-photo-bg",
        cx, cy, r: PHOTO_R + 3
      }));

      const photoUrl = window.PhotoStore ? PhotoStore.getUrlSync(p) : p.photo;
      const displayName = FamilyStore.getField(p, "name") || p.name;
      if (photoUrl) {
        const clipId = "tnphoto-" + p.id;
        const defs = svgEl_("defs", {}, [
          svgEl_("clipPath", { id: clipId }, [
            svgEl_("circle", { cx, cy, r: PHOTO_R })
          ])
        ]);
        g.appendChild(defs);
        const img = svgEl_("image", {
          x: cx - PHOTO_R, y: cy - PHOTO_R,
          width: PHOTO_R * 2, height: PHOTO_R * 2,
          "clip-path": `url(#${clipId})`,
          preserveAspectRatio: "xMidYMid slice",
          href: photoUrl
        });
        img.setAttributeNS(XLINK_NS, "href", photoUrl);
        g.appendChild(img);
        applyNodePhotoCrop(img, p, cx, cy, PHOTO_R, photoUrl);
      } else if (window.PhotoStore && (p.photoId)) {
        // Async resolve, then patch in
        const clipId = "tnphoto-" + p.id;
        const defs = svgEl_("defs", {}, [
          svgEl_("clipPath", { id: clipId }, [
            svgEl_("circle", { cx, cy, r: PHOTO_R })
          ])
        ]);
        g.appendChild(defs);
        const img = svgEl_("image", {
          x: cx - PHOTO_R, y: cy - PHOTO_R,
          width: PHOTO_R * 2, height: PHOTO_R * 2,
          "clip-path": `url(#${clipId})`,
          preserveAspectRatio: "xMidYMid slice"
        });
        g.appendChild(img);
        // On an empty/failed resolve (a photoId whose blob isn't in this
        // device's IDB), drop the blank <image> and paint the initials disc —
        // otherwise the node shows an empty circle where a face should be.
        const fallbackToInitials = () => {
          if (img.parentNode === g) g.removeChild(img);
          appendPhotoInitials(g, cx, cy, displayName);
        };
        PhotoStore.getUrl(p).then((u) => {
          if (u) {
            img.setAttribute("href", u); img.setAttributeNS(XLINK_NS, "href", u);
            applyNodePhotoCrop(img, p, cx, cy, PHOTO_R, u);
          } else { fallbackToInitials(); }
        }).catch(fallbackToInitials);
      } else {
        appendPhotoInitials(g, cx, cy, displayName);
      }

      // Photo ring
      const ringClass = "t-node-photo-ring" + (FamilyStore.isDeceased(p) ? " t-node-photo-ring--deceased" : "");
      g.appendChild(svgEl_("circle", {
        class: ringClass,
        cx, cy, r: PHOTO_R
      }));

      // Tree shows only the first name — keeps couples readable when their
      // photos sit close, and the full name appears in the inspector / list /
      // hover title. When two rendered people share a first name we append a
      // surname initial so they're distinguishable on touch (where the hover
      // <title> never shows). Add a <title> child for the browser tooltip.
      const nameNode = svgEl_("text", {
        class: "t-node-name",
        "text-anchor": "middle",
        x: NODE_W / 2, y: PHOTO_CY + PHOTO_R + 22
      }, nodeLabel(p, displayName));
      // Add an SVG <title> for the native browser tooltip
      nameNode.appendChild(svgEl_("title", null, displayName));
      g.appendChild(nameNode);

      // Dates — softer subtitle. Hidden via the View Options popover when
      // the user wants the tree to read as just names + photos.
      if (showDates) {
        g.appendChild(svgEl_("text", {
          class: "t-node-dates",
          "text-anchor": "middle",
          x: NODE_W / 2, y: PHOTO_CY + PHOTO_R + 40
        }, formatYears(p)));
      }

      // Pet paw badge — small gold disc with a paw icon overlaying the
      // top-right of the photo ring. Plain SVG so it rasterises in PNG
      // exports.
      if (p.isPet) {
        const bx = NODE_W / 2 + PHOTO_R - 4;
        const by = PHOTO_CY - PHOTO_R + 4;
        g.appendChild(svgEl_("circle", { class: "t-node-pet-bg", cx: bx, cy: by, r: 11 }));
        // Paw glyph as a simple text element using the FA Unicode point.
        // Falls back gracefully if FA isn't loaded — the disc still shows.
        const paw = svgEl_("text", {
          class: "t-node-pet-paw",
          "text-anchor": "middle",
          x: bx, y: by + 4,
          "font-family": '"Font Awesome 6 Free"',
          "font-weight": "900",
          "font-size": "11"
        }, "");
        g.appendChild(paw);
      }

      // Age badge — top-left of the photo ring. Shows the person's age
      // (current age if living, age at death if not) so the tree reads ages
      // at a glance. Toggled in the View Options popover (persisted under
      // "virasat.showAge", migrated from the legacy "virasat.showStoryCount"),
      // and trimmed from the PNG export by the "Age" chip. calcAge returns null
      // with no or unparseable birth date, so undated people show no badge.
      const age = FamilyStore.calcAge(p);
      if (showAge && age != null) {
        const lbx = NODE_W / 2 - PHOTO_R + 4;
        const lby = PHOTO_CY - PHOTO_R + 4;
        g.appendChild(svgEl_("circle", { class: "t-node-density-bg", cx: lbx, cy: lby, r: 11 }));
        g.appendChild(svgEl_("text", {
          class: "t-node-density-num",
          "text-anchor": "middle",
          x: lbx, y: lby + 4,
          "font-size": "10",
          "font-weight": "700"
        }, String(age)));
      }

      // Add-relative affordance — a small "+" disc at the node's bottom-right
      // that opens the same node menu (add child / spouse / parent / edit).
      // The menu was previously discoverable only by right-click or long-press;
      // this makes "grow the tree from here" visible. Editor-only, and carries
      // .t-node-add so the PNG/print export strips it (see image-export clone).
      if (!(FamilyStore.isReadOnly && FamilyStore.isReadOnly())) {
        const abx = NODE_W / 2 + PHOTO_R - 4;
        const aby = PHOTO_CY + PHOTO_R - 4;
        const add = svgEl_("g", {
          class: "t-node-add",
          role: "button",
          tabindex: "0",
          "aria-label": I18n.t("tree.addRelativeAria", { name: displayName }),
          style: { cursor: "pointer" },
          onpointerdown: (ev) => { ev.stopPropagation(); },
          onclick: (ev) => {
            ev.stopPropagation();
            ev.preventDefault();
            showNodeMenu(p, pos, ev);
          },
          onkeydown: (ev) => {
            if (ev.key === "Enter" || ev.key === " ") {
              ev.preventDefault();
              ev.stopPropagation();
              showNodeMenu(p, pos, ev);
            }
          }
        });
        // On coarse pointers, an invisible 44px-diameter hit circle behind the
        // visible r11 disc so the touch target clears the 44px minimum without
        // enlarging the glyph. (transparent fill still receives pointer events.)
        if (isCoarsePointer()) {
          add.appendChild(svgEl_("circle", {
            class: "t-node-add-hit", cx: abx, cy: aby, r: 22,
            fill: "transparent", stroke: "transparent"
          }));
        }
        add.appendChild(svgEl_("circle", { class: "t-node-add-bg", cx: abx, cy: aby, r: 11 }));
        add.appendChild(svgEl_("text", {
          class: "t-node-add-plus",
          "text-anchor": "middle",
          x: abx, y: aby + 5,
          "font-size": "16", "font-weight": "700"
        }, "+"));
        add.appendChild(svgEl_("title", null, I18n.t("tree.addRelative")));
        g.appendChild(add);
      }

      nodesG.appendChild(g);
    });
  }

  // ===== Unknown-parent placeholders (layout phantoms) =====
  //
  // A person can carry `unknownParents` — roles ("father"/"mother") the family
  // has recorded as *actively unknown* (an adoption, a lost paternal line), as
  // opposed to simply not-yet-entered. We render each as a dashed placeholder
  // "node" sitting in the row above the child, connected by a dashed link.
  //
  // Crucially this is a PURE OVERLAY: phantoms are never in `positions`, never
  // carry a `data-person-id` or `data-edge-ids`, and use their own `.t-phantom-*`
  // classes. So softUpdateNodes, applyFilterClasses, applyHighlightClasses,
  // lineageOf, revealPerson, the couple/edge indices, and the export focus-strip
  // all skip them automatically — every real-people data structure is untouched.
  // They ARE inside .tree-edges / .tree-nodes, so computeBBox (below) and the
  // export's group-union bbox frame them, and the PNG export keeps them.
  function drawPhantomParents(positions) {
    // Group children by their exact parent situation — shared real parents +
    // the same set of unknown roles — so adopted siblings share ONE placeholder
    // cluster rather than each spawning a duplicate "Unknown father" node.
    // Mirrors the real parent→child grouping in drawEdges.
    const groups = new Map();
    positions.forEach((pos) => {
      const p = pos.person;
      const roles = (p.unknownParents || []).filter((r) => r === "father" || r === "mother");
      if (!roles.length) return;
      // A role is only a phantom if no REAL parent already fills that gender
      // (m→father, f→mother). The data model prevents the contradiction, but
      // guard so a placeholder never lands on top of a known parent.
      const realParents = (p.parents || []).map((id) => positions.get(id)).filter(Boolean);
      const haveGender = { father: false, mother: false };
      realParents.forEach((rp) => {
        if (rp.person.gender === "m") haveGender.father = true;
        else if (rp.person.gender === "f") haveGender.mother = true;
      });
      const freeRoles = roles.filter((r) => !haveGender[r]);
      if (!freeRoles.length) return;
      const realIds = realParents.map((rp) => rp.person.id).sort();
      const key = realIds.join("|") + "#" + freeRoles.slice().sort().join("|");
      if (!groups.has(key)) {
        groups.set(key, { realParents, roles: freeRoles.slice().sort(), children: [] });
      }
      groups.get(key).children.push(pos);
    });

    groups.forEach(({ realParents, roles, children }) => {
      // All children in a group share parents ⇒ same generation ⇒ same y.
      // The child-id list is stamped on every phantom element so the export's
      // lineage-subset strip can drop a phantom whose child is out of focus.
      const childIds = children.map((c) => c.person.id).join(",");
      const childTops = children.map((c) => ({ cx: c.x + NODE_W / 2, y: c.y }));
      const childCenterX = (Math.min(...childTops.map((t) => t.cx))
        + Math.max(...childTops.map((t) => t.cx))) / 2;

      if (realParents.length) {
        // MIXED case (one parent known, the other unknown). The children
        // already have a solid rail to the known parent, so the phantom only
        // needs to sit beside that parent as the missing partner, joined by a
        // short dashed bond. No riser to the children — the real rail implies
        // the pairing. Only one role is possible here (the free one).
        const role = roles[0];
        const anchor = realParents.reduce((a, b) => (a.x < b.x ? a : b));
        const anchorRight = realParents.reduce((a, b) => (a.x > b.x ? a : b));
        const phantomY = anchor.y;
        const realCenterX = (anchor.x + anchorRight.x + NODE_W) / 2;
        // Sit on the side of the known parent that faces the children.
        const toRight = childCenterX >= realCenterX;
        const px = toRight
          ? anchorRight.x + NODE_W + X_GAP_COUPLE
          : anchor.x - NODE_W - X_GAP_COUPLE;
        appendPhantomNode(role, px, phantomY, children, childIds);
        // Dashed couple bond spanning the 14px gap between the two PHOTOS (not
        // the node boxes, which overlap at couple spacing) at photo-centre
        // height — mirrors where a real wedding-ring knot sits. Bond to the
        // real parent on the phantom's side (matters only in the rare
        // two-same-gender-parents case where a role is still free).
        const nearReal = toRight ? anchorRight : anchor;
        const realPhotoCx = nearReal.x + NODE_W / 2;
        const phantomPhotoCx = px + NODE_W / 2;
        const realEdgeX = toRight ? realPhotoCx + PHOTO_R : realPhotoCx - PHOTO_R;
        const phantomEdgeX = toRight ? phantomPhotoCx - PHOTO_R : phantomPhotoCx + PHOTO_R;
        const bondY = phantomY + PHOTO_CY;
        edgesG.appendChild(svgEl_("path", {
          class: "t-phantom-edge t-phantom-edge--bond",
          "data-phantom-children": childIds,
          d: `M ${Math.min(realEdgeX, phantomEdgeX)} ${bondY} L ${Math.max(realEdgeX, phantomEdgeX)} ${bondY}`
        }));
        return;
      }

      // PURE-UNKNOWN case (no real parents placed). The children have no other
      // link upward, so ONE placeholder sits centred over the group and rails
      // down to each child. When BOTH parents are unknown we render a single
      // "Unknown parents" card rather than two — two half-cards would collide
      // at couple spacing and read as clutter; the per-role detail already
      // lives in the inspector.
      const phantomY = childTops[0].y - (NODE_H + Y_GAP);
      const px = childCenterX - NODE_W / 2;
      const role = roles.length === 2 ? "both" : roles[0];
      appendPhantomNode(role, px, phantomY, children, childIds);
      const anchorX = px + NODE_W / 2;
      const anchorY = phantomY + NODE_H;
      drawPhantomRisers(anchorX, anchorY, childTops, childIds);
    });
  }

  // One dashed placeholder card: a dashed photo ring with a "?" glyph and an
  // "Unknown father/mother" label. Uses "?" (display font) not a Font Awesome
  // glyph on purpose — FA icon fonts don't rasterise in the PNG/print export,
  // where "?" survives via the .t-phantom-glyph style the exporter injects.
  function appendPhantomNode(role, x, y, children, childIds) {
    const cx = NODE_W / 2;
    const cy = PHOTO_CY;
    const label = I18n.t(
      role === "both" ? "tree.unknownParents"
        : role === "mother" ? "tree.unknownMother"
        : "tree.unknownFather"
    );
    const childName = children[0]
      ? (FamilyStore.getField(children[0].person, "name") || children[0].person.name)
      : "";
    const g = svgEl_("g", {
      class: "t-phantom-node",
      transform: `translate(${x},${y})`,
      "data-phantom-children": childIds,
      role: "img",
      "aria-label": I18n.t("tree.unknownParentAria", { role: label, name: childName })
    });
    g.appendChild(svgEl_("circle", { class: "t-phantom-photo-bg", cx, cy, r: PHOTO_R + 3 }));
    g.appendChild(svgEl_("circle", { class: "t-phantom-ring", cx, cy, r: PHOTO_R }));
    g.appendChild(svgEl_("text", {
      class: "t-phantom-glyph",
      "text-anchor": "middle",
      x: cx, y: cy + 12,
      "font-size": "34"
    }, "?"));
    const nameNode = svgEl_("text", {
      class: "t-phantom-name",
      "text-anchor": "middle",
      x: cx, y: PHOTO_CY + PHOTO_R + 22
    }, label);
    nameNode.appendChild(svgEl_("title", null, label));
    g.appendChild(nameNode);
    nodesG.appendChild(g);
  }

  // Dashed trunk → rail → risers from a phantom anchor down to each child,
  // each child as ONE continuous path so the dash pattern stays seamless
  // across the corners (mirrors the pet-edge connector in drawEdges).
  function drawPhantomRisers(anchorX, anchorY, childTops, childIds) {
    const R = 10;
    const railY = (anchorY + Math.min(...childTops.map((t) => t.y))) / 2;
    childTops.forEach((c) => {
      const dx = Math.abs(c.cx - anchorX);
      const r = Math.min(R, Math.max(2, dx / 2));
      const sign = c.cx === anchorX ? 0 : (c.cx > anchorX ? 1 : -1);
      let d;
      if (sign === 0) {
        d = `M ${anchorX} ${anchorY} L ${anchorX} ${c.y}`;
      } else {
        const railEnter = c.cx - sign * r;
        d = `M ${anchorX} ${anchorY}`
          + ` L ${anchorX} ${railY - r}`
          + ` Q ${anchorX} ${railY}, ${anchorX + sign * r} ${railY}`
          + ` L ${railEnter} ${railY}`
          + ` Q ${c.cx} ${railY}, ${c.cx} ${railY + r}`
          + ` L ${c.cx} ${c.y}`;
      }
      edgesG.appendChild(svgEl_("path", { class: "t-phantom-edge", "data-phantom-children": childIds, d }));
    });
  }

  // ===== Focus-mode cluster overlay (folded far kin) =====
  // Folded relatives (everyone the DOI prune dropped) are represented — never
  // silently gone — as STACKED cluster nodes anchored to the visible person
  // they hang off of. Like phantoms, a cluster is an ADDITIVE overlay: class
  // .t-node-cluster (never .t-node), NO data-person-id, drawn in its own pass
  // AFTER real nodes/edges, and NOT in `positions`/`lastPositions`. So every
  // real-people pass (softUpdate, filter, highlight, decorateSelf, reveal, the
  // couple/edge indices) skips it automatically. computeBBox folds it in by
  // reading its transform; the PNG exporter strips it by class.
  //
  // Completeness (the invariant that matters): every folded id is bucketed to
  // exactly ONE visible anchor via a BFS to its nearest kept neighbour, so the
  // union of all clusters' members === the folded set. Nothing drops.
  //
  // Bucketing is position-independent (pure graph), keyed by (anchorId, side)
  // where side ∈ up/down/side by generation vs. the anchor — so the cluster id
  // is stable across renders (P3 expansion toggles it). Pure over (keep,
  // foldedIds): used at prune time to resolve an expanded key → its member ids,
  // and at draw time to lay out the remaining stacks.
  function bucketizeFolded(keep, foldedIds) {
    const buckets = new Map(); // key -> { key, anchorId, side, members:Set<id> }
    if (!keep || !foldedIds || !foldedIds.length) return buckets;
    const gen = FamilyStore.buildGenerations();
    // Nearest visible anchor for a folded id: BFS over the kin graph until we
    // hit a kept person. Undirected, same adjacency as the DOI walk.
    function nearestAnchor(startId) {
      const seen = new Set([startId]);
      let frontier = [startId];
      let hops = 0;
      while (frontier.length && hops < 12) {
        hops++;
        const next = [];
        for (const id of frontier) {
          for (const nid of focusNeighbors(id)) {
            if (seen.has(nid)) continue;
            if (keep.has(nid)) return nid; // first kept person reached
            seen.add(nid);
            next.push(nid);
          }
        }
        frontier = next;
      }
      return null;
    }
    foldedIds.forEach((fid) => {
      const anchorId = nearestAnchor(fid);
      if (!anchorId) return; // orphan (disconnected) — no visible anchor to hang off
      const ag = gen.get(anchorId) || 0;
      const fg = gen.get(fid) || 0;
      const side = fg > ag ? "down" : fg < ag ? "up" : "side";
      const key = anchorId + "#" + side;
      if (!buckets.has(key)) buckets.set(key, { key, anchorId, side, members: new Set() });
      buckets.get(key).members.add(fid);
    });
    return buckets;
  }

  // Draw a stacked cluster node per bucket, anchored to its visible person's
  // laid-out box. positions is the (focus-pruned, refined) layout map.
  function drawClusters(positions) {
    if (treeMode !== "focus" || !focusKeepSet) return;
    const buckets = bucketizeFolded(focusKeepSet, focusFoldedIds);
    if (!buckets.size) return;
    buckets.forEach((bucket) => {
      // An expanded cluster's members are already drawn as real nodes (added
      // back into `people` before layout), so skip its stack entirely.
      if (expandedClusters.has(bucket.key)) return;
      const anchor = positions.get(bucket.anchorId);
      if (!anchor) return;
      // Position the stack relative to the anchor node box. Down/up sit a half
      // row-gap below/above; side sits a node-width to the anchor's right.
      let cx, cy;
      if (bucket.side === "down") { cx = anchor.x + NODE_W / 2; cy = anchor.y + NODE_H + Y_GAP * 0.7; }
      else if (bucket.side === "up") { cx = anchor.x + NODE_W / 2; cy = anchor.y - Y_GAP * 0.7; }
      else { cx = anchor.x + NODE_W + X_GAP_SIBLING + NODE_W / 2; cy = anchor.y + PHOTO_CY; }
      appendClusterNode(bucket, cx, cy, anchor);
    });
  }

  // One stacked cluster: fanned photo-rings (up to 3) behind a count badge,
  // with a dashed connector back to the anchor. Keyboard + pointer reachable;
  // tap/Enter expands it (P3 wires the actual expand). aria-label names the
  // count and anchor so a screen-reader user knows what's hidden and where.
  function appendClusterNode(bucket, cx, cy, anchor) {
    const count = bucket.members.size;
    const R = PHOTO_R * 0.7;                    // slightly smaller than a real ring
    const FAN = Math.min(count, 3);             // how many rings to fan
    const spread = 10;                          // px offset between fanned rings
    // Dashed connector from the anchor's photo centre to the cluster centre —
    // reuses the phantom-edge dashed styling so it reads as "more, not drawn".
    const ax = anchor.x + NODE_W / 2;
    const ay = anchor.y + PHOTO_CY;
    edgesG.appendChild(svgEl_("path", {
      class: "t-cluster-edge",
      d: `M ${ax} ${ay} L ${cx} ${cy}`
    }));
    const label = count === 1 ? I18n.t("tree.clusterOne")
      : I18n.t("tree.clusterMany", { n: count });
    const anchorName = (FamilyStore.getField && FamilyStore.getField(anchor.person, "name")) || anchor.person.name;
    const g = svgEl_("g", {
      class: "t-node-cluster",
      "data-cluster-key": bucket.key,
      "data-cluster-anchor": bucket.anchorId,
      transform: `translate(${cx},${cy})`,
      tabindex: "0",
      role: "button",
      "aria-label": I18n.t("tree.clusterAria", { count: count, name: anchorName }),
      style: { cursor: "pointer" },
      onclick: (ev) => { ev.stopPropagation(); expandCluster(bucket.key); },
      onkeydown: (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); expandCluster(bucket.key); } },
      // Desktop peek (D4): hovering a stack previews WHO is folded inside — a
      // few names + "and N more" — so you can decide whether to expand without
      // committing. Touch has no hover, so a tap just expands (onclick above);
      // the peek is fine-pointer only to avoid a phantom tooltip on mobile.
      onpointerenter: (ev) => { if (ev.pointerType !== "touch") showClusterPeek(bucket, cx, cy); },
      onpointerleave: () => hideClusterPeek(),
      // Keyboard parity: focusing the stack previews it too; blur clears it.
      onfocus: () => showClusterPeek(bucket, cx, cy),
      onblur: () => hideClusterPeek()
    });
    // Fanned rings behind — offset horizontally so they read as a stack.
    for (let i = FAN - 1; i >= 0; i--) {
      const off = (i - (FAN - 1) / 2) * spread;
      g.appendChild(svgEl_("circle", {
        class: "t-cluster-ring" + (i === 0 ? " t-cluster-ring--front" : ""),
        cx: off, cy: 0, r: R
      }));
    }
    // Count badge centred on the front ring.
    g.appendChild(svgEl_("text", {
      class: "t-cluster-count", x: 0, y: 0,
      "text-anchor": "middle", "dominant-baseline": "central"
    }, "+" + count));
    // Caption below the stack.
    const cap = svgEl_("text", {
      class: "t-cluster-label", x: 0, y: R + 18, "text-anchor": "middle"
    }, label);
    cap.appendChild(svgEl_("title", null, label));
    g.appendChild(cap);
    nodesG.appendChild(g);
  }

  // Desktop/keyboard peek popover for a cluster stack: a small card listing a
  // handful of the folded names + "and N more", plus a one-line "tap to open"
  // cue. Positioned in stage px above the stack via the SVG CTM (same technique
  // as the node menu). Non-interactive (pointer-events:none) so it never eats
  // the hover that summoned it. One at a time; re-summoning replaces it.
  function showClusterPeek(bucket, cx, cy) {
    if (!stageEl || !svgEl) return;
    hideClusterPeek();
    const ids = Array.from(bucket.members);
    const MAX = 5;
    const shown = ids.slice(0, MAX).map((id) => {
      const p = FamilyStore.getPerson(id);
      if (!p) return null;
      return (FamilyStore.getField && FamilyStore.getField(p, "name")) || p.name || "";
    }).filter(Boolean);
    const extra = ids.length - shown.length;
    const rows = shown.map((nm) => UI.el("div", { class: "tree-cluster-peek__name" }, nm));
    if (extra > 0) rows.push(UI.el("div", { class: "tree-cluster-peek__more" }, I18n.t("tree.clusterPeekMore", { n: extra })));
    rows.push(UI.el("div", { class: "tree-cluster-peek__cue" }, I18n.t("tree.clusterPeekCue")));
    const peek = UI.el("div", { class: "tree-cluster-peek", role: "tooltip" }, rows);
    stageEl.appendChild(peek);
    clusterPeekEl = peek;
    // Convert the stack centre (SVG coords) to stage px, then sit the card just
    // above it, centred, clamped to the stage so it never spills off-canvas.
    const ctm = svgEl.getScreenCTM();
    if (ctm) {
      const pt = svgEl.createSVGPoint();
      pt.x = cx; pt.y = cy;
      const scr = pt.matrixTransform(ctm);
      const stageBox = stageEl.getBoundingClientRect();
      const peekBox = peek.getBoundingClientRect();
      const M = 8;
      let left = scr.x - stageBox.left;
      let top = scr.y - stageBox.top - peekBox.height - 14; // above the stack
      const half = peekBox.width / 2;
      left = Math.max(M + half, Math.min(stageBox.width - M - half, left));
      if (top < M) top = (scr.y - stageBox.top) + 24; // flip below if no room above
      peek.style.left = left + "px";
      peek.style.top = top + "px";
    }
  }
  function hideClusterPeek() {
    if (clusterPeekEl) { clusterPeekEl.remove(); clusterPeekEl = null; }
  }

  // Expand a cluster: add its members to the set drawn as real nodes, then
  // re-render. Folded back into the topology signature so the gated render
  // rebuilds. After the rebuild, glide the newly-revealed members into view by
  // re-centring on the anchor they hung off of, so an expand near a screen edge
  // doesn't drop its results outside the viewport.
  function expandCluster(key) {
    if (!key || expandedClusters.has(key)) return;
    expandedClusters.add(key);
    const anchorId = (key.split("#")[0]) || null;
    hideClusterPeek();
    userInteracted = true; // keep the current framing through the rebuild
    render();
    // Glide the anchor (and its freshly-revealed kin, which lay out right beside
    // it) into the centre. Keep the current zoom — an expand shouldn't also jump
    // the scale — so pass tighten=false.
    if (anchorId) animateCenterOn(anchorId, false);
  }

  // Tween the viewport so `personId`'s laid-out node is centred, keeping the
  // user's zoom (tighten=false) or pulling in to a comfortable close-up first if
  // they were zoomed way out (tighten=true). Reads lastPositions, so call it
  // AFTER the render that placed the node. Shared by re-centre and expand.
  function animateCenterOn(personId, tighten) {
    const pos = lastPositions && lastPositions.get ? lastPositions.get(personId) : null;
    if (!pos || !svgEl || !(isFinite(viewBox.w) && viewBox.w > 0)) return;
    const nodeCx = pos.x + NODE_W / 2;
    const nodeCy = pos.y + NODE_H / 2;
    let w = viewBox.w, h = viewBox.h;
    if (tighten) {
      const comfortableW = NODE_W * 6;
      if (w > comfortableW) { const scale = comfortableW / w; w = comfortableW; h = h * scale; }
    }
    animateViewBox({ x: nodeCx - w / 2, y: nodeCy - h / 2, w, h });
  }

  // Re-centre the focus view on `personId` (D2: "tap = re-center"). Re-prunes
  // the DOI spine around the new ego, re-lays-out, then tweens the viewport so
  // the new centre glides in rather than teleporting. No-op outside focus mode
  // or when they're already the centre. Does NOT open the inspector — that's
  // what tapping the already-centred person (or the node menu) is for.
  function recenterFocus(personId) {
    if (!personId || treeMode !== "focus" || personId === focusId) return;
    if (!FamilyStore.getPerson(personId)) return;
    hideClusterPeek();
    focusId = personId;
    writeFocusId(focusId);
    // Re-centring collapses any clusters the user had opened around the OLD ego
    // — they're meaningless against a fresh spine. render() also drops stale
    // keys, but clearing here keeps the signature honest for this rebuild.
    if (expandedClusters.size) expandedClusters = new Set();
    updateModeBtn();
    // Hold the current viewBox through the rebuild (userInteracted) so we tween
    // from where the user was, not from a snap-fitted whole-spine view.
    userInteracted = true;
    render();
    // Tighten in if we were zoomed far out — the new ego deserves a close-up.
    animateCenterOn(personId, true);
  }

  // One-time nudge the first time the focus view turns on, so the "tap someone
  // to bring them to the centre" gesture is discoverable (it isn't obvious that
  // a tap re-centres rather than opening a profile). localStorage-gated; fired
  // deferred so it doesn't collide with the mode-switch render.
  function maybeShowFocusHint() {
    try {
      if (localStorage.getItem("virasat.focusHintShown")) return;
      localStorage.setItem("virasat.focusHintShown", "1");
      setTimeout(() => { if (window.UI && UI.toast) UI.toast(I18n.t("tree.focusRecenterHint")); }, 700);
    } catch (_) {}
  }

  // Left-gutter era markers — one decade label per generation row, sitting in
  // a fixed column just left of the tree so they read as a generational axis.
  // The label is the row's MEDIAN birth year (outlier-robust) floored to a
  // decade ("1950s"), echoing the title eyebrow's "Established c. NNNN" idiom.
  // Median-decade is the one era semantic we can derive without inventing
  // generation names ("Generation 1/2/3" is noise and the root row isn't
  // necessarily the eldest), so a row with no dated people gets no label
  // rather than a meaningless one. Drawn in tree coordinates → pans/zooms with
  // the nodes; computeBBox folds the labels in so they're never clipped, and
  // the PNG/poster export strips them (an on-canvas aid, not part of the art).
  function drawEraLabels(positions) {
    if (!labelsG) return;
    UI.clear(labelsG);
    if (!showEras) return;
    // Bucket birth years by row (every node in a generation shares one y).
    const rows = new Map();  // rowIdx -> { y, years: [] }
    let minX = Infinity;
    positions.forEach((pos) => {
      if (pos.x < minX) minX = pos.x;
      let row = rows.get(pos.rowIdx);
      if (!row) { row = { y: pos.y, years: [] }; rows.set(pos.rowIdx, row); }
      const y = FamilyStore.getYear(pos.person.birthDate);
      if (y != null) row.years.push(y);
    });
    if (!isFinite(minX)) return;
    const labelX = minX - 20;  // right-anchored in the gutter left of the tree
    rows.forEach((row) => {
      if (!row.years.length) return;
      row.years.sort((a, b) => a - b);
      const mid = Math.floor(row.years.length / 2);
      const median = row.years.length % 2
        ? row.years[mid]
        : Math.round((row.years[mid - 1] + row.years[mid]) / 2);
      const decade = Math.floor(median / 10) * 10;
      labelsG.appendChild(svgEl_("text", {
        class: "t-era-label",
        x: labelX,
        y: row.y + NODE_H / 2,
        "text-anchor": "end",
        "dominant-baseline": "central"
      }, I18n.t("tree.eraDecade", { decade: decade })));
    });
  }

  function truncate(s, n) {
    if (!s) return "";
    if (s.length <= n) return s;
    return s.slice(0, n - 1).trimEnd() + "…";
  }

  // First-name → how many currently-rendered people share it (case-insensitive).
  // Rebuilt each render from the people actually drawn; drives surname-initial
  // disambiguation so two "Ram"s aren't indistinguishable on touch (where the
  // hover <title> never appears).
  let firstNameCounts = null;
  function buildFirstNameIndex(people) {
    const m = new Map();
    people.forEach((p) => {
      const dn = (FamilyStore.getField && FamilyStore.getField(p, "name")) || p.name || "";
      const first = String(dn).trim().split(/\s+/)[0];
      if (!first) return;
      const key = first.toLowerCase();
      m.set(key, (m.get(key) || 0) + 1);
    });
    firstNameCounts = m;
  }

  // Label shown under a node: the first name, plus a surname initial when
  // another rendered person shares that first name ("Ram S." vs "Ram K.").
  function nodeLabel(person, displayName) {
    const parts = String(displayName).trim().split(/\s+/);
    const first = parts[0] || displayName;
    const collides = firstNameCounts && (firstNameCounts.get(first.toLowerCase()) || 0) > 1;
    if (!collides) return truncate(first, 14);
    const surname = parts.length > 1 ? parts[parts.length - 1] : "";
    const initial = surname ? surname[0].toUpperCase() : "";
    return truncate(initial ? first + " " + initial + "." : first, 16);
  }

  // Contextual menu shown when a tree node is clicked.
  let openMenu = null;
  // Element to hand focus back to when the menu closes via keyboard (Escape),
  // mirroring the header kebab which returns focus to its anchor. Set at open.
  let menuReturnFocus = null;
  function dismissMenu(restoreFocus) {
    if (openMenu && openMenu.parentNode) openMenu.parentNode.removeChild(openMenu);
    openMenu = null;
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onDocKey, true);
    const ret = menuReturnFocus;
    menuReturnFocus = null;
    // Only on the keyboard-close path — a click-away or item-pick shouldn't
    // yank focus back (a picked item may open a modal that wants focus).
    if (restoreFocus && ret && ret.isConnected && ret.focus) {
      try { ret.focus({ preventScroll: true }); } catch (_) { ret.focus(); }
    }
  }
  function onDocClick(e) {
    if (openMenu && !openMenu.contains(e.target)) dismissMenu();
  }
  function onDocKey(e) {
    if (!openMenu) return;
    if (e.key === "Escape") { e.preventDefault(); dismissMenu(true); return; }
    // Roving focus across the menuitems (the head/dividers aren't focusable):
    // Arrows wrap, Home/End jump — same contract as the header kebab menu.
    const list = /** @type {HTMLElement[]} */ (Array.from(openMenu.querySelectorAll(".tree-node-menu__item")));
    if (!list.length) return;
    const idx = list.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    if (e.key === "ArrowDown") { e.preventDefault(); list[(idx + 1 + list.length) % list.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); list[(idx - 1 + list.length) % list.length].focus(); }
    else if (e.key === "Home") { e.preventDefault(); list[0].focus(); }
    else if (e.key === "End") { e.preventDefault(); list[list.length - 1].focus(); }
  }

  // Editable marriage modal. Triggered by clicking the gold knot between
  // two partners. Persists into FamilyStore.marriages, keyed by sorted
  // (aId|bId) pair.
  function showMarriageModal(a, b) {
    if (!window.UI || !UI.openModal) return;
    const nameA = FamilyStore.getField(a, "name") || a.name;
    const nameB = FamilyStore.getField(b, "name") || b.name;
    const lifeA = FamilyStore.formatDateRange(a);
    const lifeB = FamilyStore.formatDateRange(b);

    // Re-fetch current state and re-render the body in place when toggling
    // between view and edit modes, or after a save.
    const bodyHost = UI.el("div", { class: "form-stack" });
    const footerHost = UI.el("div", {
      style: { display: "flex", gap: "var(--s-2)", justifyContent: "flex-end", flexWrap: "wrap", flex: "1" }
    });
    let dlg = null;
    let mode = "view"; // "view" | "edit"

    function partnerChip(p, name, life) {
      return UI.el("button", {
        type: "button",
        class: "marriage-partner",
        style: {
          display: "flex", gap: "12px", alignItems: "center",
          flex: "1", minWidth: "0",
          padding: "10px 12px", border: "1px solid var(--line)",
          borderRadius: "var(--r-md)", background: "var(--bg-elev)",
          cursor: "pointer", textAlign: "left"
        },
        onclick: () => { dlg && dlg.close(); if (window.Inspector) Inspector.show(p.id); }
      }, [
        UI.avatar(p, "md"),
        UI.el("div", { style: { display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" } }, [
          UI.el("div", {
            style: {
              fontFamily: "var(--font-display)", fontSize: "16px",
              fontWeight: "500", color: "var(--text)",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
            }
          }, name),
          UI.el("div", {
            style: { fontSize: "11px", color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }
          }, life)
        ])
      ]);
    }

    function partnersRow() {
      return UI.el("div", { style: { display: "flex", gap: "8px", alignItems: "stretch" } }, [
        partnerChip(a, nameA, lifeA),
        UI.el("div", {
          style: {
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--gold)", fontSize: "18px"
          }
        }, [ UI.el("i", { class: "fa-solid fa-heart" }) ]),
        partnerChip(b, nameB, lifeB)
      ]);
    }

    function muted(text) {
      return UI.el("p", {
        style: { margin: 0, color: "var(--text-3)", fontSize: "13px", fontStyle: "italic" }
      }, text);
    }

    function row(label, value) {
      return UI.el("div", {
        style: { display: "grid", gridTemplateColumns: "100px 1fr", gap: "12px", padding: "6px 0", borderBottom: "1px solid var(--surface-2)" }
      }, [
        UI.el("dt", {
          style: { fontSize: "11px", color: "var(--text-3)", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: "500", paddingTop: "2px" }
        }, label),
        UI.el("dd", { style: { margin: 0, color: "var(--text)", fontSize: "13.5px" } }, value)
      ]);
    }

    function renderViewMode() {
      const existing = FamilyStore.getMarriage(a.id, b.id) || {};
      const has = !!(existing.date || existing.place || existing.story || existing.photoId || existing.photo);

      while (bodyHost.firstChild) bodyHost.removeChild(bodyHost.firstChild);
      while (footerHost.firstChild) footerHost.removeChild(footerHost.firstChild);

      bodyHost.appendChild(partnersRow());

      if (!has) {
        bodyHost.appendChild(UI.el("div", {
          style: { textAlign: "center", padding: "24px 12px", color: "var(--text-3)" }
        }, [
          UI.el("div", {
            style: { fontSize: "28px", color: "var(--gold)", marginBottom: "8px" }
          }, [ UI.el("i", { class: "fa-solid fa-pen-nib" }) ]),
          UI.el("p", { style: { margin: 0, fontSize: "13.5px" } },
            I18n.t("marriage.emptyTitle")),
          UI.el("p", { style: { margin: "4px 0 0", fontSize: "12px" } },
            I18n.t("marriage.emptyBody"))
        ]));
      } else {
        // Photo (if any), then a clean dl of fields.
        const url = existing.photoId && window.PhotoStore
          ? PhotoStore.getUrlSync({ photoId: existing.photoId })
          : (existing.photo || null);
        if (url || existing.photoId) {
          const img = UI.el("img", {
            src: url || "",
            alt: I18n.t("marriage.photoAlt"),
            style: {
              display: "block", width: "100%", maxHeight: "260px",
              objectFit: "cover", borderRadius: "var(--r-md)",
              border: "1px solid var(--line)"
            }
          });
          bodyHost.appendChild(img);
          if (!url && window.PhotoStore && existing.photoId) {
            PhotoStore.getUrl({ photoId: existing.photoId }).then((u) => { if (u) img.src = u; });
          }
        }
        const dl = UI.el("dl", { style: { margin: 0, display: "flex", flexDirection: "column", gap: "0" } });
        if (existing.date)  dl.appendChild(row(I18n.t("marriage.date"),  existing.date));
        if (existing.place) dl.appendChild(row(I18n.t("marriage.place"), existing.place));
        bodyHost.appendChild(dl);
        if (existing.story) {
          bodyHost.appendChild(UI.el("div", { style: { display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" } }, [
            UI.el("div", {
              style: { fontSize: "11px", color: "var(--text-3)", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: "500" }
            }, I18n.t("marriage.story")),
            UI.el("p", {
              style: { margin: 0, color: "var(--text)", fontSize: "14px", lineHeight: "1.65", fontFamily: "var(--font-display)", whiteSpace: "pre-wrap" }
            }, existing.story)
          ]));
        }
      }

      // Footer: edit pencil + close. The Edit / Add-details button mutates, so
      // it's hidden for read-only viewers (real viewer-role members AND an owner
      // previewing-as-viewer). Without this, a viewer could open edit mode, type,
      // and hit Save — setMarriage() no-ops under the store's read-only guard, but
      // the "saved" toast still fired, telling them a change stuck when it didn't.
      // The record itself stays fully visible above; only the edit path is gone.
      const canEdit = !(FamilyStore.isReadOnly && FamilyStore.isReadOnly());
      const closeBtn = UI.el("button", {
        class: "btn btn--ghost", type: "button",
        onclick: () => dlg && dlg.close()
      }, [
        UI.el("span", null, I18n.t("actions.close"))
      ]);
      footerHost.appendChild(closeBtn);
      if (canEdit) {
        const editBtn = UI.el("button", {
          class: "btn btn--primary", type: "button",
          onclick: () => { mode = "edit"; renderEditMode(); }
        }, [
          UI.el("i", { class: "fa-regular fa-pen-to-square" }),
          UI.el("span", null, has ? I18n.t("actions.edit") : I18n.t("marriage.addDetails"))
        ]);
        footerHost.appendChild(editBtn);
      }
    }

    function renderEditMode() {
      const existing = FamilyStore.getMarriage(a.id, b.id) || {};
      const draft = {
        date: existing.date || "",
        place: existing.place || "",
        story: existing.story || "",
        photoId: existing.photoId || null,
        photo: existing.photo || null
      };

      while (bodyHost.firstChild) bodyHost.removeChild(bodyHost.firstChild);
      while (footerHost.firstChild) footerHost.removeChild(footerHost.firstChild);

      // Photo uploader for the marriage
      const photoSlot = UI.el("div", { style: { display: "flex", alignItems: "center", justifyContent: "center" } });
      function refreshPhoto() {
        while (photoSlot.firstChild) photoSlot.removeChild(photoSlot.firstChild);
        const url = draft.photoId && window.PhotoStore
          ? PhotoStore.getUrlSync({ photoId: draft.photoId })
          : (draft.photo || null);
        if (url) {
          photoSlot.appendChild(UI.el("img", {
            src: url, alt: I18n.t("marriage.photoAlt"),
            style: { width: "120px", height: "120px", borderRadius: "var(--r-md)", objectFit: "cover", border: "1px solid var(--line)" }
          }));
        } else if (draft.photoId && window.PhotoStore) {
          const img = UI.el("img", { src: "", alt: "", style: { width: "120px", height: "120px", borderRadius: "var(--r-md)", objectFit: "cover", border: "1px solid var(--line)" } });
          photoSlot.appendChild(img);
          PhotoStore.getUrl({ photoId: draft.photoId }).then((u) => { if (u) img.src = u; });
        } else {
          photoSlot.appendChild(UI.el("div", {
            style: {
              width: "120px", height: "120px", borderRadius: "var(--r-md)",
              background: "var(--surface-2)", border: "1px dashed var(--line)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--text-3)", fontSize: "12px", textAlign: "center"
            }
          }, I18n.t("marriage.noPhoto")));
        }
      }
      const fileInput = UI.el("input", {
        type: "file", accept: "image/*", hidden: true,
        onchange: async (e) => {
          const f = e.target.files && e.target.files[0];
          e.target.value = "";
          if (!f || !window.PhotoStore) return;
          try {
            const id = await PhotoStore.fileToPhotoId(f);
            if (draft.photoId) PhotoStore.delete(draft.photoId).catch(() => {});
            draft.photoId = id;
            draft.photo = null;
            refreshPhoto(); syncPhotoButtons();
          } catch (err) {
            UI.toast(err.message || I18n.t("marriage.photoUploadFailed"), "danger");
          }
        }
      });
      const uploadBtn = UI.el("button", {
        class: "btn btn--sm", type: "button",
        onclick: () => fileInput.click()
      }, [UI.el("i", { class: "fa-solid fa-image" }), UI.el("span", null, I18n.t("marriage.addPhoto"))]);
      const removePhotoBtn = UI.el("button", {
        class: "btn btn--sm btn--ghost", type: "button",
        style: { color: "var(--danger)" },
        onclick: () => {
          if (draft.photoId && window.PhotoStore) PhotoStore.delete(draft.photoId).catch(() => {});
          draft.photoId = null; draft.photo = null;
          refreshPhoto(); syncPhotoButtons();
        }
      }, [
        UI.el("span", null, I18n.t("actions.remove"))
      ]);
      function syncPhotoButtons() {
        uploadBtn.querySelector("span").textContent = (draft.photoId || draft.photo) ? I18n.t("marriage.replacePhoto") : I18n.t("marriage.addPhoto");
        removePhotoBtn.style.display = (draft.photoId || draft.photo) ? "" : "none";
      }
      refreshPhoto(); syncPhotoButtons();

      const datePicker = window.HeritagePicker
        ? HeritagePicker.create({
            value: draft.date, placeholder: "YYYY-MM-DD",
            allowYearOnly: true,
            onChange: (v) => { draft.date = v; }
          })
        : null;
      const dateEl = datePicker ? datePicker.el : UI.el("input", {
        class: "input", type: "text", value: draft.date,
        placeholder: I18n.t("marriage.datePlaceholder"),
        oninput: (e) => { draft.date = e.target.value; }
      });

      const placeInput = UI.el("input", {
        class: "input", type: "text", value: draft.place,
        placeholder: I18n.t("marriage.placePlaceholder"),
        oninput: (e) => { draft.place = e.target.value; }
      });
      const storyInput = UI.el("textarea", {
        class: "textarea",
        placeholder: I18n.t("marriage.storyPlaceholder"),
        oninput: (e) => { draft.story = e.target.value; }
      }, draft.story);

      const photoRow = UI.el("div", {
        style: { display: "flex", gap: "var(--s-4)", alignItems: "center" }
      }, [
        photoSlot,
        UI.el("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } }, [
          uploadBtn, removePhotoBtn, fileInput
        ])
      ]);

      bodyHost.appendChild(partnersRow());
      bodyHost.appendChild(UI.field(I18n.t("marriage.dateLabel"), dateEl));
      bodyHost.appendChild(UI.field(I18n.t("marriage.place"), placeInput));
      bodyHost.appendChild(UI.field(I18n.t("marriage.photo"), photoRow));
      bodyHost.appendChild(UI.field(I18n.t("marriage.storyLabel"), storyInput, I18n.t("marriage.storyHint")));

      // Footer: cancel back to view, save commits, optional Forget on the left.
      const cancelBtn = UI.el("button", {
        class: "btn btn--ghost", type: "button",
        onclick: () => { mode = "view"; renderViewMode(); }
      }, [
        UI.el("span", null, I18n.t("actions.cancel"))
      ]);
      const saveBtn = UI.el("button", {
        class: "btn btn--primary", type: "button",
        onclick: () => {
          // Commit a typed-but-unconfirmed marriage date before reading it.
          if (datePicker && datePicker.flush) datePicker.flush();
          FamilyStore.setMarriage(a.id, b.id, {
            date: draft.date || "",
            place: draft.place || "",
            story: draft.story || "",
            photoId: draft.photoId || null,
            photo: draft.photo || null
          });
          UI.toast(I18n.t("marriage.saved"), "success");
          mode = "view"; renderViewMode();
        }
      }, [UI.el("i", { class: "fa-solid fa-floppy-disk" }), UI.el("span", null, I18n.t("actions.save"))]);

      const has = !!(existing.date || existing.place || existing.story || existing.photoId || existing.photo);
      if (has) {
        const delBtn = UI.el("button", {
          class: "btn btn--danger", type: "button",
          style: { marginRight: "auto" },
          onclick: async () => {
            const ok = await UI.confirm({
              title: I18n.t("marriage.forgetTitle"),
              message: I18n.t("marriage.forgetMsg"),
              confirmLabel: I18n.t("marriage.forget"), danger: true
            });
            if (!ok) return;
            if (existing.photoId && window.PhotoStore) PhotoStore.delete(existing.photoId).catch(() => {});
            FamilyStore.deleteMarriage(a.id, b.id);
            UI.toast(I18n.t("marriage.cleared"), "success");
            mode = "view"; renderViewMode();
          }
        }, [
          UI.el("i", { class: "fa-regular fa-trash-can", "aria-hidden": "true" }),
          UI.el("span", null, I18n.t("marriage.forget"))
        ]);
        footerHost.appendChild(delBtn);
      }
      footerHost.appendChild(cancelBtn);
      footerHost.appendChild(saveBtn);
    }

    dlg = UI.openModal({
      title: I18n.t("marriage.title", { a: nameA, b: nameB }),
      body: bodyHost,
      footer: [footerHost]
    });
    renderViewMode();
  }

  function showNodeMenu(person, pos, ev) {
    dismissMenu();
    if (!stageEl || !svgEl) return;

    // Convert SVG-space (pos.x + NODE_W/2, pos.y + NODE_H) to stage-relative px
    const pt = svgEl.createSVGPoint();
    pt.x = pos.x + 75;       // node center horizontally
    pt.y = pos.y + 110;      // bottom of node
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return;
    const screen = pt.matrixTransform(ctm);
    const stageBox = stageEl.getBoundingClientRect();
    const left = screen.x - stageBox.left;
    const top  = screen.y - stageBox.top + 8;

    const displayName = FamilyStore.getField(person, "name") || person.name;
    const lifespan = FamilyStore.formatDateRange(person);

    const divider = () => UI.el("div", { style: { height: "1px", background: "var(--line)", margin: "4px 6px" } });

    // Viewers get a read-only menu: name/lifespan + the view-only "Focus"
    // actions, but none of Edit / Add-relative / Marriage-details / Delete.
    // Those all mutate (and the store no-ops them under read-only, which would
    // otherwise surface a misleading success toast). The "+" add affordance is
    // already role-gated where the node is built (the `.t-node-add` disc is
    // skipped under read-only); this closes the menu path.
    const canEdit = !(FamilyStore.isReadOnly && FamilyStore.isReadOnly());

    const items = [
      UI.el("div", { class: "tree-node-menu__head" }, [
        UI.el("div", { class: "tree-node-menu__name" }, displayName),
        UI.el("div", { class: "tree-node-menu__sub" }, lifespan)
      ])
    ];
    // In focus mode a plain tap RE-CENTRES rather than opening the inspector, so
    // the profile must stay reachable here — otherwise a focus-mode viewer (who
    // has no Edit row either) could never open anyone's record. Full mode leaves
    // this out: a tap there already opens the inspector, so it'd be redundant.
    if (treeMode === "focus") {
      items.push(menuItem(I18n.t("tree.viewProfile"), "fa-regular fa-id-card", null, () => {
        dismissMenu();
        if (window.Inspector) Inspector.show(person.id);
      }));
    }
    if (canEdit) {
      items.push(menuItem(I18n.t("inspector.actEdit"), "fa-solid fa-user-pen", null, () => {
        dismissMenu();
        if (window.PeopleView && PeopleView.openForm) PeopleView.openForm(person.id);
      }));
    }

    // A companion animal has no spouse/child/parent semantics — offering those
    // actions is nonsensical, so gate the whole relation block on !isPet.
    // Also editor-only (the whole block mutates).
    if (canEdit && !person.isPet) {
      items.push(
        menuItem(I18n.t("inspector.addChild"), "fa-solid fa-baby", null, () => {
          dismissMenu();
          addRelative(person, "child");
        }),
        menuItem(I18n.t("inspector.addSpouse"), "fa-solid fa-heart", null, () => {
          dismissMenu();
          addRelative(person, "spouse");
        }),
        menuItem(I18n.t("inspector.addParent"), "fa-solid fa-user-plus", null, () => {
          dismissMenu();
          addRelative(person, "parent");
        })
      );

      // Marriage details — reachable here rather than only via the tiny gold
      // knot (undiscoverable + keyboard-inaccessible). Only when the person
      // actually has a spouse; open the record for the first one.
      const spouseIds = (person.spouses || []).filter(Boolean);
      if (spouseIds.length) {
        items.push(menuItem(I18n.t("inspector.marriageDetails"), "fa-solid fa-ring", null, () => {
          dismissMenu();
          const spouse = FamilyStore.getPerson(spouseIds[0]);
          if (spouse) showMarriageModal(person, spouse);
        }));
      }
    }

    // Stick (or unstick) this person as the lineage focus root in the given
    // direction, and close the inspector so the dim/highlight is visible. The
    // effect persists across panel-close; the banner shows "Viewing as: X ·
    // Clear focus". Re-picking the SAME direction on the already-focused person
    // clears the focus; picking the OTHER direction just switches the walk.
    function toggleLineageFocus(mode) {
      dismissMenu();
      if (lineageFocusId === person.id && lineageFocusMode === mode) {
        lineageFocusId = null;
      } else {
        lineageFocusId = person.id;
        lineageFocusMode = mode;
        // Close the inspector so the dimmed tree is visible. Mobile users
        // couldn't see the highlight at all otherwise — the inspector covers
        // the whole screen at narrow widths.
        if (window.Inspector && Inspector.clear) Inspector.clear();
        const overlay = document.getElementById("app-overlay");
        const inspector = document.getElementById("inspector");
        if (inspector) inspector.classList.remove("is-open");
        if (overlay) overlay.classList.remove("is-on");
      }
      applyHighlightClasses();
    }
    const focusedHere = lineageFocusId === person.id;

    // Focus mode: an explicit, discoverable "bring this person to the centre"
    // — the same thing a plain tap does, surfaced in the menu so it isn't a
    // hidden gesture. Only when this isn't already the centre. (Distinct from
    // the lineage-highlight "Focus …" rows below, which dim the whole tree.)
    if (treeMode === "focus" && focusId && person.id !== focusId) {
      items.push(
        ...(items.length > 1 ? [divider()] : []),
        menuItem(I18n.t("tree.centerHere"), "fa-solid fa-crosshairs", null, () => {
          dismissMenu();
          recenterFocus(person.id);
        })
      );
    }

    items.push(
      // The head already draws its own bottom border, so a divider here would
      // read as two stacked rules whenever no edit/relation rows precede the
      // focus block — i.e. the viewer / shared-link menu, which starts straight
      // at Focus. Only separate when there's actually a preceding group.
      ...(items.length > 1 ? [divider()] : []),
      // Descendants-only (down). This is the default focus; a plain tap uses it
      // too. Toggles to "Clear focus" when it's the active mode on this person.
      menuItem(
        focusedHere && lineageFocusMode === "descendants"
          ? (I18n.t("tree.clearFocus") || "Clear focus")
          : (I18n.t("tree.focusLineage") || "Focus descendants"),
        "fa-solid fa-route",
        null,
        () => toggleLineageFocus("descendants")
      ),
      // Bloodline (down + up the direct ancestor line) — trace where the person
      // came from, not just who came after.
      menuItem(
        focusedHere && lineageFocusMode === "bloodline"
          ? (I18n.t("tree.clearFocus") || "Clear focus")
          : (I18n.t("tree.focusBloodline") || "Focus ancestors & descendants"),
        "fa-solid fa-code-branch",
        null,
        () => toggleLineageFocus("bloodline")
      )
    );

    // "This is me" — pin this person as the viewer's self-anchor, so the
    // inspector can name everyone else's exact kin relation to them (chacha,
    // bua, nana…). A personal lens, NOT a tree edit: it's stored per-viewer,
    // local-only (see SelfAnchor) and never synced, so it's offered to viewers
    // too, outside the canEdit gate. Pets can't be "me". Re-picking on the
    // already-pinned person clears it.
    if (window.SelfAnchor && !person.isPet) {
      const iAmSelf = SelfAnchor.isSelf(person.id);
      items.push(
        divider(),
        menuItem(
          iAmSelf ? (I18n.t("tree.clearSelf") || "Not me") : (I18n.t("tree.setSelf") || "This is me"),
          iAmSelf ? "fa-solid fa-user-xmark" : "fa-solid fa-user-check",
          null,
          () => {
            dismissMenu();
            // Toast the change: the visible effect (kin chips) only shows once
            // you open someone else's inspector, so without this the pin feels
            // like it did nothing. Name resolves via getField for the HI label.
            const nm = FamilyStore.getField(person, "name") || person.name;
            if (SelfAnchor.isSelf(person.id)) {
              SelfAnchor.clear();
              UI.toast(I18n.t("tree.selfCleared") || "Cleared — no longer marked as you", "success");
            } else {
              SelfAnchor.set(person.id);
              UI.toast(I18n.t("tree.selfSet", { name: nm }) || (nm + " is now marked as you"), "success");
            }
          }
        )
      );
    }

    // Delete — editor-only, and only claim success if the store actually
    // removed the person (deletePerson no-ops under read-only).
    if (canEdit) {
      items.push(
        divider(),
        menuItem(I18n.t("inspector.actDelete"), "fa-regular fa-trash-can", "danger", async () => {
          dismissMenu();
          // Memorial-grade confirm for records with a death date.
          const deceased = FamilyStore.isDeceased && FamilyStore.isDeceased(person);
          const ok = await UI.confirm(deceased ? {
            title: I18n.t("actions.memoriamDeleteTitle"),
            message: I18n.t("actions.memoriamDeleteMsg", { name: displayName }),
            confirmLabel: I18n.t("actions.remove"),
            danger: true
          } : {
            title: I18n.t("inspector.deleteTitle", { name: displayName }),
            message: I18n.t("inspector.deleteMsg"),
            confirmLabel: I18n.t("actions.remove"),
            danger: true
          });
          if (ok) {
            if (!FamilyStore.getPerson(person.id) || (FamilyStore.isReadOnly && FamilyStore.isReadOnly())) return;
            FamilyStore.deletePerson(person.id);
            if (window.Inspector) Inspector.clear();
            UI.toast(I18n.t("form.removed"), "success");
          }
        })
      );
    }

    const menu = UI.el("div", {
      class: "tree-node-menu", role: "menu",
      style: { left: left + "px", top: top + "px", transform: "translateX(-50%)" }
    }, items);

    stageEl.appendChild(menu);
    openMenu = menu;
    // Remember what to return focus to on keyboard-close. The menu is appended
    // after the entire SVG in DOM order, so without an explicit focus move a
    // keyboard user would have to Tab across every node/knot to reach it (and
    // couldn't get back). We move focus IN on open and restore it on Escape —
    // the same contract the header kebab uses.
    const trigger = ev && ev.currentTarget && ev.currentTarget.focus
      ? ev.currentTarget
      : (nodesG ? nodesG.querySelector('.t-node[data-person-id="' + (window.CSS && CSS.escape ? CSS.escape(person.id) : person.id) + '"]') : null);
    menuReturnFocus = /** @type {any} */ (trigger) || null;
    // Now that the menu has a measurable size, flip/clamp it so a node near the
    // bottom or side edge of the stage doesn't push items (incl. Delete) past
    // the stage's overflow:hidden clip. Default anchor is below the node,
    // centred; flip above when it would overflow the bottom.
    clampMenuToStage(menu, left, top, pos);
    setTimeout(() => {
      document.addEventListener("click", onDocClick, true);
      document.addEventListener("keydown", onDocKey, true);
      // Land focus on the first actionable item so keyboard users don't have to
      // Tab through the whole tree to reach the menu they just opened.
      const first = /** @type {HTMLElement|null} */ (menu.querySelector(".tree-node-menu__item"));
      if (first) first.focus();
    }, 0);
  }

  // Keep an open node-menu fully inside the stage. `anchorLeft/anchorTop` are
  // the stage-relative px of the node's bottom-centre (the default open point).
  function clampMenuToStage(menu, anchorLeft, anchorTop, pos) {
    if (!stageEl || !menu) return;
    const stageBox = stageEl.getBoundingClientRect();
    const menuBox = menu.getBoundingClientRect();
    const M = 8; // keep this much gap from every stage edge
    const w = menuBox.width;
    const h = menuBox.height;

    // Horizontal: the menu is translateX(-50%), so its left edge sits at
    // anchorLeft - w/2. Clamp the centre so both edges stay inside.
    let cx = anchorLeft;
    const half = w / 2;
    cx = Math.max(M + half, Math.min(stageBox.width - M - half, cx));

    // Vertical: if opening downward overflows the bottom, flip above the node.
    let top = anchorTop;
    if (anchorTop + h > stageBox.height - M) {
      // Node top in stage px = anchorTop minus the (node-bottom → node-top)
      // offset we baked into pt.y. Re-derive from pos via the CTM instead.
      const ctm = svgEl.getScreenCTM();
      if (ctm) {
        const ptTop = svgEl.createSVGPoint();
        ptTop.x = pos.x + 75; ptTop.y = pos.y; // node top-centre
        const scr = ptTop.matrixTransform(ctm);
        const nodeTop = scr.y - stageBox.top;
        top = Math.max(M, nodeTop - h - 8);
      } else {
        top = Math.max(M, stageBox.height - M - h);
      }
    }
    menu.style.left = cx + "px";
    menu.style.top = top + "px";
  }

  function menuItem(label, iconClass, variant, onclick) {
    return UI.el("button", {
      class: "tree-node-menu__item" + (variant ? " tree-node-menu__item--" + variant : ""),
      type: "button",
      role: "menuitem",
      onclick
    }, [
      iconClass
        ? UI.el("i", { class: "tree-node-menu__icon " + iconClass, "aria-hidden": "true" })
        : UI.el("span", { class: "tree-node-menu__icon", "aria-hidden": "true" }),
      UI.el("span", null, label)
    ]);
  }

  /**
   * Open the People form pre-filled with the right relation to `anchor`:
   *   - "child"  → newPerson.parents includes anchor (and anchor's spouse if there's exactly one)
   *   - "spouse" → newPerson.spouses includes anchor
   *   - "parent" → anchor.parents now includes newPerson (handled after save)
   */
  function addRelative(anchor, kind) {
    if (!window.PeopleView || !PeopleView.openForm) return;
    const seed = {};
    if (kind === "child") {
      const parents = [anchor.id];
      if (anchor.spouses && anchor.spouses.length === 1) parents.push(anchor.spouses[0]);
      seed.parents = parents;
    } else if (kind === "spouse") {
      seed.spouses = [anchor.id];
    } else if (kind === "parent") {
      seed.__addAsParentOf = anchor.id;
    }
    PeopleView.openForm(null, seed);
  }

  // Compact date string for the tree only. Living people get a trailing
  // en-dash with nothing after it ("1945–"), which reads clearly as
  // "still living" without competing with an adjacent partner's date for
  // horizontal space.
  function formatYears(p) {
    const by = FamilyStore.getYear(p.birthDate);
    const dy = FamilyStore.getYear(p.deathDate);
    if (by == null && dy == null) return "";
    function compact(year, precision) {
      if (year == null) return "?";
      if (precision === "about")  return "c." + year;
      if (precision === "before") return "<" + year;
      if (precision === "after")  return ">" + year;
      return String(year);
    }
    const left  = compact(by, p.birthDatePrecision);
    const right = dy != null ? compact(dy, p.deathDatePrecision)
                : (FamilyStore.isDeceased(p) ? "?" : "");
    return `${left}–${right}`;
  }

  // ===== Pan / zoom =====
  function applyViewBox() {
    svgEl.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
    // Update zoom percent readout (relative to lastBBox)
    const pctEl = document.getElementById("tree-zoom-pct");
    if (pctEl && lastBBox && lastBBox.w > 0) {
      const pct = Math.round((lastBBox.w / viewBox.w) * 100);
      pctEl.textContent = pct + "%";
    }
  }

  // Smoothly tween the viewBox from its current value to `target`
  // ({x,y,w,h}) over ~360ms. Used when re-centring the focus view on a
  // tapped person so the eye can follow who became the new centre instead
  // of the canvas teleporting. Honours prefers-reduced-motion (jump straight
  // to the target) and bails the instant the user grabs the canvas — a live
  // pan/pinch/wheel must always win over an in-flight animation. Only one
  // tween runs at a time; a new call cancels the previous frame loop.
  let viewBoxAnimId = null;
  function cancelViewBoxAnim() {
    if (viewBoxAnimId != null) { cancelAnimationFrame(viewBoxAnimId); viewBoxAnimId = null; }
  }
  function animateViewBox(target, onDone) {
    cancelViewBoxAnim();
    const reduce = (() => {
      try { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
      catch (_) { return false; }
    })();
    const from = { x: viewBox.x, y: viewBox.y, w: viewBox.w, h: viewBox.h };
    // Nothing meaningful to animate, no rAF, or reduced-motion → snap.
    const negligible = Math.abs(target.x - from.x) < 0.5 && Math.abs(target.y - from.y) < 0.5
      && Math.abs(target.w - from.w) < 0.5 && Math.abs(target.h - from.h) < 0.5;
    if (reduce || negligible || typeof requestAnimationFrame !== "function") {
      viewBox = { x: target.x, y: target.y, w: target.w, h: target.h };
      applyViewBox();
      if (onDone) onDone();
      return;
    }
    const DURATION = 360;
    let startTs = null;
    // easeInOutCubic — gentle acceleration then settle, never bouncy.
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    function frame(ts) {
      if (startTs == null) startTs = ts;
      // A live pointer gesture (pan/pinch) takes over — abandon the tween
      // exactly where it is so we don't fight the user's hand.
      if (activePointers.size) { viewBoxAnimId = null; if (onDone) onDone(); return; }
      const p = Math.min(1, (ts - startTs) / DURATION);
      const k = ease(p);
      viewBox = {
        x: from.x + (target.x - from.x) * k,
        y: from.y + (target.y - from.y) * k,
        w: from.w + (target.w - from.w) * k,
        h: from.h + (target.h - from.h) * k
      };
      applyViewBox();
      if (p < 1) {
        viewBoxAnimId = requestAnimationFrame(frame);
      } else {
        viewBoxAnimId = null;
        if (onDone) onDone();
      }
    }
    viewBoxAnimId = requestAnimationFrame(frame);
  }

  function computeBBox(positions) {
    if (positions.size === 0) return { x: 0, y: 0, w: 1000, h: 600 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    positions.forEach((pos) => {
      if (pos.x < minX) minX = pos.x;
      if (pos.y < minY) minY = pos.y;
      if (pos.x + NODE_W > maxX) maxX = pos.x + NODE_W;
      if (pos.y + NODE_H > maxY) maxY = pos.y + NODE_H;
    });
    // Fold in unknown-parent placeholders. They're overlay nodes (not in
    // `positions`), so read their box straight off the transform we set —
    // otherwise a phantom sitting above the top row or beyond a side edge
    // would be clipped out of the fitted viewBox and the PNG export.
    if (nodesG) {
      nodesG.querySelectorAll(".t-phantom-node").forEach((g) => {
        const t = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(g.getAttribute("transform") || "");
        if (!t) return;
        const px = parseFloat(t[1]);
        const py = parseFloat(t[2]);
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px + NODE_W > maxX) maxX = px + NODE_W;
        if (py + NODE_H > maxY) maxY = py + NODE_H;
      });
      // Focus-mode cluster stacks are overlays too (transform-positioned about
      // their CENTRE, not a top-left box). Frame a node-sized box around each so
      // a stack sitting below the last row or beside a side node isn't clipped.
      nodesG.querySelectorAll(".t-node-cluster").forEach((g) => {
        const t = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(g.getAttribute("transform") || "");
        if (!t) return;
        const ccx = parseFloat(t[1]);
        const ccy = parseFloat(t[2]);
        if (ccx - NODE_W / 2 < minX) minX = ccx - NODE_W / 2;
        if (ccy - PHOTO_R < minY) minY = ccy - PHOTO_R;
        if (ccx + NODE_W / 2 > maxX) maxX = ccx + NODE_W / 2;
        if (ccy + PHOTO_R + 24 > maxY) maxY = ccy + PHOTO_R + 24;
      });
    }
    // Fold in the era gutter (also an overlay, left of every row) so the widest
    // decade label — wider in Hindi — never clips at the left edge. getBBox is
    // exact and language-agnostic; skip cleanly if the layer is empty/detached.
    if (labelsG && labelsG.childElementCount) {
      try {
        const b = labelsG.getBBox();
        if (b.width || b.height) {
          if (b.x < minX) minX = b.x;
          if (b.x + b.width > maxX) maxX = b.x + b.width;
        }
      } catch (_) {}
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function fitViewBox(bbox) {
    const svgW = svgEl.clientWidth || 1000;
    const svgH = svgEl.clientHeight || 600;
    const aspect = svgW / svgH || 1;
    let w = bbox.w + PAD * 2;
    let h = bbox.h + PAD * 2;
    // Match aspect ratio
    if (w / h > aspect) {
      h = w / aspect;
    } else {
      w = h * aspect;
    }
    const cx = bbox.x + bbox.w / 2;
    const cy = bbox.y + bbox.h / 2;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }

  function isViewBoxReasonable(vb, bbox) {
    if (!bbox || !vb || !isFinite(vb.w) || vb.w <= 0) return false;
    const minW = bbox.w * 0.2;
    const maxW = (bbox.w + PAD * 2) * 4;
    if (vb.w < minW || vb.w > maxW) return false;
    // Must overlap
    const r1 = { x: vb.x, y: vb.y, x2: vb.x + vb.w, y2: vb.y + vb.h };
    const r2 = { x: bbox.x - PAD, y: bbox.y - PAD, x2: bbox.x + bbox.w + PAD, y2: bbox.y + bbox.h + PAD };
    if (r1.x2 < r2.x || r2.x2 < r1.x) return false;
    if (r1.y2 < r2.y || r2.y2 < r1.y) return false;
    return true;
  }

  function clampZoomWidth(w) {
    if (!lastBBox) return w;
    const minW = lastBBox.w * 0.2;
    const maxW = lastBBox.w * 4;
    return Math.max(minW, Math.min(maxW, w));
  }

  // ===== View options popover =====
  // Anchored under the sliders button in the tree-controls cluster. Opens
  // a small heritage-styled menu with toggle rows for the per-view display
  // preferences. Each toggle calls its setShow* and re-renders.
  function openViewOptions(anchorBtn) {
    // Close any existing popover so re-clicking the button toggles it off.
    const existing = document.querySelector(".tree-view-options");
    if (existing) { existing.remove(); document.removeEventListener("click", onAway, true); return; }

    const pop = UI.el("div", { class: "tree-view-options", role: "menu" });
    function row(label, icon, on, onChange) {
      const cb = UI.el("input", { type: "checkbox" });
      cb.checked = !!on;
      cb.addEventListener("change", () => onChange(cb.checked));
      return UI.el("label", { class: "tree-view-options__row" }, [
        UI.el("i", { class: icon + " tree-view-options__icon", "aria-hidden": "true" }),
        UI.el("span", { class: "tree-view-options__label" }, label),
        UI.el("span", { class: "tree-view-options__switch" }, [cb, UI.el("span", { class: "tree-view-options__track" })])
      ]);
    }

    pop.appendChild(UI.el("div", { class: "tree-view-options__head" }, I18n.t("tree.optionsTitle")));
    pop.appendChild(row(I18n.t("tree.showPets"),       "fa-solid fa-paw",        showPets,       setShowPets));
    pop.appendChild(row(I18n.t("tree.showAge"), "fa-solid fa-hourglass-half",  showAge, setShowAge));
    pop.appendChild(row(I18n.t("tree.showDates"),      "fa-regular fa-calendar", showDates,      setShowDates));
    pop.appendChild(row(I18n.t("tree.showEras"),       "fa-solid fa-layer-group", showEras,      setShowEras));
    // Relation-to-me pills only mean anything once a "self" is pinned, so the
    // toggle only appears then — otherwise it's a dead switch with nothing to
    // act on. Pinning someone (right-click → "This is me") reveals it.
    if (window.SelfAnchor && SelfAnchor.get()) {
      pop.appendChild(row(I18n.t("tree.showRelationToMe"), "fa-solid fa-people-arrows", showRelationToMe, setShowRelationToMe));
    }

    stageEl.appendChild(pop);
    // Position relative to the anchor button — bottom-aligned so the menu
    // grows upward (controls cluster sits at the bottom of the stage).
    const stage = stageEl.getBoundingClientRect();
    const a = anchorBtn.getBoundingClientRect();
    pop.style.right = (stage.right - a.right) + "px";
    pop.style.bottom = (stage.bottom - a.top + 6) + "px";

    function onAway(e) {
      if (pop.contains(e.target) || anchorBtn.contains(e.target)) return;
      pop.remove();
      document.removeEventListener("click", onAway, true);
    }
    setTimeout(() => document.addEventListener("click", onAway, true), 0);
  }

  function zoomBy(factor, anchorClientX, anchorClientY) {
    // A deliberate zoom (wheel / +/- buttons) supersedes a re-centre tween.
    cancelViewBoxAnim();
    // anchor is in viewBox coords; default to center
    let ax, ay;
    if (anchorClientX != null && anchorClientY != null) {
      const pt = clientToViewBox(anchorClientX, anchorClientY);
      ax = pt.x; ay = pt.y;
    } else {
      ax = viewBox.x + viewBox.w / 2;
      ay = viewBox.y + viewBox.h / 2;
    }
    const newW = clampZoomWidth(viewBox.w * factor);
    const actualFactor = newW / viewBox.w;
    const newH = viewBox.h * actualFactor;
    viewBox.x = ax - (ax - viewBox.x) * actualFactor;
    viewBox.y = ay - (ay - viewBox.y) * actualFactor;
    viewBox.w = newW;
    viewBox.h = newH;
    userInteracted = true;
    applyViewBox();
  }

  function resetView() {
    cancelViewBoxAnim();
    if (lastBBox) {
      viewBox = fitViewBox(lastBBox);
      userInteracted = false;
      applyViewBox();
    }
  }

  // Pan the viewBox so a node is visible, but ONLY if it currently sits outside
  // (or near the edge of) the viewport — unlike revealPerson(), which always
  // recentres and zooms. Used on keyboard focus: Tab walks nodes in DOM order,
  // and a node off-screen would otherwise take focus with no pan and no cue.
  // Keeps the user's zoom; nudges just enough to bring the node fully in with a
  // small margin. No-op while a pointer drag/pinch is mid-gesture.
  function panIntoView(personId) {
    if (!personId || !svgEl || activePointers.size) return;
    if (!(isFinite(viewBox.w) && viewBox.w > 0)) return;
    const pos = lastPositions && lastPositions.get ? lastPositions.get(personId) : null;
    if (!pos) return;
    const margin = Math.min(NODE_W, viewBox.w * 0.12);
    const left = viewBox.x + margin, right = viewBox.x + viewBox.w - margin;
    const top = viewBox.y + margin, bottom = viewBox.y + viewBox.h - margin;
    let nx = viewBox.x, ny = viewBox.y, moved = false;
    if (pos.x < left) { nx = pos.x - margin; moved = true; }
    else if (pos.x + NODE_W > right) { nx = pos.x + NODE_W + margin - viewBox.w; moved = true; }
    if (pos.y < top) { ny = pos.y - margin; moved = true; }
    else if (pos.y + NODE_H > bottom) { ny = pos.y + NODE_H + margin - viewBox.h; moved = true; }
    if (!moved) return;
    viewBox = { x: nx, y: ny, w: viewBox.w, h: viewBox.h };
    userInteracted = true; // don't let the next render snap back to fit
    applyViewBox();
  }

  /**
   * Pan (and gently zoom in if needed) so `personId`'s node is centred in the
   * viewport, then select them. Used after adding a relative so the freshly
   * created node is never left off-screen. No-op if the person isn't in the
   * current layout (e.g. a pet while pets are hidden) beyond selecting them.
   */
  function revealPerson(personId) {
    if (!personId) return;
    // "Reveal in tree" is an explicit navigation to one person (from a People
    // card, Timeline row, relationship chip, or the Find-a-relation modal). It
    // must win over a lingering compare path — otherwise the path-owns-highlight
    // guard in applyHighlightClasses would ignore the incoming selection and
    // keep painting the old route. Clear compare state first.
    if (pathAId || compareArmed) { resetComparePathState(); compareArmed = false; updateCompareBtn(); }
    // The node may have just been added — layout is recomputed synchronously
    // on the FamilyStore change that precedes this call, so lastPositions is
    // already current. If it somehow isn't there, fall back to selection only.
    const pos = lastPositions && lastPositions.get ? lastPositions.get(personId) : null;
    if (pos && svgEl && isFinite(viewBox.w) && viewBox.w > 0) {
      const nodeCx = pos.x + NODE_W / 2;
      const nodeCy = pos.y + NODE_H / 2;
      // If we're zoomed far out, tighten to a comfortable close-up; otherwise
      // keep the user's current zoom and just recentre.
      let w = viewBox.w, h = viewBox.h;
      const comfortableW = NODE_W * 6;
      if (w > comfortableW) {
        const scale = comfortableW / w;
        w = comfortableW;
        h = h * scale;
      }
      viewBox = { x: nodeCx - w / 2, y: nodeCy - h / 2, w, h };
      userInteracted = true; // don't let the next render snap back to fit
      applyViewBox();
    }
    if (window.Inspector && Inspector.show) Inspector.show(personId);
    applyHighlightClasses();
    // Move DOM focus onto the revealed node. "Reveal in tree" is an explicit
    // navigation, and every .t-node is a tabindex=0 role=button; without this a
    // keyboard user bounced here from another view (relationship chip, People
    // card, Timeline row) lands with focus stranded on <body>. preventScroll so
    // the browser doesn't fight the pan we just applied.
    if (nodesG) {
      const g = nodesG.querySelector('.t-node[data-person-id="' + (window.CSS && CSS.escape ? CSS.escape(personId) : personId) + '"]');
      if (g && g.focus) { try { g.focus({ preventScroll: true }); } catch (_) { g.focus(); } }
    }
  }

  function clientToViewBox(cx, cy) {
    const rect = svgEl.getBoundingClientRect();
    const fx = (cx - rect.left) / rect.width;
    const fy = (cy - rect.top) / rect.height;
    return { x: viewBox.x + fx * viewBox.w, y: viewBox.y + fy * viewBox.h };
  }

  function attachInteractions() {
    svgEl.addEventListener("pointerdown", onPointerDown);
    svgEl.addEventListener("pointermove", onPointerMove);
    svgEl.addEventListener("pointerup", onPointerUp);
    svgEl.addEventListener("pointercancel", onPointerUp);
    svgEl.addEventListener("pointerleave", onPointerUp);
    // Wheel zoom
    svgEl.addEventListener("wheel", (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 0.9 : 1.1;
      zoomBy(factor, e.clientX, e.clientY);
    }, { passive: false });
  }

  function onPointerDown(e) {
    // Dismiss any open contextual menu when starting a pan or pinch.
    if (openMenu) dismissMenu();
    // A hand on the canvas always wins over an in-flight re-centre tween.
    cancelViewBoxAnim();
    // Don't capture the pointer here — capturing makes every subsequent
    // click target the SVG itself, which prevents node click handlers from
    // firing. We only capture once a drag is actually detected (in
    // onPointerMove, after crossing the move threshold).
    activePointers.set(e.pointerId, {
      x: e.clientX, y: e.clientY,
      startX: e.clientX, startY: e.clientY,
      moved: false, captured: false
    });

    if (activePointers.size === 1) {
      panStart = {
        clientX: e.clientX,
        clientY: e.clientY,
        vbx: viewBox.x,
        vby: viewBox.y
      };
      pinchStart = null;
    } else if (activePointers.size === 2) {
      const pts = Array.from(activePointers.values());
      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      const dist = Math.hypot(dx, dy);
      const midClientX = (pts[0].x + pts[1].x) / 2;
      const midClientY = (pts[0].y + pts[1].y) / 2;
      const mid = clientToViewBox(midClientX, midClientY);
      pinchStart = {
        dist,
        midX: mid.x,
        midY: mid.y,
        vb: { ...viewBox }
      };
      panStart = null;
    }
  }

  function onPointerMove(e) {
    const tracked = activePointers.get(e.pointerId);
    if (!tracked) return;
    tracked.x = e.clientX;
    tracked.y = e.clientY;
    if (Math.hypot(e.clientX - tracked.startX, e.clientY - tracked.startY) > 4) {
      tracked.moved = true;
      // Now we know it's a real drag — claim the pointer so subsequent
      // moves outside the SVG still pan the tree, and node clicks below
      // don't accidentally trigger.
      if (!tracked.captured) {
        try { svgEl.setPointerCapture(e.pointerId); tracked.captured = true; } catch (_) {}
      }
    }

    if (activePointers.size === 1 && panStart) {
      const rect = svgEl.getBoundingClientRect();
      const dx = (e.clientX - panStart.clientX) * (viewBox.w / rect.width);
      const dy = (e.clientY - panStart.clientY) * (viewBox.h / rect.height);
      viewBox.x = panStart.vbx - dx;
      viewBox.y = panStart.vby - dy;
      userInteracted = true;
      applyViewBox();
    } else if (activePointers.size >= 2 && pinchStart) {
      const pts = Array.from(activePointers.values()).slice(0, 2);
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      if (dist > 0 && pinchStart.dist > 0) {
        const ratio = pinchStart.dist / dist; // larger gap => smaller w (zoom in)
        let newW = pinchStart.vb.w * ratio;
        newW = clampZoomWidth(newW);
        const actualRatio = newW / pinchStart.vb.w;
        const newH = pinchStart.vb.h * actualRatio;
        // Anchor at original midpoint
        viewBox.x = pinchStart.midX - (pinchStart.midX - pinchStart.vb.x) * actualRatio;
        viewBox.y = pinchStart.midY - (pinchStart.midY - pinchStart.vb.y) * actualRatio;
        viewBox.w = newW;
        viewBox.h = newH;
        userInteracted = true;
        applyViewBox();
      }
    }
  }

  function onPointerUp(e) {
    if (svgEl.hasPointerCapture && svgEl.hasPointerCapture(e.pointerId)) {
      try { svgEl.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
    }
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2) pinchStart = null;
    if (activePointers.size === 0) panStart = null;
    if (activePointers.size === 1) {
      // resume pan from remaining pointer
      const remaining = Array.from(activePointers.values())[0];
      panStart = {
        clientX: remaining.x,
        clientY: remaining.y,
        vbx: viewBox.x,
        vby: viewBox.y
      };
    }
  }

  if (window.I18n && I18n.onChange) I18n.onChange(() => { if (rootEl) render(); });

  // The rail's faceted Filter panel owns the predicate; the tree just DIMS
  // (never hides) nodes that don't match, so the family's shape is preserved.
  // setFilter() takes no argument now — it re-reads window.Filter on each call.
  function setFilter() {
    applyFilterClasses();
  }
  function applyFilterClasses() {
    if (!nodesG) return;
    const active = !!(window.Filter && Filter.isActive && Filter.isActive());
    const match = (window.Filter && Filter.matches) ? Filter.matches : () => true;
    nodesG.querySelectorAll(".t-node").forEach((g) => {
      const id = g.getAttribute("data-person-id");
      const p = id && FamilyStore.getPerson(id);
      g.classList.toggle("is-dim", active && !!p && !match(p));
    });
  }

  // === Lineage highlighting ===
  // When a person is selected, "Viewing as X" treats X (and any spouse) as
  // the visual root of a subtree, then fades everything else. In the default
  // "descendants" mode we deliberately do NOT walk ancestors — when you focus
  // on a person you usually want them at the top of the highlight, with their
  // descendants below. Ancestors and siblings stay rendered (faded) so context
  // isn't lost, but no bright line appears *above* the focus root. ("Bloodline"
  // mode, below, is the exception: it walks UP the direct parent line too.)
  function lineageOf(rootId, mode) {
    const set = new Set();
    if (!rootId) return set;
    set.add(rootId);
    // Pull spouses of the focus, so partners are co-roots.
    const focus = FamilyStore.getPerson(rootId);
    if (focus) (focus.spouses || []).forEach((sid) => set.add(sid));
    // Walk descendants from every co-root (focus + spouses).
    const stackDown = Array.from(set);
    while (stackDown.length) {
      const id = stackDown.pop();
      FamilyStore.getChildrenOf(id).forEach((c) => { if (!set.has(c.id)) { set.add(c.id); stackDown.push(c.id); } });
    }
    // "Bloodline" mode also walks UP: every ancestor of the focus (the direct
    // blood line, not their whole subtrees) so you can trace where a person
    // came from, not just who came after. Only the focus's own parents are
    // followed — we intentionally don't re-descend into ancestors' other
    // branches, which would light up cousins and dilute the through-line.
    if (mode === "bloodline") {
      const stackUp = focus ? (focus.parents || []).slice() : [];
      while (stackUp.length) {
        const id = stackUp.pop();
        if (set.has(id)) continue;
        set.add(id);
        const anc = FamilyStore.getPerson(id);
        if (anc) (anc.parents || []).forEach((pid) => { if (!set.has(pid)) stackUp.push(pid); });
      }
    }
    // Pull every spouse of every in-lineage descendant (so partners stay bright)
    Array.from(set).forEach((id) => {
      const p = FamilyStore.getPerson(id);
      if (!p) return;
      (p.spouses || []).forEach((sid) => set.add(sid));
    });
    // Pull every pet whose owner is in lineage — companion animals belong
    // to the family record they're tethered to, so they stay bright too.
    FamilyStore.getPeople().forEach((p) => {
      if (!p.isPet) return;
      const owners = p.petOwners || [];
      if (owners.some((oid) => set.has(oid))) set.add(p.id);
    });
    return set;
  }

  // ===== Relationship-path highlighting (#94) =====
  // Shift-click (desktop) or the armed "Compare" toggle (touch/keyboard) picks
  // two people; FamilyStore.findRelationPath BFS's the shortest chain between
  // them, which we light along the REAL .t-edge / knot elements using the same
  // is-selected / is-lineage / is-faded vocabulary as lineage focus. No new DOM
  // and no new export handling — the exporter already strips these three
  // classes (image-export.js) so a saved PNG is unaffected by an active path.
  function resetComparePathState() {
    pathAId = pathBId = null;
    pathIds = pathEdgePairs = pathSpousePairs = pathOrdered = null;
    pathLen = 0;
  }
  // Fully clear compare mode (state + armed toggle) and repaint. Interactive
  // exits (button off, banner reset, plain-click into the inspector) use this.
  function clearComparePath() {
    resetComparePathState();
    compareArmed = false;
    updateCompareBtn();
    applyHighlightClasses();
  }
  // Turn the two-anchor id chain into the membership sets the paint pass reads.
  // A hop is a spouse link if the two are each other's spouses; otherwise it's
  // a parent-child adjacency (either direction). Keys are sorted "a|b" so the
  // edge / knot tests are order-independent.
  function buildPathSets(path) {
    pathIds = new Set(path);
    pathOrdered = path.slice();
    pathLen = path.length;
    pathEdgePairs = new Set();
    pathSpousePairs = new Set();
    for (let i = 0; i < path.length - 1; i++) {
      const x = path[i], y = path[i + 1];
      const key = x < y ? x + "|" + y : y + "|" + x;
      const px = FamilyStore.getPerson(x);
      if (px && (px.spouses || []).includes(y)) pathSpousePairs.add(key);
      else pathEdgePairs.add(key);
    }
  }
  // An edge belongs to the path if it carries BOTH endpoints of some parent-child
  // hop. The lineage `every(id in set)` rule is wrong here: a trunk/rail shared
  // by a whole sibling group lists every sibling in data-edge-ids, so a thin
  // two-person chain would never satisfy `every`. "Both endpoints of one hop
  // present" lights the trunk + rail + the ONE child's riser while leaving the
  // other siblings' risers (which carry the parents but not this child) dark.
  function edgeOnPath(idSet) {
    if (!pathEdgePairs) return false;
    let hit = false;
    pathEdgePairs.forEach((key) => {
      if (hit) return;
      const parts = key.split("|");
      if (idSet.has(parts[0]) && idSet.has(parts[1])) hit = true;
    });
    return hit;
  }
  // Route a node pick (from shift-click or an armed tap) into the anchor state
  // machine: pick A → pick B (compute + light) → pick again restarts a fresh
  // comparison. Re-tapping A while awaiting B cancels.
  function handleComparePick(id) {
    if (!FamilyStore.getPerson(id)) return;
    // Fresh comparison — either nothing picked yet, or a completed pair exists
    // and this tap starts over with the new person as anchor A.
    if (!pathAId || (pathAId && pathBId)) {
      lineageFocusId = null; // path mode and sticky lineage focus are exclusive
      if (window.Inspector && Inspector.clear) Inspector.clear();
      pathAId = id;
      pathBId = null;
      pathIds = pathEdgePairs = pathSpousePairs = pathOrdered = null;
      pathLen = 0;
      updateCompareBtn();
      applyHighlightClasses();
      return;
    }
    // Awaiting the second anchor.
    if (id === pathAId) { clearComparePath(); return; } // re-tap A cancels
    const path = FamilyStore.findRelationPath(pathAId, id);
    if (!path || path.length < 2) {
      if (window.UI && UI.toast) UI.toast(I18n.t("tree.compareNoPath"), "info");
      return; // stay armed on A so another second person can be tried
    }
    pathBId = id;
    buildPathSets(path);
    // Armed (touch) mode stays armed so the next tap starts a fresh compare;
    // a shift-click (unarmed) leaves the path until a plain click dismisses it.
    updateCompareBtn();
    applyHighlightClasses();
  }
  // The tree-controls "Compare" button: one clean on/off for the whole compare
  // state. On → arm pick mode (clearing competing highlights); off → wipe the
  // path and disarm.
  function toggleCompareMode() {
    const on = compareArmed || !!pathAId;
    if (on) { clearComparePath(); return; }
    // If a person is already selected, pre-seed them as anchor A so the user
    // only has to pick the second person — starting from "compare X with…"
    // rather than an empty two-picks-from-scratch. Captured BEFORE Inspector
    // .clear() below wipes the selection.
    const preselected = window.Inspector && Inspector.getSelected ? Inspector.getSelected() : null;
    compareArmed = true;
    lineageFocusId = null;
    if (window.Inspector && Inspector.clear) Inspector.clear();
    resetComparePathState();
    if (preselected && FamilyStore.getPerson(preselected)) {
      // Route through the pick state machine so anchor A + its gold highlight
      // are set exactly as a manual first tap would (Inspector.clear already
      // ran, so handleComparePick's own clear is a no-op here).
      handleComparePick(preselected);
    } else {
      updateCompareBtn();
      applyHighlightClasses();
    }
  }
  function updateCompareBtn() {
    if (!compareBtnEl) return;
    const on = compareArmed || !!pathAId;
    compareBtnEl.classList.toggle("is-active", on);
    compareBtnEl.setAttribute("aria-pressed", on ? "true" : "false");
  }
  function updateModeBtn() {
    if (!modeBtnEl) return;
    const on = treeMode === "focus";
    modeBtnEl.classList.toggle("is-active", on);
    modeBtnEl.setAttribute("aria-pressed", on ? "true" : "false");
  }
  // Paint pass for compare mode. Anchors go gold (is-selected), intermediate
  // hops olive (is-lineage), everyone else fades — exactly the lineage look.
  // While only anchor A is chosen (awaiting B) NOTHING fades, so the whole tree
  // stays legible for finding the second person.
  function applyPathHighlight() {
    const awaiting = !pathBId || !pathIds;
    nodesG.querySelectorAll(".t-node").forEach((g) => {
      const id = g.getAttribute("data-person-id");
      const isAnchor = id === pathAId || id === pathBId;
      const onPath = !awaiting && pathIds.has(id);
      g.classList.toggle("is-selected", isAnchor);
      g.classList.toggle("is-lineage", onPath && !isAnchor);
      g.classList.toggle("is-faded", !awaiting && !onPath);
    });
    if (edgesG) {
      svgEl.querySelectorAll(".t-edge").forEach((edge) => {
        const idSet = new Set((edge.getAttribute("data-edge-ids") || "").split(",").filter(Boolean));
        const on = !awaiting && edgeOnPath(idSet);
        edge.classList.toggle("is-lineage", on);
        edge.classList.toggle("is-faded", !awaiting && !on);
      });
      svgEl.querySelectorAll("g.t-couple-knot").forEach((g) => {
        const a = g.getAttribute("data-left-id");
        const b = g.getAttribute("data-right-id");
        const key = a && b ? (a < b ? a + "|" + b : b + "|" + a) : null;
        const on = !awaiting && !!key && !!pathSpousePairs && pathSpousePairs.has(key);
        g.classList.toggle("is-lineage", on);
        g.classList.toggle("is-faded", !awaiting && !on);
      });
    }
    updateLineageBanner(null); // keep the two banners mutually exclusive
    updateCompareBanner();
  }

  // Broadcast sticky lineage-focus changes so views other than Tree can show a
  // "focused on X" cue (they can't see this module's local lineageFocusId). Only
  // the STICKY focus is exported — a transient inspector tap-selection isn't a
  // mode the user is "in". Deduped so a re-render with unchanged focus is silent.
  // Fired from applyHighlightClasses (the one choke point every focus mutation
  // funnels through); lineageFocusId is always null in path mode (mutually
  // exclusive), so path mode correctly broadcasts "no focus".
  let lastEmittedFocusId = undefined;
  function emitLineageFocus() {
    if (lineageFocusId === lastEmittedFocusId) return;
    lastEmittedFocusId = lineageFocusId;
    try {
      window.dispatchEvent(new CustomEvent("virasat:lineage-focus", {
        detail: { id: lineageFocusId, mode: lineageFocusId ? lineageFocusMode : null }
      }));
    } catch (_) {}
  }
  function getLineageFocus() {
    return lineageFocusId ? { id: lineageFocusId, mode: lineageFocusMode } : null;
  }
  // Public entry point for other views to clear the focus (via the cross-view
  // cue's "Clear focus" button). Mirrors the in-stage banner's reset.
  function clearLineageFocus() {
    if (!lineageFocusId) return;
    lineageFocusId = null;
    applyHighlightClasses();
  }

  function applyHighlightClasses() {
    if (!nodesG) return;
    emitLineageFocus();
    // Relationship-path mode owns the entire dim/highlight pass whenever an
    // anchor is set, so a lingering inspector selection can't fight it.
    if (pathAId) { applyPathHighlight(); return; }
    const selectedId = window.Inspector && Inspector.getSelected ? Inspector.getSelected() : null;
    // Sticky focus wins over transient inspector selection. Selection alone
    // produces the same dim effect on selection-change; sticky focus
    // persists across inspector open/close cycles so phone users can
    // actually see the dimmed tree once the inspector slides away.
    const focusRoot = lineageFocusId || selectedId;
    // Bloodline (ancestor) walk only applies to a sticky focus the user
    // explicitly chose; a transient inspector selection always stays
    // descendants-only so a plain tap never lights up half the tree.
    const mode = lineageFocusId ? lineageFocusMode : "descendants";
    const lineage = focusRoot ? lineageOf(focusRoot, mode) : null;

    nodesG.querySelectorAll(".t-node").forEach((g) => {
      const id = g.getAttribute("data-person-id");
      g.classList.toggle("is-selected", !!selectedId && id === selectedId);
      g.classList.toggle("is-lineage", !!lineage && lineage.has(id) && id !== focusRoot);
      g.classList.toggle("is-faded", !!lineage && !lineage.has(id));
    });
    // Edges: brighten the ones connecting two in-lineage nodes; fade the rest.
    if (edgesG) {
      const allEdges = svgEl.querySelectorAll(".t-edge");
      allEdges.forEach((edge) => {
        const ids = (edge.getAttribute("data-edge-ids") || "").split(",").filter(Boolean);
        // A parent→children connector's trunk + rail carry the WHOLE sibling
        // group, so a plain `every(id in lineage)` fades the entire connector
        // the moment one sibling is out of focus — which hid a focused child's
        // own link up to their parents (the reported "line above them is
        // hidden"). Edges tagged with data-edge-parents light on the correct
        // rule instead: all the parents are in lineage AND at least one of the
        // children this specific segment serves is in lineage. Untagged edges
        // (per-child risers, pet connectors) never carried a foreign sibling,
        // so they keep the exact `every` test via the fallback.
        const parentsAttr = edge.getAttribute("data-edge-parents");
        let allIn;
        if (parentsAttr != null) {
          const parents = parentsAttr.split(",").filter(Boolean);
          const childIds = ids.filter((id) => parents.indexOf(id) === -1);
          allIn = !!lineage && parents.length > 0
            && parents.every((id) => lineage.has(id))
            && childIds.some((id) => lineage.has(id));
        } else {
          allIn = !!lineage && ids.length > 0 && ids.every((id) => lineage.has(id));
        }
        edge.classList.toggle("is-lineage", !!lineage && allIn);
        edge.classList.toggle("is-faded", !!lineage && !allIn);
      });
      const allKnots = svgEl.querySelectorAll("g.t-couple-knot");
      allKnots.forEach((g) => {
        const a = g.getAttribute("data-left-id");
        const b = g.getAttribute("data-right-id");
        const both = lineage && a && b && lineage.has(a) && lineage.has(b);
        g.classList.toggle("is-lineage", !!both);
        g.classList.toggle("is-faded", !!lineage && !both);
      });
    }
    updateLineageBanner(focusRoot);
    updateCompareBanner(); // pathAId is null here → hides the compare pill
  }

  // ===== "Relation to me" overlay (the SelfAnchor lens) =====
  // A pure decoration keyed by person id, drawn on top of the finished nodes
  // and deliberately OUTSIDE topoSignature — so pinning "me" (a per-viewer,
  // local-only lens) never busts the expensive layout cache. It paints:
  //   - a small gold "you are here" disc on the pinned self node (whenever a
  //     self is set, regardless of the relation-pill toggle), and
  //   - an olive relation chip (chacha, bua, bhatija…) in the subtitle slot of
  //     each CLOSE-KIN node, gated by showRelationToMe. KinTerms returns null
  //     beyond close kin, so distant relatives simply get no chip.
  // Everything it adds carries .t-node-selfdeco so the export pipeline can strip
  // it in one selector (a personal lens must never bleed into a shared image).
  let lastKinSig = null;
  function kinSignature(selfId) {
    // What the chips depend on BEYOND topology (topology already busts the
    // layout cache via topoSignature): the anchor, the toggle, the language,
    // and every person's gender + birth year — both feed KinTerms' side and
    // seniority splits (chacha vs mama, tau vs chacha) yet neither is in the
    // topo signature. Cheap string build, no BFS, so an unrelated soft render
    // (a name keystroke) matches the last signature and skips the relabel.
    const lang = (window.I18n && I18n.getLang) ? I18n.getLang() : "en";
    const parts = [selfId || "", showRelationToMe ? "1" : "0", lang];
    FamilyStore.getPeople().forEach((p) => {
      parts.push(p.id + ":" + (p.gender || "") + ":" + (FamilyStore.getYear(p.birthDate) || ""));
    });
    return parts.join("|");
  }
  function clearSelfDeco() {
    if (!nodesG) return;
    nodesG.querySelectorAll(".t-node-selfdeco").forEach((n) => n.remove());
    nodesG.querySelectorAll(".t-node.is-self").forEach((g) => g.classList.remove("is-self"));
    // A relation chip borrows the subtitle row, so any date it hid must come
    // back when the chip goes away.
    nodesG.querySelectorAll(".t-node-dates").forEach((d) => { d.style.display = ""; });
  }
  function appendRelPill(g, text, fullTitle, neighbourDist) {
    // Sits in the subtitle slot (where the dates row lives) rather than over the
    // photo, so a face is never covered. When the node is also showing dates,
    // the chip takes that row and the date is hidden for this node only (the
    // full dates stay in the inspector) — the relation is what this lens is for.
    const dateEl = g.querySelector(".t-node-dates");
    if (dateEl) dateEl.style.display = "none";
    const y = PHOTO_CY + PHOTO_R + 40;
    // Width budget: normally the full node width, but capped so this pill can't
    // collide with the pill on the nearest same-row neighbour. Couples render
    // just NODE_W + X_GAP_COUPLE = 98px apart centre-to-centre while the node
    // box is 160px wide, so two full-width pills would overlap by ~58px (the
    // reported bug). `neighbourDist` is the centre-to-centre distance to the
    // closest neighbour; two centred pills clear each other when each is ≤ that
    // distance minus a small gutter. Undefined (lone node in its row) → no cap.
    const GUTTER = 12;
    const budget = neighbourDist
      ? Math.max(48, Math.min(NODE_W - 4, neighbourDist - GUTTER))
      : NODE_W - 4;
    const grp = svgEl_("g", { class: "t-node-selfdeco t-node-relpill" });
    g.appendChild(grp);
    // Full precise term as the group's <title> — the native hover tooltip. It
    // lives on the GROUP (not the text) so it survives the ellipsize below,
    // which resets the label's textContent (and would wipe a title child), and
    // so hovering anywhere on the pill (backing rect included) reveals it. The
    // pill takes pointer events for this; the node behind it still gets clicks
    // because SVG events bubble up to the .t-node <g> (its onclick opens the
    // inspector), so tap-to-select keeps working through the chip.
    if (fullTitle) grp.appendChild(svgEl_("title", null, fullTitle));
    const label = svgEl_("text", {
      class: "t-node-relpill-text", "text-anchor": "middle", x: NODE_W / 2, y
    }, text);
    grp.appendChild(label);
    // Ellipsize to fit the node's width. Long English glosses ("husband's
    // younger brother's wife") otherwise render past the pill's capped backing
    // and collide with the neighbouring node's chip. The pill can occupy the
    // node's full width minus a hair; the full precise term always stays in the
    // <title> above (+ the inspector), so nothing is lost by trimming here.
    const padX = 8, h = 15;
    const maxTextW = budget - padX * 2;
    const measure = () => {
      try { return label.getComputedTextLength ? label.getComputedTextLength() : 0; } catch (_) { return 0; }
    };
    let w = measure();
    if (!w) w = String(text).length * 6; // headless shim / hidden view estimate
    if (w > maxTextW) {
      // Trim char-by-char until it fits, appending an ellipsis. Guard the loop
      // with a length check so an unmeasurable environment can't spin.
      let s = String(text);
      while (s.length > 1) {
        s = s.slice(0, -1);
        label.textContent = s + "…";
        w = measure();
        if (!w) { w = (s.length + 1) * 6; }
        if (w <= maxTextW) break;
      }
    }
    const rw = Math.min(budget, w + padX * 2);
    const rect = svgEl_("rect", {
      class: "t-node-relpill-bg",
      x: NODE_W / 2 - rw / 2, y: y - 11, width: rw, height: h, rx: h / 2, ry: h / 2
    });
    grp.insertBefore(rect, label); // rect behind the text
  }
  // force=true bypasses the signature guard — used after a full render (nodes
  // were rebuilt, so any prior chips are gone) and on an explicit self/toggle
  // change. The guard only earns its keep on soft renders.
  function decorateSelf(force) {
    if (!nodesG || !window.SelfAnchor) return;
    const selfId = SelfAnchor.get();
    const sig = kinSignature(selfId);
    if (!force && sig === lastKinSig) return;
    lastKinSig = sig;
    clearSelfDeco();
    if (!selfId) return; // nothing pinned → no chips at all
    // Per-node centre-to-centre distance to the nearest same-row neighbour, so a
    // pill's backing can be capped short of a neighbour's (couples sit only 98px
    // apart — see appendRelPill). Rows are keyed by rowIdx; all nodes share
    // NODE_W, so the x-delta between left edges IS the centre-to-centre distance.
    const neighbourDist = new Map();
    if (lastPositions && lastPositions.forEach) {
      const rows = new Map();
      lastPositions.forEach((pos, id) => {
        const r = pos.rowIdx == null ? 0 : pos.rowIdx;
        if (!rows.has(r)) rows.set(r, []);
        rows.get(r).push({ id, x: pos.x });
      });
      rows.forEach((arr) => {
        arr.sort((a, b) => a.x - b.x);
        for (let i = 0; i < arr.length; i++) {
          let best = Infinity;
          if (i > 0) best = Math.min(best, arr[i].x - arr[i - 1].x);
          if (i < arr.length - 1) best = Math.min(best, arr[i + 1].x - arr[i].x);
          if (best !== Infinity) neighbourDist.set(arr[i].id, Math.abs(best));
        }
      });
    }
    nodesG.querySelectorAll(".t-node").forEach((g) => {
      const id = g.getAttribute("data-person-id");
      if (!id) return;
      // The pinned self gets only the gold photo ring (.is-self) — a calm,
      // heritage-idiom marker. No on-node icon badge: the rail "You" picker is
      // where self is set/seen, and its hint explains the ring. The ring is a
      // pure overlay class (stripped from exports), never busting topoSignature.
      if (id === selfId) { g.classList.add("is-self"); return; }
      if (!showRelationToMe) return;
      const path = FamilyStore.findRelationPath(selfId, id);
      const term = window.KinTerms ? KinTerms.label(path) : null;
      if (!term) return;
      // Trim the disambiguating parenthetical from long English glosses
      // ("cousin (paternal uncle's son)" → "cousin") so the node chip stays
      // compact; the full precise term rides along in the <title> + the
      // inspector. Hindi kin words carry no parenthetical.
      const short = term.replace(/\s*\([^)]*\)\s*$/, "");
      appendRelPill(g, short, term, neighbourDist.get(id));
    });
  }

  // ===== "Viewing as Name · Clear focus" banner =====
  let lineageBanner = null;
  function ensureBanner() {
    if (lineageBanner || !stageEl) return;
    const nameEl = UI.el("strong", { class: "lineage-banner__name" }, "");
    const resetBtn = UI.el("button", {
      class: "lineage-banner__reset",
      type: "button",
      onclick: () => {
        // Clear sticky focus first; only clear inspector selection if there
        // wasn't a sticky focus (the sticky path is the user's "I want to
        // see the tree dimmed" mode, the inspector selection is a transient
        // tap-effect — different mental models, different reset paths).
        if (lineageFocusId) {
          lineageFocusId = null;
        } else if (window.Inspector) {
          if (Inspector.clear) Inspector.clear();
          else if (Inspector.show) Inspector.show(null);
        }
        applyHighlightClasses();
      }
    }, [
      UI.el("i", { class: "fa-solid fa-rotate-left", "aria-hidden": "true" }),
      UI.el("span", null, I18n.t("tree.clearFocus") || "Clear focus")
    ]);
    lineageBanner = UI.el("div", {
      class: "lineage-banner",
      role: "status",
      "aria-live": "polite",
      hidden: true
    }, [
      UI.el("span", { class: "lineage-banner__label" }, I18n.t("tree.viewingAs") || "Viewing as"),
      nameEl,
      resetBtn
    ]);
    lineageBanner._nameEl = nameEl;
    stageEl.appendChild(lineageBanner);
  }
  function updateLineageBanner(selectedId) {
    ensureBanner();
    if (!lineageBanner) return;
    if (!selectedId) {
      lineageBanner.hidden = true;
      lineageBanner.classList.remove("is-on");
      return;
    }
    const p = FamilyStore.getPerson(selectedId);
    if (!p) { lineageBanner.hidden = true; return; }
    lineageBanner._nameEl.textContent = FamilyStore.getField(p, "name") || p.name;
    lineageBanner.hidden = false;
    lineageBanner.classList.add("is-on");
  }

  // ===== Relationship-path banner (#94) =====
  // Reuses the .lineage-banner pill so compare mode reads as a sibling of the
  // "Viewing as" state (same position, same "· Clear focus" affordance). Content
  // differs: while arming it prompts for a pick; once a pair is chosen it shows
  // "A → B" plus the direct relation (when adjacent) or a step count.
  let compareBanner = null;
  function ensureCompareBanner() {
    if (compareBanner || !stageEl) return;
    const textEl = UI.el("span", { class: "lineage-banner__name" }, "");
    const labelEl = UI.el("span", { class: "lineage-banner__label" }, "");
    const resetBtn = UI.el("button", {
      class: "lineage-banner__reset",
      type: "button",
      // stopPropagation so "Done" only clears — it must not also trip the
      // banner-body click that reopens Find a Relation.
      onclick: (e) => { e.stopPropagation(); clearComparePath(); }
    }, [
      UI.el("i", { class: "fa-solid fa-check", "aria-hidden": "true" }),
      UI.el("span", null, I18n.t("tree.compareDone"))
    ]);
    compareBanner = UI.el("div", {
      class: "lineage-banner lineage-banner--compare",
      role: "status",
      "aria-live": "polite",
      hidden: true
    }, [labelEl, textEl, resetBtn]);
    compareBanner._textEl = textEl;
    compareBanner._labelEl = labelEl;
    // Clicking the banner body (anywhere but "Done") reopens Find a Relation
    // with the two endpoints prefilled — a shortcut to the full step-by-step
    // chain, or to swap one end. Only meaningful once both anchors are set.
    compareBanner.addEventListener("click", () => {
      if (pathAId && pathBId && pathIds && window.PathFinder) PathFinder.open(pathAId, pathBId);
    });
    stageEl.appendChild(compareBanner);
  }
  function nm(id) {
    const p = FamilyStore.getPerson(id);
    return p ? (FamilyStore.getField(p, "name") || p.name) : "";
  }
  function updateCompareBanner() {
    ensureCompareBanner();
    if (!compareBanner) return;
    // Nothing to show unless we're either armed (touch mode, awaiting pick 1)
    // or at least one anchor is chosen.
    if (!pathAId && !compareArmed) {
      compareBanner.hidden = true;
      compareBanner.classList.remove("is-on");
      return;
    }
    if (!pathAId) {
      // Armed via the button but no anchor yet — tell the user what to do.
      compareBanner._labelEl.textContent = I18n.t("tree.compare");
      compareBanner._textEl.textContent = I18n.t("tree.comparePick1");
    } else if (!pathBId || !pathIds) {
      // First anchor chosen; awaiting the second.
      compareBanner._labelEl.textContent = I18n.t("tree.compare");
      compareBanner._textEl.textContent = nm(pathAId) + "  →  " + I18n.t("tree.comparePick2");
    } else {
      compareBanner._labelEl.textContent = I18n.t("tree.comparePath") || "Path";
      // Name the exact kinship term for how B relates to A ("chacha", "bua",
      // "dada", "chachera bhai", "wife") whenever the path shape is a close-kin
      // signature — this covers direct hops AND the 2-4 hop grandparent / uncle
      // / nephew / cousin shapes the old adjacent-only relationLabel could never
      // name. Shapes outside the lexicon yield null, leaving just the step count.
      let detail = "";
      if (pathOrdered && window.KinTerms) {
        detail = KinTerms.label(pathOrdered) || "";
      }
      const hops = Math.max(0, pathLen - 1);
      const steps = hops === 1
        ? (I18n.t("tree.compareStepOne") || "1 step")
        : (I18n.t("tree.compareSteps", { n: hops }) || (hops + " steps"));
      compareBanner._textEl.textContent = nm(pathAId) + "  →  " + nm(pathBId)
        + "  ·  " + (detail ? detail + "  ·  " : "") + steps;
    }
    // Only a resolved pair is clickable (opens Find a Relation prefilled); while
    // arming / awaiting a pick the pill is passive, so don't invite a click.
    const clickable = !!(pathAId && pathBId && pathIds);
    compareBanner.classList.toggle("is-clickable", clickable);
    if (clickable) compareBanner.setAttribute("title", I18n.t("tree.compareReopen"));
    else compareBanner.removeAttribute("title");
    compareBanner.hidden = false;
    compareBanner.classList.add("is-on");
  }

  global.TreeView = { mount, render, setFilter, applyHighlightClasses, revealPerson, getLineageFocus, clearLineageFocus };

  // Re-apply highlight whenever the inspector's selection changes.
  if (window.Inspector && Inspector.onSelect) {
    Inspector.onSelect(() => applyHighlightClasses());
  } else {
    // Inspector module loads after TreeView in index.html; subscribe lazily.
    setTimeout(() => {
      if (window.Inspector && Inspector.onSelect) Inspector.onSelect(() => applyHighlightClasses());
    }, 0);
  }

  // Repaint the "relation to me" overlay whenever the anchor changes — a pure
  // decoration, so no re-layout (decorateSelf patches the existing nodes). When
  // the anchor is CLEARED, also turn the relation-pill toggle back on for next
  // time: the user's request was that deselecting "this is me" resets the pills
  // to their default (on), so re-pinning someone shows them again without a trip
  // to View Options. Setting force so the paint runs even if the kin signature
  // (people's gender/year) hasn't otherwise moved.
  if (window.SelfAnchor && SelfAnchor.onChange) {
    SelfAnchor.onChange((selfId) => {
      if (!selfId && !showRelationToMe) {
        showRelationToMe = true;
        writeBool("virasat.showRelationToMe", true);
      }
      if (rootEl) decorateSelf(true);
    });
  }
})(window);
