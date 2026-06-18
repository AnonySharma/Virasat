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

  // Layout constants — photo-first heritage cards
  const NODE_W = 160;
  const NODE_H = 150;
  const X_GAP_COUPLE  = 6;   // partners sit almost touching
  const X_GAP_SIBLING = 60;  // siblings / unrelated adjacents
  const Y_GAP = 100;
  const PHOTO_R = 42;       // larger circular portrait
  const PHOTO_CY = 50;      // photo centred near top
  const PAD = 80;

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
  let activeFilter = "all"; // "all" | "alive" | "deceased"

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

    const subEl = UI.el("span", { class: "view-head__sub" }, "");
    const header = UI.el("div", { class: "view-head" }, [
      UI.el("div", { class: "view-head__title-wrap" }, [
        UI.el("h2", { class: "view-head__title", "data-i18n": "tree.title" }, I18n.t("tree.title")),
        subEl
      ]),
      UI.el("div", { class: "view-head__actions" }, [
        UI.el("button", {
          class: "btn", type: "button",
          onclick: () => window.PeopleView && PeopleView.openForm && PeopleView.openForm(null)
        }, [UI.el("i", { class: "fa-solid fa-user-plus" }), UI.el("span", { "data-i18n": "tree.addPerson" }, I18n.t("tree.addPerson"))])
      ])
    ]);
    rootEl.__subEl = subEl;

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

    const controls = UI.el("div", { class: "tree-controls" }, [
      UI.el("button", { class: "btn", type: "button", "aria-label": "Zoom out",
        onclick: () => zoomBy(1.25) }, [UI.el("i", { class: "fa-solid fa-minus" })]),
      UI.el("span", { class: "tree-controls__pct", id: "tree-zoom-pct" }, "100%"),
      UI.el("button", { class: "btn", type: "button", "aria-label": "Zoom in",
        onclick: () => zoomBy(0.8) }, [UI.el("i", { class: "fa-solid fa-plus" })]),
      UI.el("span", { class: "tree-controls__divider" }),
      UI.el("button", { class: "btn", type: "button", "aria-label": "Fit view",
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
  function render() {
    if (!svgEl) return;

    // Remove any prior empty-state overlay
    const prior = stageEl.querySelector(".tree-empty-overlay");
    if (prior) prior.remove();

    const people = FamilyStore.getPeople();
    UI.clear(edgesG);
    UI.clear(nodesG);

    // Update subtitle counts
    if (rootEl && rootEl.__subEl) {
      const gens = (function () { const g = FamilyStore.buildGenerations(); let m = 0; g.forEach((v) => { if (v > m) m = v; }); return people.length ? m + 1 : 0; })();
      const memberStr = people.length === 1 ? I18n.t("tree.memberOne") : I18n.t("tree.memberMany", { n: people.length });
      const genStr = gens === 1 ? I18n.t("tree.generationOne") : I18n.t("tree.generationMany", { n: gens });
      rootEl.__subEl.textContent = memberStr + " · " + genStr;
    }

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
          UI.el("div", { class: "empty__title" }, I18n.t("tree.emptyTitle")),
          UI.el("div", { class: "empty__text" }, I18n.t("tree.emptyText"))
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

    applyFilterClasses();
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

    // Place couples adjacently within each row, and record which adjacent
    // PAIRS are partners so we can use a tighter gap between them.
    const placedOrder = new Map();        // gen -> [personId, ...]
    const coupleAdjacency = new Map();    // gen -> Set<i>  (i = index of left of a couple pair)
    sortedGens.forEach((g) => {
      const row = rows.get(g);
      const placed = new Set();
      const order = [];
      const pairs = new Set();
      row.forEach((p) => {
        if (placed.has(p.id)) return;
        order.push(p.id);
        placed.add(p.id);
        const spouseInGen = p.spouses.find((sid) => {
          const s = byId.get(sid);
          return s && (gen.get(sid) === g) && !placed.has(sid);
        });
        if (spouseInGen) {
          pairs.add(order.length - 1);   // p is at index order.length - 1; spouse goes next
          order.push(spouseInGen);
          placed.add(spouseInGen);
        }
      });
      placedOrder.set(g, order);
      coupleAdjacency.set(g, pairs);
    });

    function gapBefore(g, indexOfRight) {
      // indexOfRight is the index of the right node of the gap. The couple
      // marker is stored on the index of the LEFT node of a couple pair —
      // i.e. the gap between i and i+1 is "couple" iff coupleAdjacency.has(i).
      return coupleAdjacency.get(g).has(indexOfRight - 1) ? X_GAP_COUPLE : X_GAP_SIBLING;
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

    return positions;
  }

  // ===== Edges =====
  function drawEdges(positions) {
    const drawnCouples = new Set();

    // Couple marker — placed in the small gap between the two photos at
    // photo height. With couples sitting almost touching, the closeness
    // itself reads as marriage; the gold knot is the confirming punctuation.
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
        // Centre between the two card boxes, at photo Y
        const cx = (left.x + NODE_W + right.x) / 2;
        const cy = Math.max(left.y, right.y) + PHOTO_CY;

        // Gold knot — two small interlocking circles
        const knot = svgEl_("g", { class: "t-couple-knot" });
        knot.appendChild(svgEl_("circle", {
          cx: cx - 3, cy, r: 4,
          fill: "var(--bg-elev)", stroke: "var(--gold)", "stroke-width": 1.75
        }));
        knot.appendChild(svgEl_("circle", {
          cx: cx + 3, cy, r: 4,
          fill: "var(--bg-elev)", stroke: "var(--gold)", "stroke-width": 1.75
        }));
        edgesG.appendChild(knot);
      });
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
      const placedParents = person.parents
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

      // Sort children left-to-right
      const ordered = cc.slice().sort((a, b) => a.x - b.x);
      const childTops = ordered.map((c) => ({
        x: c.x + NODE_W / 2,
        y: c.y
      }));
      const railY = (anchorY + childTops[0].y) / 2;

      // Trunk: from parent anchor down to the rail
      const trunk = `M ${anchorX} ${anchorY} L ${anchorX} ${railY}`;
      edgesG.appendChild(svgEl_("path", { class: "t-edge", d: trunk }));

      // Single shared horizontal rail connecting all children, including a
      // rounded T at the trunk junction
      const minX = Math.min(anchorX, ...childTops.map((c) => c.x));
      const maxX = Math.max(anchorX, ...childTops.map((c) => c.x));
      const rail = `M ${minX} ${railY} L ${maxX} ${railY}`;
      edgesG.appendChild(svgEl_("path", { class: "t-edge", d: rail }));

      // Risers — one per child, each with a small rounded corner where the
      // riser meets the rail
      childTops.forEach((c) => {
        const dx = Math.abs(c.x - anchorX);
        const r = Math.min(R, Math.max(2, dx / 2));
        const sign = c.x === anchorX ? 0 : (c.x > anchorX ? 1 : -1);
        if (sign === 0) {
          // straight from rail to child
          edgesG.appendChild(svgEl_("path", {
            class: "t-edge",
            d: `M ${c.x} ${railY} L ${c.x} ${c.y}`
          }));
        } else {
          // small quadratic-curve fillet from rail into the riser
          const enter = c.x - sign * r;
          edgesG.appendChild(svgEl_("path", {
            class: "t-edge",
            d: `M ${enter} ${railY} Q ${c.x} ${railY}, ${c.x} ${railY + r} L ${c.x} ${c.y}`
          }));
        }
      });
    });
  }

  // ===== Nodes =====
  function drawNodes(positions) {
    positions.forEach((pos, id) => {
      const p = pos.person;
      const g = svgEl_("g", {
        class: "t-node" + (window.Inspector && Inspector.getSelected && Inspector.getSelected() === p.id ? " is-selected" : ""),
        transform: `translate(${pos.x},${pos.y})`,
        "data-person-id": p.id,
        style: { cursor: "pointer" },
        onclick: (ev) => {
          ev.stopPropagation();
          if (window.Inspector) Inspector.show(p.id);
        },
        oncontextmenu: (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          showNodeMenu(p, pos, ev);
        }
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

      // Name (truncate) — placed below the larger portrait
      g.appendChild(svgEl_("text", {
        class: "t-node-name",
        "text-anchor": "middle",
        x: NODE_W / 2, y: PHOTO_CY + PHOTO_R + 22
      }, truncate(displayName, 18)));

      // Dates — softer subtitle
      g.appendChild(svgEl_("text", {
        class: "t-node-dates",
        "text-anchor": "middle",
        x: NODE_W / 2, y: PHOTO_CY + PHOTO_R + 40
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
      menuItem(I18n.t("inspector.actEdit"), "fa-solid fa-user-pen", null, () => {
        dismissMenu();
        if (window.PeopleView && PeopleView.openForm) PeopleView.openForm(person.id);
      }),
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
      }),
      UI.el("div", { style: { height: "1px", background: "var(--line)", margin: "4px 6px" } }),
      menuItem(I18n.t("inspector.actDelete"), "fa-regular fa-trash-can", "danger", async () => {
        dismissMenu();
        const ok = await UI.confirm({
          title: I18n.t("inspector.deleteTitle", { name: displayName }),
          message: I18n.t("inspector.deleteMsg"),
          confirmLabel: I18n.t("actions.remove"),
          danger: true
        });
        if (ok) {
          FamilyStore.deletePerson(person.id);
          if (window.Inspector) Inspector.clear();
          UI.toast(I18n.t("form.removed"), "success");
        }
      })
    ]);

    stageEl.appendChild(menu);
    openMenu = menu;
    setTimeout(() => {
      document.addEventListener("click", onDocClick, true);
      document.addEventListener("keydown", onDocKey, true);
    }, 0);
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

  function formatYears(p) {
    const by = FamilyStore.getYear(p.birthDate);
    const dy = FamilyStore.getYear(p.deathDate);
    if (by == null && dy == null) return "?";
    if (by == null) return "? – " + dy;
    if (dy == null) return FamilyStore.isDeceased(p) ? `${by} – ?` : `${by} – present`;
    return `${by} – ${dy}`;
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

  function setFilter(mode) {
    activeFilter = mode || "all";
    applyFilterClasses();
  }
  function applyFilterClasses() {
    if (!nodesG) return;
    const dim = activeFilter !== "all";
    nodesG.querySelectorAll(".t-node").forEach((g) => {
      const id = g.getAttribute("data-person-id");
      const p = id && FamilyStore.getPerson(id);
      let match = true;
      if (p && activeFilter === "alive") match = FamilyStore.isAlive(p);
      else if (p && activeFilter === "deceased") match = FamilyStore.isDeceased(p);
      g.classList.toggle("is-dim", dim && !match);
    });
  }

  global.TreeView = { mount, render, setFilter };
})(window);
