// @ts-check
/**
 * Timeline view — horizontal lifespan bars per family member.
 *
 * Exposes window.TimelineView = { mount(rootEl), render() }.
 * mount() builds the static scaffold (section header, controls, scroll/canvas)
 * once. render() recomputes range, axis, rows, and today line each time.
 */
(function (global) {
  "use strict";

  const { el, clear, avatar, openModal } = UI;

  const PX_KEY = "familyTree.timelinePxPerYear";
  const PX_DEFAULT = 14;
  const PX_MIN = 4;
  const PX_MAX = 80;
  const ROW_H = 44;
  const AXIS_H = 36;
  const MIN_BAR_PX = 24;
  const MOBILE_MQ = "(max-width: 720px)";

  let root = null;
  let canvas = null;
  let scroll = null;
  let chip = null;
  let titleAccentEl = null;
  let pxPerYear = clampPx(parsePx(localStorage.getItem(PX_KEY)) || PX_DEFAULT);

  // Track render signature so we can decide whether to keep scroll position.
  let lastSig = null;
  let mqList = null;
  let activeFilter = "all";

  function parsePx(v) { const n = parseFloat(v); return isFinite(n) ? n : null; }
  // Function declaration (not const arrow) so the let pxPerYear initializer
  // above can call it — declarations hoist, const arrows don't.
  function clampPx(n) { return UI.clamp(n, PX_MIN, PX_MAX); }
  function isMobile() { return !!(global.matchMedia && global.matchMedia(MOBILE_MQ).matches); }
  // First word of the family name — the gold-accented word in the view title.
  function familyAccent() {
    const fam = FamilyStore.getFamilyName ? FamilyStore.getFamilyName() : "";
    return (String(fam || "").trim().split(/\s+/)[0]) || I18n.t("timeline.titleFallback");
  }
  // Must match the CSS width of .timeline-name-col at both breakpoints, or the
  // left edge of every bar renders underneath the opaque sticky column (see
  // styles/views.css: 180px desktop, 120px under the 720px mobile media query).
  function nameColWidth() { return isMobile() ? 120 : 180; }

  function mount(rootEl) {
    root = rootEl;
    clear(root);

    // Use the same view-head pattern as Tree and People so the three views
    // share a consistent header rhythm (large display title + small sub).
    // The accent word is the real family name (e.g. "Sharma"), not a hardcoded
    // "Family" — otherwise multi-tree users see the wrong family named here.
    // Kept in a ref so render() can refresh it after a tree switch / rename.
    titleAccentEl = el("span", { class: "view-head__title-accent" }, familyAccent());
    // data-i18n on the static chrome so applyToDOM re-translates it on a
    // language switch — render() only rebuilds the canvas, so without these the
    // header/controls would keep their build-time language. The title word is a
    // span (not the h2's text) so applyToDOM can set it without clobbering the
    // dynamic family-name accent beside it; the " " keeps the two words apart.
    const head = el("div", { class: "view-head" }, [
      el("div", { class: "view-head__title-wrap" }, [
        el("span", { class: "view-head__eyebrow", "data-i18n": "timeline.eyebrow" }, I18n.t("timeline.eyebrow")),
        el("h2", { class: "view-head__title" }, [
          titleAccentEl,
          document.createTextNode(" "),
          el("span", { "data-i18n": "timeline.titleWord" }, I18n.t("timeline.titleWord"))
        ]),
        el("span", { class: "view-head__sub", "data-i18n": "timeline.subtitle" }, I18n.t("timeline.subtitle"))
      ])
    ]);

    const zoomOut = el("button", {
      class: "btn btn--sm",
      type: "button",
      "data-i18n-aria-label": "actions.zoomOut",
      "aria-label": I18n.t("actions.zoomOut"),
      onclick: () => zoomBy(0.7)
    }, [el("i", { class: "fa-solid fa-magnifying-glass-minus", "aria-hidden": "true" }), el("span", { "data-i18n": "actions.zoomOut" }, I18n.t("actions.zoomOut"))]);

    const zoomIn = el("button", {
      class: "btn btn--sm",
      type: "button",
      "data-i18n-aria-label": "actions.zoomIn",
      "aria-label": I18n.t("actions.zoomIn"),
      onclick: () => zoomBy(1.4)
    }, [el("i", { class: "fa-solid fa-magnifying-glass-plus", "aria-hidden": "true" }), el("span", { "data-i18n": "actions.zoomIn" }, I18n.t("actions.zoomIn"))]);

    const todayBtn = el("button", {
      class: "btn btn--sm",
      type: "button",
      "data-i18n-aria-label": "actions.today",
      "aria-label": I18n.t("actions.today"),
      onclick: scrollToToday
    }, [el("i", { class: "fa-solid fa-location-crosshairs", "aria-hidden": "true" }), el("span", { "data-i18n": "actions.today" }, I18n.t("actions.today"))]);

    chip = el("span", { class: "chip chip--muted", "data-i18n-title": "timeline.pxPerYearTitle", title: I18n.t("timeline.pxPerYearTitle") }, pxLabel());

    // Legend: the bars encode living vs deceased by colour alone, which is
    // invisible to anyone who can't distinguish olive from rust. Spell it out.
    const legend = el("div", { class: "timeline-legend", "aria-hidden": "false" }, [
      el("span", { class: "timeline-legend__item" }, [
        el("span", { class: "timeline-legend__swatch timeline-legend__swatch--living" }),
        el("span", { "data-i18n": "people.living" }, I18n.t("people.living"))
      ]),
      el("span", { class: "timeline-legend__item" }, [
        el("span", { class: "timeline-legend__swatch timeline-legend__swatch--deceased" }),
        el("span", { "data-i18n": "people.deceased" }, I18n.t("people.deceased"))
      ])
    ]);

    const controls = el("div", { class: "timeline-controls" }, [
      zoomOut, zoomIn, todayBtn, chip, legend
    ]);

    canvas = el("div", { class: "timeline-canvas" });
    scroll = el("div", { class: "timeline-scroll" }, [canvas]);

    // Pinch-to-zoom on touch. touchmove must be non-passive so we can
    // preventDefault the browser's native page zoom during a two-finger pinch.
    scroll.addEventListener("touchstart", onPinchStart, { passive: true });
    scroll.addEventListener("touchmove", onPinchMove, { passive: false });
    scroll.addEventListener("touchend", onPinchEnd);
    scroll.addEventListener("touchcancel", onPinchEnd);

    const wrap = el("div", { class: "timeline-wrap" }, [controls, scroll]);

    root.appendChild(head);
    root.appendChild(wrap);

    // Re-render on viewport breakpoint changes so nameColWidth math stays in sync with CSS.
    if (global.matchMedia) {
      mqList = global.matchMedia(MOBILE_MQ);
      const onMQ = () => render();
      if (mqList.addEventListener) mqList.addEventListener("change", onMQ);
      else if (mqList.addListener) mqList.addListener(onMQ);
    }

    render();
  }

  function pxLabel() {
    const n = Math.round(pxPerYear * 10) / 10;
    return I18n.t("timeline.pxPerYearShort", { n });
  }

  function zoomBy(factor) {
    const next = clampPx(pxPerYear * factor);
    if (next === pxPerYear) return;
    pxPerYear = next;
    try { localStorage.setItem(PX_KEY, String(pxPerYear)); } catch (_) { /* ignore quota */ }
    if (chip) chip.textContent = pxLabel();
    render();
  }

  // ----- Pinch-to-zoom (touch) -----
  // Two fingers scale pxPerYear the same way the +/- buttons do (clampPx +
  // persist), but anchored on the gesture midpoint so the year under your
  // fingers stays put, re-rendered at most once per frame, and with the
  // localStorage write deferred to release so a live pinch stays smooth.
  // Single-finger scrolling is untouched — the handler bails unless two
  // fingers are down.
  let pinchStartDist = 0;
  let pinchStartPx = 0;
  let pinchPendingPx = 0;
  let pinchAnchorClientX = 0;
  let pinchRaf = 0;

  function touchDistance(a, b) {
    const dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Apply the latest pending zoom: capture the (fractional) year under the
  // pinch midpoint using the OLD scale, re-render at the new scale, then push
  // that year back under the midpoint. render() re-centres on "today" when the
  // signature changes, so this scroll fix must run AFTER it (render is sync).
  function applyPinchFrame() {
    pinchRaf = 0;
    if (!scroll || !canvas) return;
    const rect = scroll.getBoundingClientRect();
    const offsetX = pinchAnchorClientX - rect.left;
    const ncw = nameColWidth();
    const yearFrac = pxPerYear ? (scroll.scrollLeft + offsetX - ncw) / pxPerYear : 0;
    pxPerYear = pinchPendingPx;
    if (chip) chip.textContent = pxLabel();
    render();
    scroll.scrollLeft = Math.max(0, ncw + yearFrac * pxPerYear - offsetX);
  }

  function onPinchStart(e) {
    if (!e.touches || e.touches.length !== 2) return;
    pinchStartDist = touchDistance(e.touches[0], e.touches[1]);
    pinchStartPx = pxPerYear;
    pinchAnchorClientX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
  }

  function onPinchMove(e) {
    if (!pinchStartDist || !e.touches || e.touches.length !== 2) return;
    // Suppress the browser's native page zoom while pinching the timeline.
    e.preventDefault();
    const dist = touchDistance(e.touches[0], e.touches[1]);
    if (!dist) return;
    pinchPendingPx = clampPx(pinchStartPx * (dist / pinchStartDist));
    pinchAnchorClientX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    if (pinchRaf) return;
    if (global.requestAnimationFrame) pinchRaf = global.requestAnimationFrame(applyPinchFrame);
    else applyPinchFrame();
  }

  function onPinchEnd(e) {
    if (!pinchStartDist) return;
    // Keep pinching until we drop below two fingers.
    if (e.touches && e.touches.length >= 2) return;
    pinchStartDist = 0;
    if (pinchRaf) {
      if (global.cancelAnimationFrame) global.cancelAnimationFrame(pinchRaf);
      pinchRaf = 0;
      applyPinchFrame(); // flush the last pending zoom before we settle
    }
    try { localStorage.setItem(PX_KEY, String(pxPerYear)); } catch (_) { /* ignore quota */ }
  }

  function scrollToToday() {
    if (!scroll || !canvas) return;
    const range = computeRange(FamilyStore.getPeople());
    if (!range) return;
    const ncw = nameColWidth();
    const todayX = ncw + (new Date().getFullYear() - range.minYear) * pxPerYear;
    const viewport = scroll.getBoundingClientRect ? scroll.getBoundingClientRect().width : 0;
    const target = Math.max(0, todayX - viewport * 0.5);
    if (typeof scroll.scrollTo === "function") {
      try { scroll.scrollTo({ left: target, behavior: "smooth" }); }
      catch (_) { scroll.scrollLeft = target; }
    } else {
      scroll.scrollLeft = target;
    }
  }

  function computeRange(people) {
    // Use whichever year we have — birth, or death as a fallback so people
    // whose only recorded year is the year of death still appear.
    const years = [];
    people.forEach((p) => {
      const by = FamilyStore.getYear(p.birthDate);
      const dy = FamilyStore.getYear(p.deathDate);
      if (by != null) years.push(by);
      else if (dy != null) years.push(dy);
    });
    if (years.length === 0) return null;
    const rawMin = Math.min.apply(null, years);
    const minYear = Math.floor(rawMin / 10) * 10;
    const currentYear = new Date().getFullYear();
    const maxYear = Math.ceil((currentYear + 5) / 10) * 10;
    return { minYear, maxYear, currentYear };
  }

  function buildRows(people) {
    const currentYear = new Date().getFullYear();
    const rows = [];
    people.forEach((p) => {
      const birthYear = FamilyStore.getYear(p.birthDate);
      const deathYear = FamilyStore.getYear(p.deathDate);
      // Skip only when we know nothing.
      if (birthYear == null && deathYear == null) return;
      // If we only have a death year, render a short bar at that year.
      const startYear = birthYear != null ? birthYear : deathYear;
      const endYear = birthYear != null
        ? (deathYear != null ? deathYear : currentYear)
        : deathYear;
      rows.push({ person: p, startYear, endYear, birthKnown: birthYear != null });
    });
    rows.sort((a, b) => {
      if (a.startYear !== b.startYear) return a.startYear - b.startYear;
      const an = FamilyStore.getField(a.person, "name") || a.person.name;
      const bn = FamilyStore.getField(b.person, "name") || b.person.name;
      return an.localeCompare(bn);
    });
    return rows;
  }

  function render() {
    if (!root || !canvas) return;
    if (titleAccentEl) titleAccentEl.textContent = familyAccent();
    const people = FamilyStore.getPeople();

    if (!people.length) {
      renderEmpty();
      lastSig = null;
      return;
    }

    const range = computeRange(people);
    if (!range) {
      renderEmpty();
      lastSig = null;
      return;
    }

    const rows = buildRows(people);
    const ncw = nameColWidth();
    const sig = range.minYear + "/" + range.maxYear + "/" + pxPerYear + "/" + ncw + "/" + rows.length;
    const prevScroll = scroll ? scroll.scrollLeft : 0;
    const sameSig = sig === lastSig;

    clear(canvas);

    const totalYears = range.maxYear - range.minYear;
    const canvasWidth = ncw + totalYears * pxPerYear;
    const canvasHeight = rows.length * ROW_H + AXIS_H;
    canvas.style.width = canvasWidth + "px";
    canvas.style.height = canvasHeight + "px";

    canvas.appendChild(buildAxis(range, ncw));
    rows.forEach((r) => canvas.appendChild(buildRow(r, range, ncw)));
    canvas.appendChild(buildNowLine(range, ncw, rows.length));

    if (chip) chip.textContent = pxLabel();

    if (scroll) {
      if (sameSig) {
        scroll.scrollLeft = prevScroll;
      } else {
        const todayX = ncw + (range.currentYear - range.minYear) * pxPerYear;
        const viewport = scroll.getBoundingClientRect ? scroll.getBoundingClientRect().width : 0;
        scroll.scrollLeft = Math.max(0, todayX - viewport * 0.5);
      }
    }
    lastSig = sig;
    applyFilterClasses();
  }

  function renderEmpty() {
    if (!canvas) return;
    clear(canvas);
    canvas.style.width = "";
    canvas.style.height = "";
    // This screen covers two cases: no people at all, and people-but-no-dates.
    // Only the truly-empty tree gets an "add first person" CTA (matching People
    // and Tree). When people already exist but lack dates, the right nudge is
    // "add birth dates", so we keep that copy and offer no add-person button.
    const noPeople = !FamilyStore.getPeople().length;
    const opts = {
      icon: "fa-solid fa-hourglass-half",
      title: I18n.t("timeline.emptyTitle"),
      text: I18n.t("timeline.emptyText")
    };
    if (noPeople) {
      opts.cta = {
        label: I18n.t("actions.addFirst"),
        icon: "fa-solid fa-user-plus",
        onClick: () => { if (window.PeopleView && PeopleView.openForm) PeopleView.openForm(null); }
      };
    }
    canvas.appendChild(UI.emptyState(opts));
  }

  function buildAxis(range, ncw) {
    const axis = el("div", { class: "timeline-axis" });
    const showMinor = pxPerYear >= 30;
    const showMajor = pxPerYear >= 8;
    for (let y = range.minYear; y <= range.maxYear; y++) {
      const isMajor = y % 5 === 0;
      const isLabeled = y % 10 === 0;
      const x = ncw + (y - range.minYear) * pxPerYear;
      if (isLabeled) {
        const tick = el("div", {
          class: "timeline-tick timeline-tick--major",
          style: { left: x + "px" }
        });
        axis.appendChild(tick);
        axis.appendChild(el("div", {
          class: "timeline-tick__label",
          style: { left: (x + 4) + "px" }
        }, String(y)));
      } else if (isMajor && showMajor) {
        axis.appendChild(el("div", {
          class: "timeline-tick timeline-tick--major",
          style: { left: x + "px" }
        }));
      } else if (showMinor) {
        axis.appendChild(el("div", {
          class: "timeline-tick",
          style: { left: x + "px" }
        }));
      }
    }
    return axis;
  }

  function buildRow(rowData, range, ncw) {
    const { person, startYear, endYear, birthKnown } = rowData;
    const displayName = FamilyStore.getField(person, "name") || person.name;
    const left = ncw + (startYear - range.minYear) * pxPerYear;
    // Death-only people have startYear === endYear. Render them as a slim
    // marker centred on the year instead of a full-width MIN_BAR_PX bar
    // (which read as "lived from 1950 to ~1952").
    const pointMarker = !birthKnown && startYear === endYear;
    const width = pointMarker
      ? 6
      : Math.max(MIN_BAR_PX, (endYear - startYear) * pxPerYear);
    const deceased = FamilyStore.isDeceased(person);
    const ageNow = FamilyStore.calcAge(person);
    const labelEnd = deceased ? String(endYear) : I18n.t("timeline.present");
    const labelText = displayName.split(" ")[0] +
      " · " + startYear + "–" + labelEnd +
      (ageNow != null ? " (" + ageNow + ")" : "");

    const openPerson = () => {
      // Reveal on the canvas AND open the profile (same seam as the Inspector
      // "Open in tree" action; app.js activates the tree + pans to the node).
      // Fall back to a bare open when the reveal seam isn't available.
      try {
        window.dispatchEvent(new CustomEvent("virasat:reveal-in-tree", { detail: { id: person.id } }));
        return;
      } catch (_) {}
      if (window.Inspector && Inspector.show) Inspector.show(person.id);
      else if (window.ProfileView && ProfileView.open) ProfileView.open(person.id);
      else openPersonModal(person);
    };

    // Date precision → softly fade the relevant edge of the bar so the
    // user sees that "we're not certain when this person was born / died".
    const bp = person.birthDatePrecision;
    const dp = person.deathDatePrecision;
    const fadeLeft  = bp && bp !== "exact";
    const fadeRight = deceased && dp && dp !== "exact";
    // A living person's bar has no definite end — square off (and feather) its
    // right edge so the pill cap doesn't imply a fixed end date. Point markers
    // (death-only) are already a slim shape and stay as-is.
    const ongoing = !deceased && !pointMarker;
    const cls = "timeline-bar"
      + (deceased ? " timeline-bar--deceased" : "")
      + (ongoing ? " timeline-bar--ongoing" : "")
      + (fadeLeft  ? " timeline-bar--fade-left"  : "")
      + (fadeRight ? " timeline-bar--fade-right" : "")
      + (pointMarker ? " timeline-bar--point" : "");
    const bar = el("div", {
      class: cls,
      style: { left: left + "px", width: width + "px" },
      role: "button",
      tabindex: "0",
      "aria-label": displayName + " " + FamilyStore.formatDateRange(person),
      title: displayName + " — " + FamilyStore.formatDateRange(person),
      onclick: (e) => { e.stopPropagation(); openPerson(); },
      onkeydown: (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPerson(); }
      }
    }, [
      buildBarAvatar(person),
      el("span", { class: "timeline-bar__label" }, labelText)
    ]);

    // The sticky name column stays visible when the bar scrolls off-screen, so
    // it must be independently clickable — otherwise the only visible handle to
    // an off-screen person is inert.
    const nameCol = el("div", {
      class: "timeline-name-col",
      role: "button",
      tabindex: "0",
      "aria-label": displayName + " " + FamilyStore.formatDateRange(person),
      onclick: (e) => { e.stopPropagation(); openPerson(); },
      onkeydown: (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPerson(); }
      }
    }, [
      avatar(person, "xs"),
      el("span", null, displayName)
    ]);

    return el("div", { class: "timeline-row", "data-person-id": person.id }, [nameCol, bar]);
  }

  function buildBarAvatar(person) {
    const node = el("span", { class: "timeline-bar__avatar", "aria-hidden": "true" });
    const url = window.PhotoStore ? PhotoStore.getUrlSync(person) : (person.photo || null);
    // Mirror UI.avatar's crop application — even tiny bar avatars should
    // honour the user-chosen focal point, otherwise a couples-photo crop
    // shows the wrong face.
    const cropAv = person && person.photoCropAvatar;
    function applyCrop(img) {
      if (!cropAv) return;
      img.style.objectPosition = (cropAv.x ?? 50) + "% " + (cropAv.y ?? 50) + "%";
      const s = Math.max(1, cropAv.scale || 1);
      if (s > 1.001) img.style.transform = "scale(" + s + ")";
    }
    // Fallback when there's no resolvable photo: initials on a soft disc. Also
    // used when an async getUrl() comes back empty (e.g. a photoId whose blob
    // isn't in this device's IDB) — otherwise the <img> stays src="" and the
    // browser paints a broken-image icon. Mirrors UI.avatar's recovery.
    function showInitials() {
      const displayName = FamilyStore.getField(person, "name") || person.name;
      node.style.background = "rgba(255,255,255,0.22)";
      node.style.display = "inline-flex";
      node.style.alignItems = "center";
      node.style.justifyContent = "center";
      node.style.fontSize = "10px";
      node.style.fontWeight = "600";
      node.appendChild(document.createTextNode(FamilyStore.initials(displayName)));
    }
    if (url) {
      const img = el("img", { src: url, alt: "" });
      applyCrop(img);
      node.appendChild(img);
    } else if (window.PhotoStore && (person.photoId)) {
      const img = el("img", { src: "", alt: "" });
      applyCrop(img);
      node.appendChild(img);
      PhotoStore.getUrl(person)
        .then((u) => { if (u) { img.src = u; } else { node.removeChild(img); showInitials(); } })
        .catch(() => { if (node.contains(img)) node.removeChild(img); showInitials(); });
    } else {
      showInitials();
    }
    return node;
  }

  function buildNowLine(range, ncw, rowCount) {
    const x = ncw + (range.currentYear - range.minYear) * pxPerYear;
    const totalH = rowCount * ROW_H + AXIS_H;
    return el("div", {
      class: "timeline-now-line",
      style: { left: x + "px", height: totalH + "px" }
    }, [
      el("span", { class: "timeline-now-line__label" }, I18n.t("timeline.today"))
    ]);
  }

  function openPersonModal(person) {
    const ageNow = FamilyStore.calcAge(person);
    const dateRange = FamilyStore.formatDateRange(person);
    const meta = [];
    function placeRow(label, place) {
      return el("div", { style: { display: "inline-flex", alignItems: "center", gap: "6px" } }, [
        el("i", { class: "fa-solid fa-location-dot", "aria-hidden": "true", style: { color: "var(--gold)" } }),
        el("span", null, label + ": " + place)
      ]);
    }
    if (person.birthPlace) meta.push(placeRow("Born", person.birthPlace));
    if (person.deathPlace) meta.push(placeRow("Died", person.deathPlace));

    const body = el("div", { class: "form-stack" }, [
      el("div", { style: { display: "flex", gap: "var(--s-3)", alignItems: "center" } }, [
        avatar(person, "lg"),
        el("div", null, [
          el("div", { class: "person-card__name" }, person.name),
          el("div", { class: "person-card__dates" },
            dateRange + (ageNow != null
              ? (FamilyStore.isAlive(person) ? " · Age " + ageNow : " · Lived " + ageNow + " years")
              : ""))
        ])
      ]),
      meta.length ? el("div", { class: "person-card__meta", style: { flexDirection: "column", gap: "4px" } }, meta) : null,
      person.notes ? el("p", { style: { color: "var(--ink-2)", margin: 0, whiteSpace: "pre-wrap" } }, person.notes) : null
    ]);

    openModal({ title: person.name, body });
  }

  if (window.I18n && I18n.onChange) I18n.onChange(() => { if (root) render(); });

  function setFilter(mode) {
    activeFilter = mode || "all";
    applyFilterClasses();
  }
  function applyFilterClasses() {
    if (!canvas) return;
    const dim = activeFilter !== "all";
    canvas.querySelectorAll(".timeline-row").forEach((row) => {
      const id = row.getAttribute("data-person-id");
      const p = id && FamilyStore.getPerson(id);
      let match = true;
      if (p && activeFilter === "alive") match = FamilyStore.isAlive(p);
      else if (p && activeFilter === "deceased") match = FamilyStore.isDeceased(p);
      row.classList.toggle("is-dim", dim && !match);
    });
  }

  global.TimelineView = { mount, render, setFilter };
})(window);
