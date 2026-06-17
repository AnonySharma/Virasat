/**
 * Tree view — renders the family as a top-down generational tree in SVG with
 * pan, pinch-zoom, wheel-zoom, and zoom controls.
 *
 * Exposes window.TreeView = { mount(rootEl), render() }.
 */
(function (global) {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const XLINK_NS = "http://www.w3.org/1999/xlink";

  // Layout constants
  const NODE_W = 150;
  const NODE_H = 110;
  const X_GAP = 30;
  const Y_GAP = 80;
  const PHOTO_R = 24;
  const PHOTO_CY = 30;
  const PAD = 60;

  // Module state
  let rootEl = null;
  let svgEl = null;
  let edgesG = null;
  let nodesG = null;
  let stageEl = null;

  // Current viewBox state and bbox of last layout
  let viewBox = { x: 0, y: 0, w: 1000, h: 600 };
  let lastBBox = null;
  let userInteracted = false;

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

  // ===== Mount =====
  function mount(root) {
    rootEl = root;
    UI.clear(rootEl);

    const header = UI.el("header", { class: "view-header", style: { marginBottom: "12px" } }, [
      UI.el("h2", { class: "section-head__title" }, I18n.t("tree.title")),
      UI.el("div", { class: "section-head__sub" }, I18n.t("tree.subtitle"))
    ]);

    stageEl = UI.el("div", { class: "tree-stage" });

    svgEl = svgEl_("svg", {
      class: "tree-svg",
      xmlns: SVG_NS,
      preserveAspectRatio: "xMidYMid meet"
    });
    edgesG = svgEl_("g", { class: "tree-edges" });
    nodesG = svgEl_("g", { class: "tree-nodes" });
    svgEl.appendChild(edgesG);
    svgEl.appendChild(nodesG);

    const legend = UI.el("div", { class: "tree-legend" }, [
      UI.el("span", { class: "tree-legend__item" }, [
        UI.el("span", { class: "tree-legend__swatch", style: { borderColor: "var(--accent-leaf)" } }),
        I18n.t("tree.legendLiving")
      ]),
      UI.el("span", { class: "tree-legend__item" }, [
        UI.el("span", { class: "tree-legend__swatch", style: { borderColor: "var(--ink-4)" } }),
        I18n.t("tree.legendDeceased")
      ]),
      UI.el("span", { class: "tree-legend__item" }, [
        UI.el("span", {
          style: {
            display: "inline-block", width: "18px", height: "2px",
            background: "var(--accent)", borderRadius: "2px"
          }
        }),
        I18n.t("tree.legendCouple")
      ])
    ]);

    const controls = UI.el("div", { class: "tree-controls" }, [
      UI.el("button", { class: "btn", type: "button", "aria-label": "Zoom in", title: "Zoom in",
        onclick: () => zoomBy(0.8) }, "+"),
      UI.el("button", { class: "btn", type: "button", "aria-label": "Zoom out", title: "Zoom out",
        onclick: () => zoomBy(1.25) }, "−"),
      UI.el("button", { class: "btn", type: "button", "aria-label": "Reset view", title: "Reset view",
        onclick: () => resetView() }, "⤢")
    ]);

    stageEl.appendChild(svgEl);
    stageEl.appendChild(legend);
    stageEl.appendChild(controls);

    rootEl.appendChild(header);
    rootEl.appendChild(stageEl);

    attachInteractions();
  }

  // ===== Render =====
  function render() {
    if (!svgEl) return;

    // Remove any prior empty-state overlay
    const prior = stageEl.querySelector(".tree-empty-overlay");
    if (prior) prior.remove();

    const people = FamilyStore.getPeople();
    UI.clear(edgesG);
    UI.clear(nodesG);

    if (people.length === 0) {
      const empty = UI.el("div", {
        class: "tree-empty-overlay",
        style: {
          position: "absolute", inset: "0",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "24px", pointerEvents: "none"
        }
      }, [
        UI.el("div", { class: "empty", style: { pointerEvents: "auto", background: "var(--bg-elev)" } }, [
          UI.el("div", { class: "empty__icon" }, "🌳"),
          UI.el("div", { class: "empty__title" }, "No tree yet"),
          UI.el("div", { class: "empty__text" }, "Add people in the People view to see your tree.")
        ])
      ]);
      stageEl.appendChild(empty);
      return;
    }

    const positions = computeLayout(people);
    drawEdges(positions);
    drawNodes(positions);

    // Signature: draw the edges as ink, then bloom the nodes — but only
    // the first time per session, so subsequent re-renders feel responsive.
    const FIRST_DRAW_KEY = "familyTree.tree.firstDrawShown";
    let shouldAnimate = false;
    try { shouldAnimate = !sessionStorage.getItem(FIRST_DRAW_KEY); } catch (_) {}
    if (shouldAnimate && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      try { sessionStorage.setItem(FIRST_DRAW_KEY, "1"); } catch (_) {}
      // Index every edge so they cascade
      const edges = edgesG.querySelectorAll(".t-edge");
      edges.forEach((edge, i) => {
        edge.style.setProperty("--t-edge-i", String(i));
        // Use the path's actual length for stroke-dasharray
        try {
          const len = edge.getTotalLength ? edge.getTotalLength() : 1000;
          edge.style.setProperty("--t-edge-len", String(Math.max(50, len)));
        } catch (_) {}
      });
      // Index every node by birth year so the eldest blooms first
      const nodes = Array.from(nodesG.querySelectorAll(".t-node"));
      nodes.forEach((node, i) => node.style.setProperty("--t-node-i", String(i)));
      svgEl.classList.add("is-drawing");
      const totalDelay = 700 + nodes.length * 50 + 480;
      setTimeout(() => svgEl.classList.remove("is-drawing"), totalDelay + 100);
    }

    const bbox = computeBBox(positions);
    lastBBox = bbox;

    if (!userInteracted || !isViewBoxReasonable(viewBox, bbox)) {
      viewBox = fitViewBox(bbox);
      applyViewBox();
    } else {
      applyViewBox();
    }
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

    // Sort each row by birth year ascending, nulls last
    sortedGens.forEach((g) => {
      rows.get(g).sort((a, b) => {
        const ya = FamilyStore.getYear(a.birthDate);
        const yb = FamilyStore.getYear(b.birthDate);
        if (ya == null && yb == null) return a.name.localeCompare(b.name);
        if (ya == null) return 1;
        if (yb == null) return -1;
        return ya - yb;
      });
    });

    // Place couples adjacently within each row
    const placedOrder = new Map(); // gen -> [personId, ...]
    sortedGens.forEach((g) => {
      const row = rows.get(g);
      const placed = new Set();
      const order = [];
      row.forEach((p) => {
        if (placed.has(p.id)) return;
        order.push(p.id);
        placed.add(p.id);
        // pull in any same-gen spouse next
        const spouseInGen = p.spouses.find((sid) => {
          const s = byId.get(sid);
          return s && (gen.get(sid) === g) && !placed.has(sid);
        });
        if (spouseInGen) {
          order.push(spouseInGen);
          placed.add(spouseInGen);
        }
      });
      placedOrder.set(g, order);
    });

    // Compute per-row width and find widest
    const rowWidths = new Map();
    let maxRowW = 0;
    placedOrder.forEach((order, g) => {
      const w = order.length * NODE_W + Math.max(0, order.length - 1) * X_GAP;
      rowWidths.set(g, w);
      if (w > maxRowW) maxRowW = w;
    });

    // Generate positions, centering each row
    const positions = new Map(); // id -> { x, y, person, gen }
    sortedGens.forEach((g, rIdx) => {
      const order = placedOrder.get(g);
      const rowW = rowWidths.get(g);
      const offsetX = (maxRowW - rowW) / 2;
      const y = rIdx * (NODE_H + Y_GAP);
      order.forEach((id, i) => {
        const x = offsetX + i * (NODE_W + X_GAP);
        positions.set(id, { x, y, person: byId.get(id), gen: g, rowIdx: rIdx });
      });
    });

    return positions;
  }

  // ===== Edges =====
  function drawEdges(positions) {
    const drawnCouples = new Set();

    // Couple edges
    positions.forEach((pos, id) => {
      const person = pos.person;
      person.spouses.forEach((sid) => {
        const sp = positions.get(sid);
        if (!sp) return;
        if (sp.rowIdx !== pos.rowIdx) return;
        const key = id < sid ? id + "|" + sid : sid + "|" + id;
        if (drawnCouples.has(key)) return;
        drawnCouples.add(key);
        const ax = pos.x + NODE_W / 2;
        const ay = pos.y + 6;
        const bx = sp.x + NODE_W / 2;
        const by = sp.y + 6;
        edgesG.appendChild(svgEl_("line", {
          class: "t-edge t-edge--couple",
          x1: Math.min(ax, bx), y1: ay,
          x2: Math.max(ax, bx), y2: by
        }));
      });
    });

    // Parent -> child edges (L-shaped via rail)
    positions.forEach((pos, id) => {
      const person = pos.person;
      const placedParents = person.parents
        .map((pid) => positions.get(pid))
        .filter(Boolean);
      if (placedParents.length === 0) return;

      let parentMidX, parentBottomY;
      if (placedParents.length === 2) {
        const p1 = placedParents[0];
        const p2 = placedParents[1];
        // If they're adjacent in the same row, anchor at the midpoint of the couple line (top of nodes)
        if (p1.rowIdx === p2.rowIdx) {
          parentMidX = (p1.x + NODE_W / 2 + p2.x + NODE_W / 2) / 2;
          // Anchor below the couple-line/nodes — use node bottom
          parentBottomY = Math.max(p1.y, p2.y) + NODE_H;
        } else {
          // Different rows — average centers
          parentMidX = (p1.x + p2.x) / 2 + NODE_W / 2;
          parentBottomY = Math.max(p1.y, p2.y) + NODE_H;
        }
      } else {
        const p1 = placedParents[0];
        parentMidX = p1.x + NODE_W / 2;
        parentBottomY = p1.y + NODE_H;
      }

      const childTopX = pos.x + NODE_W / 2;
      const childTopY = pos.y;

      const railY = (parentBottomY + childTopY) / 2;

      const d = `M ${parentMidX} ${parentBottomY} L ${parentMidX} ${railY} L ${childTopX} ${railY} L ${childTopX} ${childTopY}`;
      edgesG.appendChild(svgEl_("path", {
        class: "t-edge",
        d
      }));
    });
  }

  // ===== Nodes =====
  function drawNodes(positions) {
    positions.forEach((pos, id) => {
      const p = pos.person;
      const g = svgEl_("g", {
        class: "t-node",
        transform: `translate(${pos.x},${pos.y})`,
        "data-person-id": p.id,
        style: { cursor: "pointer" },
        onclick: (ev) => {
          ev.stopPropagation();
          showNodeMenu(p, pos, ev);
        }
      });

      // Background
      g.appendChild(svgEl_("rect", {
        class: "t-node-bg",
        x: 0, y: 0,
        width: NODE_W, height: NODE_H,
        rx: 14, ry: 14
      }));

      // Photo or initials
      const cx = NODE_W / 2;
      const cy = PHOTO_CY;
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
      } else if (window.PhotoStore && (p.photoId || p.photoUrl)) {
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
        PhotoStore.getUrl(p).then((u) => {
          if (u) { img.setAttribute("href", u); img.setAttributeNS(XLINK_NS, "href", u); }
        });
      } else {
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

      // Photo ring
      const ringClass = "t-node-photo-ring" + (FamilyStore.isDeceased(p) ? " t-node-photo-ring--deceased" : "");
      g.appendChild(svgEl_("circle", {
        class: ringClass,
        cx, cy, r: PHOTO_R
      }));

      // Name (truncate)
      g.appendChild(svgEl_("text", {
        class: "t-node-name",
        "text-anchor": "middle",
        x: NODE_W / 2, y: 70
      }, truncate(displayName, 18)));

      // Dates
      g.appendChild(svgEl_("text", {
        class: "t-node-dates",
        "text-anchor": "middle",
        x: NODE_W / 2, y: 88
      }, formatYears(p)));

      nodesG.appendChild(g);
    });
  }

  function truncate(s, n) {
    if (!s) return "";
    if (s.length <= n) return s;
    return s.slice(0, n - 1).trimEnd() + "…";
  }

  // Contextual menu shown when a tree node is clicked.
  let openMenu = null;
  function dismissMenu() {
    if (openMenu && openMenu.parentNode) openMenu.parentNode.removeChild(openMenu);
    openMenu = null;
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onDocKey, true);
  }
  function onDocClick(e) {
    if (openMenu && !openMenu.contains(e.target)) dismissMenu();
  }
  function onDocKey(e) {
    if (e.key === "Escape") dismissMenu();
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

    const menu = UI.el("div", { class: "tree-node-menu", role: "menu", style: { left: left + "px", top: top + "px", transform: "translateX(-50%)" } }, [
      UI.el("div", { class: "tree-node-menu__head" }, [
        UI.el("div", { class: "tree-node-menu__name" }, displayName),
        UI.el("div", { class: "tree-node-menu__sub" }, lifespan)
      ]),
      menuItem("Open profile", "→", "primary", () => {
        dismissMenu();
        if (window.ProfileView) ProfileView.open(person.id);
      }),
      menuItem("Edit", "✎", null, () => {
        dismissMenu();
        if (window.PeopleView && PeopleView.openForm) PeopleView.openForm(person.id);
      }),
      UI.el("div", { style: { height: "1px", background: "var(--paper-line)", margin: "4px 6px" } }),
      menuItem("Add child", "+", null, () => {
        dismissMenu();
        addRelative(person, "child");
      }),
      menuItem("Add spouse", "♥", null, () => {
        dismissMenu();
        addRelative(person, "spouse");
      }),
      menuItem("Add parent", "↑", null, () => {
        dismissMenu();
        addRelative(person, "parent");
      })
    ]);

    stageEl.appendChild(menu);
    openMenu = menu;
    setTimeout(() => {
      document.addEventListener("click", onDocClick, true);
      document.addEventListener("keydown", onDocKey, true);
    }, 0);
  }

  function menuItem(label, icon, variant, onclick) {
    return UI.el("button", {
      class: "tree-node-menu__item" + (variant ? " tree-node-menu__item--" + variant : ""),
      type: "button",
      role: "menuitem",
      onclick
    }, [
      UI.el("span", { class: "tree-node-menu__icon", "aria-hidden": "true" }, icon),
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

  function formatYears(p) {
    const by = FamilyStore.getYear(p.birthDate);
    const dy = FamilyStore.getYear(p.deathDate);
    if (by == null && dy == null) return "?";
    if (by == null) return "? – " + dy;
    if (dy == null) return FamilyStore.isDeceased(p) ? `${by} – ?` : `${by} – present`;
    return `${by} – ${dy}`;
  }

  // ===== Modal profile =====
  function openProfileModal(person) {
    const body = UI.el("div", { class: "form-stack" }, [
      UI.el("div", { style: { display: "flex", alignItems: "center", gap: "12px" } }, [
        UI.avatar(person, "lg"),
        UI.el("div", {}, [
          UI.el("div", { style: { fontFamily: "var(--font-display)", fontSize: "20px", fontWeight: "600" } }, person.name),
          UI.el("div", { style: { color: "var(--ink-3)", fontSize: "13px", marginTop: "2px" } }, FamilyStore.formatDateRange(person))
        ])
      ]),
      person.birthPlace ? UI.el("div", {}, [
        UI.el("span", { style: { color: "var(--ink-3)", fontSize: "12px" } }, "Born in "),
        UI.el("span", {}, person.birthPlace)
      ]) : null,
      person.deathPlace ? UI.el("div", {}, [
        UI.el("span", { style: { color: "var(--ink-3)", fontSize: "12px" } }, "Died in "),
        UI.el("span", {}, person.deathPlace)
      ]) : null,
      person.notes ? UI.el("div", {
        style: { whiteSpace: "pre-wrap", color: "var(--ink-2)", fontSize: "14px" }
      }, person.notes) : null
    ]);

    UI.openModal({ title: "Profile", body });
  }

  // ===== Pan / zoom =====
  function applyViewBox() {
    svgEl.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
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

  function zoomBy(factor, anchorClientX, anchorClientY) {
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
    if (lastBBox) {
      viewBox = fitViewBox(lastBBox);
      userInteracted = false;
      applyViewBox();
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
    svgEl.setPointerCapture(e.pointerId);
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false });

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

  global.TreeView = { mount, render };
})(window);
