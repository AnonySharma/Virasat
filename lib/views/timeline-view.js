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
  let pxPerYear = clampPx(parsePx(localStorage.getItem(PX_KEY)) || PX_DEFAULT);

  // Track render signature so we can decide whether to keep scroll position.
  let lastSig = null;
  let mqList = null;
  let activeFilter = "all";

  function parsePx(v) { const n = parseFloat(v); return isFinite(n) ? n : null; }
  function clampPx(n) { return Math.max(PX_MIN, Math.min(PX_MAX, n)); }
  function isMobile() { return !!(global.matchMedia && global.matchMedia(MOBILE_MQ).matches); }
  function nameColWidth() { return isMobile() ? 120 : 160; }

  function mount(rootEl) {
    root = rootEl;
    clear(root);

    const head = el("div", { class: "section-head" }, [
      el("div", null, [
        el("h2", { class: "section-head__title" }, I18n.t("timeline.title")),
        el("div", { class: "section-head__sub" }, I18n.t("timeline.subtitle"))
      ])
    ]);

    const zoomOut = el("button", {
      class: "btn btn--sm",
      type: "button",
      "aria-label": I18n.t("actions.zoomOut"),
      onclick: () => zoomBy(0.7)
    }, [el("span", { "aria-hidden": "true" }, "−"), I18n.t("actions.zoomOut")]);

    const zoomIn = el("button", {
      class: "btn btn--sm",
      type: "button",
      "aria-label": I18n.t("actions.zoomIn"),
      onclick: () => zoomBy(1.4)
    }, [el("span", { "aria-hidden": "true" }, "＋"), I18n.t("actions.zoomIn")]);

    const todayBtn = el("button", {
      class: "btn btn--sm",
      type: "button",
      "aria-label": I18n.t("actions.today"),
      onclick: scrollToToday
    }, [el("span", { "aria-hidden": "true" }, "📍"), I18n.t("actions.today")]);

    chip = el("span", { class: "chip chip--muted", title: "Pixels per year" }, pxLabel());

    const controls = el("div", { class: "timeline-controls" }, [
      zoomOut, zoomIn, todayBtn, chip
    ]);

    canvas = el("div", { class: "timeline-canvas" });
    scroll = el("div", { class: "timeline-scroll" }, [canvas]);

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

  function pxLabel() { return Math.round(pxPerYear * 10) / 10 + " px/year"; }

  function zoomBy(factor) {
    const next = clampPx(pxPerYear * factor);
    if (next === pxPerYear) return;
    pxPerYear = next;
    try { localStorage.setItem(PX_KEY, String(pxPerYear)); } catch (_) { /* ignore quota */ }
    if (chip) chip.textContent = pxLabel();
    render();
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
    canvas.appendChild(el("div", { class: "empty" }, [
      el("div", { class: "empty__icon", "aria-hidden": "true" }, "⏳"),
      el("div", { class: "empty__title" }, I18n.t("timeline.emptyTitle")),
      el("div", { class: "empty__text" }, I18n.t("timeline.emptyText"))
    ]));
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
    const { person, startYear, endYear } = rowData;
    const displayName = FamilyStore.getField(person, "name") || person.name;
    const left = ncw + (startYear - range.minYear) * pxPerYear;
    const width = Math.max(MIN_BAR_PX, (endYear - startYear) * pxPerYear);
    const deceased = FamilyStore.isDeceased(person);
    const ageNow = FamilyStore.calcAge(person);
    const labelEnd = deceased ? String(endYear) : "present";
    const labelText = displayName.split(" ")[0] +
      " · " + startYear + "–" + labelEnd +
      (ageNow != null ? " (" + ageNow + ")" : "");

    const openPerson = () => {
      if (window.Inspector && Inspector.show) Inspector.show(person.id);
      else if (window.ProfileView && ProfileView.open) ProfileView.open(person.id);
      else openPersonModal(person);
    };

    const bar = el("div", {
      class: "timeline-bar" + (deceased ? " timeline-bar--deceased" : ""),
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

    const nameCol = el("div", { class: "timeline-name-col" }, [
      avatar(person, "xs"),
      el("span", null, displayName)
    ]);

    return el("div", { class: "timeline-row", "data-person-id": person.id }, [nameCol, bar]);
  }

  function buildBarAvatar(person) {
    const node = el("span", { class: "timeline-bar__avatar", "aria-hidden": "true" });
    const url = window.PhotoStore ? PhotoStore.getUrlSync(person) : (person.photo || null);
    if (url) {
      node.appendChild(el("img", { src: url, alt: "" }));
    } else if (window.PhotoStore && (person.photoId)) {
      const img = el("img", { src: "", alt: "" });
      node.appendChild(img);
      PhotoStore.getUrl(person).then((u) => { if (u) img.src = u; });
    } else {
      const displayName = FamilyStore.getField(person, "name") || person.name;
      node.style.background = "rgba(255,255,255,0.22)";
      node.style.display = "inline-flex";
      node.style.alignItems = "center";
      node.style.justifyContent = "center";
      node.style.fontSize = "10px";
      node.style.fontWeight = "600";
      node.appendChild(document.createTextNode(FamilyStore.initials(displayName)));
    }
    return node;
  }

  function buildNowLine(range, ncw, rowCount) {
    const x = ncw + (range.currentYear - range.minYear) * pxPerYear;
    const totalH = rowCount * ROW_H + AXIS_H;
    return el("div", {
      class: "timeline-now-line",
      style: { left: x + "px", height: totalH + "px" },
      "aria-hidden": "true"
    });
  }

  function openPersonModal(person) {
    const ageNow = FamilyStore.calcAge(person);
    const dateRange = FamilyStore.formatDateRange(person);
    const meta = [];
    if (person.birthPlace) meta.push(el("div", null, ["📍 Born: ", person.birthPlace]));
    if (person.deathPlace) meta.push(el("div", null, ["📍 Died: ", person.deathPlace]));

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
