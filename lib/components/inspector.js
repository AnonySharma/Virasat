// @ts-check
/**
 * Inspector — right-pane panel that shows details for the currently selected person.
 *
 * window.Inspector = {
 *   mount()         — wire the panel to the DOM + store (call once at boot)
 *   show(personId)  — load a person into the panel
 *   clear()         — show the empty state
 *   getSelected()   — current person id
 *   onSelect(fn)    — subscribe to selection changes
 * }
 *
 * The panel body is a stack of collapsible sections (About, Personal,
 * Achievements, Education, Stories, Family …) whose open/closed state persists
 * per-device — not a tabbed layout.
 */
(function (global) {
  "use strict";

  let mounted = false;
  let emptyEl = null;
  let contentEl = null;
  let panelEl = null;
  let selectedId = null;
  const listeners = new Set();

  // Family-highlights calendar starts folded so the empty-state sidebar opens as
  // a compact list (Coming-up leads); tapping its header expands it in place.
  // Module-level so the choice survives inspector re-renders within a session.
  let calendarOpen = false;

  function mount() {
    if (mounted) return;
    panelEl = document.getElementById("inspector");
    emptyEl = document.getElementById("inspector-empty");
    contentEl = document.getElementById("inspector-content");
    if (!panelEl || !emptyEl || !contentEl) return;
    mounted = true;

    // Re-render when the underlying person changes — and also when no one
    // is selected, so the empty-state Family Highlights stay current.
    if (window.FamilyStore && FamilyStore.subscribe) {
      FamilyStore.subscribe(() => render());
    }
    if (window.I18n && I18n.onChange) I18n.onChange(() => render());
    // Repaint when the viewer pins/clears "self" so the kin-term chip
    // (this person's relation to you) appears/updates without a reselect.
    if (window.SelfAnchor && SelfAnchor.onChange) SelfAnchor.onChange(() => render());
    // First paint of highlights at mount.
    render();
  }

  function show(personId, opts) {
    if (!mounted) mount();
    selectedId = personId || null;
    if (panelEl) panelEl.classList.toggle("is-open", !!personId);
    render();
    listeners.forEach((fn) => { try { fn(selectedId); } catch (_) {} });
    // Optional: when called from story-search, jump straight to the matched
    // story. Force the Stories section open (overriding any persisted
    // collapsed state for this navigation), scroll the matching card into
    // view, and flash a subtle highlight so the user notices it.
    if (opts && opts.scrollToStoryId && contentEl) {
      requestAnimationFrame(() => {
        const stories = contentEl.querySelector('.inspector-section[data-section-id="stories"]');
        if (stories) stories.classList.add("is-open");
        // Escape the id before embedding it in an attribute selector. Story
        // ids are app-generated today, but they're user-mintable via JSON
        // import, so an id containing quotes/brackets would break the selector
        // (or match the wrong node). CSS.escape with a manual fallback for old
        // browsers — same idiom image-export.js uses for person ids.
        const escId = (typeof CSS !== "undefined" && CSS.escape)
          ? CSS.escape(opts.scrollToStoryId)
          : String(opts.scrollToStoryId).replace(/([\\"\[\]\s])/g, "\\$1");
        const card = contentEl.querySelector('[data-story-id="' + escId + '"]');
        if (card && card.scrollIntoView) {
          card.scrollIntoView({ behavior: "smooth", block: "center" });
          card.classList.add("is-flash");
          setTimeout(() => card.classList.remove("is-flash"), 1600);
        }
      });
    }
  }

  function clear() { show(null); }
  function getSelected() { return selectedId; }
  function onSelect(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  // Open a person AND reveal them on the canvas — the same contract the
  // "Open in tree" action row uses (app.js listens for this, activates the
  // tree, and pans/zooms to the node). Used by the relationship chips and the
  // Family-Highlights cards so every person-tap carries the "where do they sit"
  // context, not just a bare profile open.
  function revealInTree(personId) {
    if (!personId) return;
    try { window.dispatchEvent(new CustomEvent("virasat:reveal-in-tree", { detail: { id: personId } })); }
    catch (_) { show(personId); }
  }

  // Family highlights shown in the empty inspector. Recomputes on every
  // render, which is cheap because the calls are O(N) over a small N.
  function renderHighlights() {
    if (!contentEl) return;
    const ppl = FamilyStore.getPeople();
    while (contentEl.firstChild) contentEl.removeChild(contentEl.firstChild);
    const wrap = UI.el("div", { class: "highlights" });

    if (ppl.length === 0) {
      wrap.appendChild(UI.el("div", { class: "highlights__intro" }, [
        UI.el("h3", { class: "highlights__title" }, I18n.t("highlights.welcome")),
        UI.el("p", { class: "highlights__hint" },
          I18n.t("highlights.welcomeHint"))
      ]));
      contentEl.appendChild(wrap);
      return;
    }

    // Just the eyebrow — the sidebar opens as a compact list, so the "pick
    // anyone…" hint (redundant with the tree/list/timeline already on screen)
    // is dropped to reduce clutter.
    wrap.appendChild(UI.el("div", { class: "highlights__intro" }, [
      UI.el("div", { class: "highlights__eyebrow" }, I18n.t("highlights.eyebrow"))
    ]));

    // Coming up leads — the year ahead as clickable rows, next event first.
    // Its opener reveals the full list (with add-to-calendar / reminder controls)
    // in a modal. The whole-family month grid follows, folded by default behind
    // a tappable header so the sidebar stays a compact list on open. Both are
    // built by the Anniversaries feature module (shared with the Insights
    // surfaces), so nothing here duplicates markup. Guard for a minimal build.
    const anniv = window.Anniversaries;
    if (anniv && anniv.renderCalendar) {
      const evs = anniv.events();
      if (evs.length) {
        wrap.appendChild(UI.el("div", { class: "highlights__section" }, [
          UI.el("div", { class: "highlights__section-head" }, [
            UI.el("i", { class: "fa-regular fa-clock", "aria-hidden": "true" }),
            UI.el("span", null, I18n.t("insights.comingUpTitle"))
          ]),
          anniv.renderComingUpList(evs, 4, I18n.t("insights.comingUpTitle"))
        ]));
      }

      // Folded calendar — the header toggles calendarOpen and re-renders; the
      // grid's own prev/next nav also re-renders to repaint in place.
      const calHead = UI.el("button", {
        class: "highlights__fold" + (calendarOpen ? " is-open" : ""),
        type: "button", "aria-expanded": calendarOpen ? "true" : "false",
        onclick: () => { calendarOpen = !calendarOpen; render(); }
      }, [
        UI.el("i", { class: "fa-regular fa-calendar-days highlights__fold-icon", "aria-hidden": "true" }),
        UI.el("span", { class: "highlights__fold-label" }, I18n.t("insights.calendarTitle")),
        UI.el("i", { class: "fa-solid fa-chevron-down highlights__fold-caret", "aria-hidden": "true" })
      ]);
      const calSection = UI.el("div", { class: "highlights__section" }, [calHead]);
      if (calendarOpen) calSection.appendChild(anniv.renderCalendar(() => render()));
      wrap.appendChild(calSection);
    }

    // Family-archive completion — % of fields filled across the tree.
    if (FamilyStore.maintenanceStats) {
      const s = FamilyStore.maintenanceStats();
      if (s.total > 0) {
        const filledBirths = s.total - s.missingBirth;
        const filledPhotos = s.total - s.missingPhoto;
        const filledDesc = s.total - s.missingDescription;
        const total = s.total * 3;
        const filled = filledBirths + filledPhotos + filledDesc;
        const pct = Math.round((filled / total) * 100);
        if (pct >= 100) {
          // Nothing left to fill — collapse the whole bar+legend to a single
          // quiet "complete" line so it doesn't shout for attention.
          wrap.appendChild(UI.el("div", { class: "completion completion--done" }, [
            UI.el("i", { class: "fa-solid fa-circle-check", "aria-hidden": "true" }),
            UI.el("span", null, I18n.t("highlights.archiveComplete", { filled: s.total, total: s.total }))
          ]));
        } else {
          const bar = UI.el("div", { class: "completion__bar" }, [
            UI.el("div", { class: "completion__fill", style: { width: pct + "%" } })
          ]);
          const completion = UI.el("div", { class: "completion" }, [
            UI.el("div", { class: "completion__head" }, [
              UI.el("div", { class: "completion__title" }, I18n.t("highlights.archive")),
              UI.el("div", { class: "completion__pct" }, pct + "%")
            ]),
            bar,
            UI.el("div", { class: "completion__legend" }, [
              UI.el("span", null, I18n.t("highlights.legendPhotos", { filled: filledPhotos, total: s.total })),
              UI.el("span", null, I18n.t("highlights.legendBirths", { filled: filledBirths, total: s.total })),
              UI.el("span", null, I18n.t("highlights.legendDesc", { filled: filledDesc, total: s.total }))
            ])
          ]);
          wrap.appendChild(completion);
        }
      }
    }

    contentEl.appendChild(wrap);
  }

  function render() {
    if (!mounted) return;
    if (!selectedId) {
      // Empty state — when nobody's selected, show "Family highlights"
      // (oldest ancestor, latest addition, most stories, next anniversary)
      // instead of a blank "select a person" panel. Keeps the screen
      // useful and surfaces the soul of the tree.
      if (speaking) stopReading();
      renderHighlights();
      emptyEl.hidden = true;
      contentEl.hidden = false;
      return;
    }
    const p = FamilyStore.getPerson(selectedId);
    if (!p) { clear(); return; }

    // Skip the rebuild if a child input is focused — protects the notes
    // textarea from losing focus when its own debounced save fires.
    const active = document.activeElement;
    if (active && contentEl.contains(active) && (active.tagName === "TEXTAREA" || active.tagName === "INPUT")) {
      return;
    }

    const F = (k) => FamilyStore.getField(p, k) || p[k];
    const displayName = F("name") || p.name;
    const displayOcc = F("occupation") || "";
    const displayDesc = F("description") || "";
    const displayNotes = F("notes") || "";
    const displayBirthPlace = F("birthPlace") || "";
    const displayDeathPlace = F("deathPlace") || "";
    const displayAchievements = F("achievements") || [];
    const displayEducation = F("education") || [];

    const parents = (p.parents || []).map(FamilyStore.getPerson).filter(Boolean);
    const spouses = (p.spouses || []).map(FamilyStore.getPerson).filter(Boolean);
    const children = FamilyStore.getChildrenOf(p.id);
    const siblings = FamilyStore.getSiblingsOf(p.id);

    emptyEl.hidden = true;
    contentEl.hidden = false;
    UI.clear(contentEl);

    const deceased = FamilyStore.isDeceased ? FamilyStore.isDeceased(p) : !!p.deathDate;

    // Hero block — once a death date is set, the hero takes a quiet "In loving
    // memory" eyebrow and a parchment wash (see .inspector-hero--memoriam),
    // a dignified marker distinct from the rust lifeline chip.
    contentEl.appendChild(UI.el("div", { class: "inspector-hero" + (deceased ? " inspector-hero--memoriam" : "") }, [
      deceased
        ? UI.el("div", { class: "inspector-hero__memoriam" }, [
            UI.el("i", { class: "fa-solid fa-feather", "aria-hidden": "true" }),
            UI.el("span", null, I18n.t("profile.inMemoriam"))
          ])
        : null,
      UI.avatar(p, "lg"),
      UI.el("h2", { class: "inspector-hero__name" }, [
        displayName,
        // alternate-script subtitle
        (I18n.getLang() === "hi" && p.name && p.name !== displayName)
          ? UI.el("span", { class: "inspector-hero__name-hi" }, p.name)
          : (I18n.getLang() !== "hi" && p.name_hi && p.name_hi !== displayName)
            ? UI.el("span", { class: "inspector-hero__name-hi", lang: "hi" }, p.name_hi)
            : null
      ]),
      displayOcc ? UI.el("div", { class: "inspector-hero__role" }, displayOcc) : null,
      UI.el("div", { class: "inspector-hero__chips" }, lifelineChips(p).concat(selfChip(p)))
    ]));

    // Action row — only real, persistent actions
    contentEl.appendChild(UI.el("div", { class: "inspector-actions" }, [
      iconAction("openInTree", "fa-solid fa-sitemap", I18n.t("inspector.actOpenInTree"), () => {
        try { window.dispatchEvent(new CustomEvent("virasat:reveal-in-tree", { detail: { id: p.id } })); } catch (_) {}
      }),
      readAloudAction(p),
      iconAction("note",  "fa-regular fa-note-sticky", I18n.t("inspector.actAddNote"), () => focusNotes()),
      iconAction("share", "fa-regular fa-image",       I18n.t("inspector.actSaveImage"), async () => {
        if (!window.ImageExport) return;
        try {
          const { blob, filename } = await ImageExport.exportFullProfile(p.id);
          const saved = await ImageExport.share(blob, filename, displayName);
          if (saved) UI.toast(I18n.t("inspector.imageSaved"), "success");
        } catch (e) {
          // Don't surface the raw lib error to a family member; keep it in the
          // console. (A user-cancelled share sheet lands here too — a quiet,
          // friendly toast is fine either way.)
          try { console.warn("[Virasat] save-image failed:", e); } catch (_) {}
          UI.toast(I18n.t("inspector.imageFailed"), "danger");
        }
      }),
      // Memorial poster — only for someone who has passed. A framed A4 keepsake
      // built on the wide hero crop; sits beside the everyday "Save as image".
      deceased ? iconAction("memorial", "fa-solid fa-feather", I18n.t("inspector.actMemorial"), async () => {
        if (!window.ImageExport || !ImageExport.exportMemorialPoster) return;
        try {
          const { blob, filename } = await ImageExport.exportMemorialPoster(p.id);
          const saved = await ImageExport.share(blob, filename, displayName);
          if (saved) UI.toast(I18n.t("inspector.memorialSaved"), "success");
        } catch (e) {
          try { console.warn("[Virasat] memorial-poster failed:", e); } catch (_) {}
          UI.toast(I18n.t("inspector.imageFailed"), "danger");
        }
      }) : null,
      iconAction("edit",  "fa-solid fa-user-pen",        I18n.t("inspector.actEdit"), () =>
        window.PeopleView && PeopleView.openForm && PeopleView.openForm(p.id)
      ),
      iconAction("delete","fa-regular fa-trash-can",     I18n.t("inspector.actDelete"), async () => {
        // Deceased records carry the memorial-grade confirm (see the hero's
        // "In loving memory" treatment above — same principle).
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
        if (ok) { FamilyStore.deletePerson(p.id); clear(); UI.toast(I18n.t("form.removed"), "success"); }
      })
    ]));

    // Collapsible biographical sections (heritage feel: read like chapters)
    const sectionStates = loadSectionStates();
    const sections = [];

    sections.push(makeSection("about", I18n.t("inspector.secAbout"), "fa-regular fa-bookmark", true,
      displayDesc
        ? UI.el("p", { class: "inspector-prose" }, displayDesc)
        : muted(I18n.t("inspector.emptyAbout")), sectionStates));

    sections.push(makeSection("personal", I18n.t("inspector.secPersonal"), "fa-regular fa-id-card", true,
      buildPersonalInfo(p, F, { displayBirthPlace, displayDeathPlace }), sectionStates));

    sections.push(makeSection("achievements", I18n.t("inspector.secAchievements"), "fa-solid fa-trophy", false,
      (displayAchievements && displayAchievements.length)
        ? UI.el("ul", { class: "inspector-list" }, displayAchievements.map((a) => UI.el("li", null, a)))
        : muted(I18n.t("inspector.emptyList")), sectionStates));

    sections.push(makeSection("education", I18n.t("inspector.secEducation"), "fa-solid fa-graduation-cap", false,
      (displayEducation && displayEducation.length)
        ? UI.el("ul", { class: "inspector-list inspector-list--edu" }, displayEducation.map((e) => UI.el("li", null, e)))
        : muted(I18n.t("inspector.emptyList")), sectionStates));

    sections.push(makeSection("family", I18n.t("inspector.secFamily"), "fa-solid fa-people-roof", true,
      buildFamilyBlock(p, parents, spouses, children, siblings), sectionStates));

    // Contact — only render if at least one field is non-empty. The form
    // shows the inputs unconditionally but a blank Contact section in the
    // inspector would be noise.
    const c = p.contact || {};
    if (c.phone || c.email || c.address) {
      sections.push(makeSection("contact", I18n.t("inspector.secContact"), "fa-solid fa-address-card", false,
        buildContactBlock(p), sectionStates));
    }

    sections.push(makeSection("stories", I18n.t("inspector.secStories"), "fa-solid fa-book-open", false,
      buildStoriesBlock(p), sectionStates));

    sections.push(makeSection("photo", I18n.t("inspector.secPhoto"), "fa-regular fa-image", false,
      buildPhotoBlock(p), sectionStates));

    // Documents / sources — only when at least one scan is attached, so the
    // section doesn't read as an empty prompt (same rule as Contact).
    const docs = Array.isArray(p.documents) ? p.documents.filter((d) => d && (d.photoId || d.photo)) : [];
    if (docs.length) {
      sections.push(makeSection("documents", I18n.t("inspector.secDocuments"), "fa-solid fa-file-lines", false,
        buildDocumentsBlock(docs), sectionStates));
    }

    sections.push(makeSection("notes", I18n.t("inspector.secNotes"), "fa-regular fa-pen-to-square", false,
      buildNotesBlock(p), sectionStates));

    sections.forEach((s) => contentEl.appendChild(s));

    // Meta footer
    const fmt = (s) => s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;
    const created = fmt(p.createdAt);
    const updated = fmt(p.updatedAt);
    if (created || updated) {
      const meta = UI.el("div", { class: "inspector-meta" });
      if (created) meta.appendChild(UI.el("span", null, I18n.t("inspector.created") + " · " + created));
      if (updated) meta.appendChild(UI.el("span", null, I18n.t("inspector.updated") + " · " + updated));
      contentEl.appendChild(meta);
    }
  }

  // — Section helpers —
  const SECTION_STATE_KEY = "familyTree.inspector.sections";
  function loadSectionStates() {
    try {
      const raw = localStorage.getItem(SECTION_STATE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }
  function persistSectionStates(states) {
    try { localStorage.setItem(SECTION_STATE_KEY, JSON.stringify(states)); } catch (_) {}
  }

  function makeSection(id, title, icon, defaultOpen, body, states) {
    const isOpen = (id in states) ? !!states[id] : !!defaultOpen;
    const sec = UI.el("section", {
      class: "inspector-section" + (isOpen ? " is-open" : ""),
      "data-section-id": id
    });
    const bodyId = "inspector-sec-" + id;
    const head = UI.el("div", { class: "inspector-section__head", role: "button", tabindex: "0",
      "aria-expanded": isOpen ? "true" : "false", "aria-controls": bodyId,
      onclick: toggle,
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }
    }, [
      UI.el("h3", { class: "inspector-section__title" }, [
        UI.el("i", { class: icon, "aria-hidden": "true" }),
        UI.el("span", null, title)
      ]),
      UI.el("i", { class: "fa-solid fa-chevron-down inspector-section__chevron", "aria-hidden": "true" })
    ]);
    const bodyWrap = UI.el("div", { class: "inspector-section__body", id: bodyId }, [body]);
    sec.appendChild(head);
    sec.appendChild(bodyWrap);

    function toggle() {
      sec.classList.toggle("is-open");
      const open = sec.classList.contains("is-open");
      head.setAttribute("aria-expanded", open ? "true" : "false");
      const states = loadSectionStates();
      states[id] = open;
      persistSectionStates(states);
    }
    return sec;
  }

  function muted(text) { return UI.el("p", { class: "profile__muted" }, text); }

  function buildPersonalInfo(p, F, ctx) {
    const rows = [];
    const t = (k, v) => I18n.t("inspector." + k, v);
    function withPrecision(date, precision) {
      const formatted = formatDateLong(date);
      if (!precision || precision === "exact") return formatted;
      // Reuse the date.* prefixes (already EN+HI) — pass the formatted date as
      // the interpolated value so "c./before/after" localize with the number.
      if (precision === "about")  return I18n.t("date.circa",  { year: formatted });
      if (precision === "before") return I18n.t("date.before", { year: formatted });
      if (precision === "after")  return I18n.t("date.after",  { year: formatted });
      return formatted;
    }
    if (p.birthDate) rows.push([t("born"), withPrecision(p.birthDate, p.birthDatePrecision) + (ctx.displayBirthPlace ? " · " + ctx.displayBirthPlace : "")]);
    else if (ctx.displayBirthPlace) rows.push([t("born"), ctx.displayBirthPlace]);
    if (p.deathDate) rows.push([t("died"), withPrecision(p.deathDate, p.deathDatePrecision) + (ctx.displayDeathPlace ? " · " + ctx.displayDeathPlace : "")]);
    else if (ctx.displayDeathPlace) rows.push([t("died"), ctx.displayDeathPlace]);
    if (p.gender) rows.push([t("gender"), { m: I18n.t("form.genderM"), f: I18n.t("form.genderF"), o: I18n.t("form.genderO") }[p.gender] || p.gender]);
    if (F("occupation")) rows.push([t("occupation"), F("occupation")]);
    const age = FamilyStore.calcAge(p);
    if (age != null) rows.push([p.deathDate ? t("lifespan") : t("age"), p.deathDate ? t("years", { n: age }) : String(age)]);
    return UI.el("dl", { class: "inspector-rows" },
      rows.map(([k, v]) => UI.el("div", { class: "inspector-row" }, [
        UI.el("dt", null, k),
        UI.el("dd", null, v)
      ]))
    );
  }

  function formatDateLong(s) {
    if (!s) return "";
    // YYYY-MM-DD → "14 Aug 2026"; YYYY-MM → "Aug 2026"; YYYY → "2026".
    // Month names are localized via Intl, mirroring anniversaries.js dateLabel —
    // the old hardcoded ["Jan"…"Dec"] array left every inspector date in English
    // even in Hindi UI (this is the most-seen date surface in the app). Date
    // built with the local-time constructor so day-precision dates never shift a
    // day across a tz boundary. Locales: hi-IN for Hindi, en-IN for English —
    // Indian English gives the day-first "14 Aug 2026" order this India-focused
    // app expects, byte-identical to the old array so existing English dates
    // don't reformat; en-US would flip it to "Aug 14, 2026". anniversaries.js
    // uses en-IN too, so all English dates in the app share one locale.
    const m = String(s).match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
    if (!m) return s;
    const y = +m[1];
    if (!m[2]) return String(y);
    const mo = +m[2];
    const locale = (I18n.getLang && I18n.getLang() === "hi") ? "hi-IN" : "en-IN";
    try {
      // Options passed inline (not via a const) so the "numeric"/"short" string
      // literals keep their DateTimeFormatOptions types under // @ts-check —
      // same idiom as anniversaries.js dateLabel.
      const d = new Date(y, mo - 1, m[3] ? +m[3] : 1);
      return m[3]
        ? d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })
        : d.toLocaleDateString(locale, { month: "short", year: "numeric" });
    } catch (_) {
      return s;   // Intl unavailable for the locale — raw ISO beats a crash
    }
  }

  function buildFamilyBlock(p, parents, spouses, children, siblings) {
    const wrap = UI.el("div", null);
    // Explicitly-unknown parent roles the family recorded (adoption, a lost
    // line) — distinct from simply not-yet-filled-in. Rendered as dashed,
    // non-interactive placeholder chips alongside any known parents.
    const unknownRoles = Array.isArray(p.unknownParents) ? p.unknownParents : [];
    const unknownChips = unknownRoles.map((role) =>
      UI.el("div", {
        class: "inspector-chip inspector-chip--unknown",
        title: I18n.t("profile.parentUnknownNote")
      }, [
        UI.el("span", { class: "inspector-chip__ph", "aria-hidden": "true" },
          UI.el("i", { class: "fa-solid fa-user-slash" })),
        UI.el("span", null, I18n.t(role === "mother" ? "profile.parentUnknownMother" : "profile.parentUnknownFather"))
      ])
    );
    const groups = [
      [I18n.t("profile.parents"), parents, unknownChips],
      [I18n.t("profile.spouses"), spouses, null],
      [I18n.t("profile.children"), children, null],
      [I18n.t("profile.siblings"), siblings, null]
    ];
    let any = false;
    groups.forEach(([label, list, extras]) => {
      const hasList = list && list.length;
      const hasExtras = extras && extras.length;
      if (!hasList && !hasExtras) return;
      any = true;
      const chips = (list || []).map((person) => {
        const dn = FamilyStore.getField(person, "name") || person.name;
        return UI.el("button", {
          class: "inspector-chip", type: "button",
          onclick: () => revealInTree(person.id)
        }, [
          UI.avatar(person, "xs"),
          UI.el("span", null, dn),
          UI.el("span", { class: "inspector-chip__role" }, FamilyStore.formatDateRange(person))
        ]);
      });
      if (hasExtras) extras.forEach((c) => chips.push(c));
      wrap.appendChild(UI.el("div", { class: "inspector-family-group" }, [
        UI.el("div", { class: "inspector-family-group__label" }, label),
        UI.el("div", { class: "inspector-chiplist" }, chips)
      ]));
    });
    if (!any) wrap.appendChild(muted(I18n.t("inspector.emptyFamily")));

    wrap.appendChild(UI.el("div", { class: "inspector-add-row js-edit-only" }, [
      UI.el("button", {
        class: "btn btn--sm", type: "button",
        onclick: () => window.PeopleView && PeopleView.openForm && PeopleView.openForm(null, {
          parents: [p.id, ...(p.spouses && p.spouses.length === 1 ? [p.spouses[0]] : [])]
        })
      }, [UI.el("i", { class: "fa-solid fa-baby" }), UI.el("span", null, I18n.t("inspector.addChild"))]),
      UI.el("button", {
        class: "btn btn--sm", type: "button",
        onclick: () => window.PeopleView && PeopleView.openForm && PeopleView.openForm(null, { spouses: [p.id] })
      }, [UI.el("i", { class: "fa-solid fa-heart" }), UI.el("span", null, I18n.t("inspector.addSpouse"))]),
      UI.el("button", {
        class: "btn btn--sm", type: "button",
        onclick: () => window.PeopleView && PeopleView.openForm && PeopleView.openForm(null, { __addAsParentOf: p.id })
      }, [UI.el("i", { class: "fa-solid fa-user-plus" }), UI.el("span", null, I18n.t("inspector.addParent"))])
    ]));
    return wrap;
  }

  function buildPhotoBlock(p) {
    const photoWrap = UI.el("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" } });
    const big = UI.el("div", {
      style: {
        width: "100%", aspectRatio: "1/1", maxWidth: "260px",
        borderRadius: "var(--r-lg)", overflow: "hidden",
        border: "1px solid var(--line)", background: "var(--surface-2)"
      }
    });
    // The "no photo" placeholder — also shown when an async getUrl() comes back
    // empty (a photoId whose blob isn't in this device's IDB), so a missing
    // blob degrades to this calm empty state instead of a broken-image icon.
    const emptyPhoto = () => UI.el("div", {
      style: {
        width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--text-3)", fontSize: "13px", textAlign: "center", padding: "24px",
        fontFamily: "var(--font-display)"
      }
    }, I18n.t("inspector.emptyPhoto"));
    const url = window.PhotoStore ? PhotoStore.getUrlSync(p) : (p.photo || null);
    if (url) {
      big.appendChild(UI.el("img", { src: url, alt: "", style: { width: "100%", height: "100%", objectFit: "cover" } }));
    } else if (window.PhotoStore && (p.photoId)) {
      const img = UI.el("img", { src: "", alt: "", style: { width: "100%", height: "100%", objectFit: "cover" } });
      big.appendChild(img);
      const fallback = () => { if (big.contains(img)) big.removeChild(img); big.appendChild(emptyPhoto()); };
      PhotoStore.getUrl(p).then((u) => { if (u) img.src = u; else fallback(); }).catch(fallback);
    } else {
      big.appendChild(emptyPhoto());
    }
    photoWrap.appendChild(big);

    // Gallery — additional photos beneath the primary, each with an optional
    // caption. A missing blob (cold remote tree) degrades to a calm empty tile
    // via the same getUrl→fallback dance as the primary, never a broken image.
    const gallery = Array.isArray(p.gallery) ? p.gallery.filter((g) => g && (g.photoId || g.photo)) : [];
    if (gallery.length) {
      const grid = UI.el("div", { class: "inspector-gallery" }, gallery.map((g) => {
        const tile = UI.el("div", { class: "inspector-gallery__thumb" });
        const syncUrl = window.PhotoStore ? PhotoStore.getUrlSync({ photoId: g.photoId, photo: g.photo }) : (g.photo || null);
        const img = UI.el("img", { src: syncUrl || "", alt: g.caption || "", loading: "lazy" });
        tile.appendChild(img);
        if (!syncUrl && window.PhotoStore && g.photoId) {
          PhotoStore.getUrl({ photoId: g.photoId }).then((u) => { if (u) img.src = u; else tile.classList.add("is-empty"); }).catch(() => tile.classList.add("is-empty"));
        }
        return UI.el("figure", { class: "inspector-gallery__cell" }, [
          tile,
          g.caption ? UI.el("figcaption", { class: "inspector-gallery__caption" }, g.caption) : null
        ]);
      }));
      photoWrap.appendChild(grid);
    }

    photoWrap.appendChild(UI.el("button", {
      class: "btn btn--sm js-edit-only", type: "button",
      onclick: () => window.PeopleView && PeopleView.openForm && PeopleView.openForm(p.id)
    }, [UI.el("i", { class: "fa-regular fa-pen-to-square" }), UI.el("span", null, I18n.t("inspector.editPhoto"))]));
    return photoWrap;
  }

  // === Documents / sources block ===
  // Each source is a card: a thumbnail that opens the full scan in a new tab
  // (so a certificate's text is readable), the title, a kind+date meta line,
  // and the citation note in the family's own words. A missing blob (cold
  // remote tree) degrades to a calm empty tile, never a broken image.
  const DOC_KIND_ICONS = {
    certificate: "fa-solid fa-stamp",
    letter: "fa-solid fa-envelope-open-text",
    article: "fa-solid fa-newspaper",
    photo: "fa-regular fa-image",
    other: "fa-solid fa-file-lines"
  };
  function buildDocumentsBlock(docs) {
    return UI.el("div", { class: "inspector-docs" }, docs.map((d) => {
      const tile = UI.el("div", { class: "inspector-docs__thumb" });
      const syncUrl = window.PhotoStore ? PhotoStore.getUrlSync({ photoId: d.photoId, photo: d.photo }) : (d.photo || null);
      const img = UI.el("img", { src: syncUrl || "", alt: d.title || "", loading: "lazy" });
      tile.appendChild(img);
      // Open the full-resolution scan in a new tab on click/Enter.
      const openScan = () => {
        const src = img.getAttribute("src");
        if (src) { try { window.open(src, "_blank", "noopener"); } catch (_) {} }
      };
      if (!syncUrl && window.PhotoStore && d.photoId) {
        PhotoStore.getUrl({ photoId: d.photoId }).then((u) => { if (u) img.src = u; else tile.classList.add("is-empty"); }).catch(() => tile.classList.add("is-empty"));
      }

      const kind = d.kind || "other";
      const kindLabel = I18n.t("form.docKind_" + kind);
      const dateStr = d.date ? formatDateLong(d.date) : "";
      const metaParts = [];
      if (kindLabel && kindLabel !== "form.docKind_" + kind) metaParts.push(kindLabel);
      if (dateStr) metaParts.push(dateStr);

      const thumbBtn = UI.el("button", {
        class: "inspector-docs__thumb-btn", type: "button",
        title: I18n.t("inspector.docOpen"), "aria-label": I18n.t("inspector.docOpen"),
        onclick: openScan
      }, [tile]);

      return UI.el("figure", { class: "inspector-docs__cell" }, [
        thumbBtn,
        UI.el("div", { class: "inspector-docs__body" }, [
          UI.el("div", { class: "inspector-docs__title" }, [
            UI.el("i", { class: (DOC_KIND_ICONS[kind] || DOC_KIND_ICONS.other) + " inspector-docs__icon", "aria-hidden": "true" }),
            UI.el("span", null, d.title || kindLabel || I18n.t("inspector.docUntitled"))
          ]),
          metaParts.length ? UI.el("div", { class: "inspector-docs__meta" }, metaParts.join(" · ")) : null,
          d.note ? UI.el("p", { class: "inspector-docs__note" }, d.note) : null
        ])
      ]);
    }));
  }

  // === Contact block ===
  // Render phone / email / address rows; each shows a "private" badge when
  // its privacy flag is on. Tapping any row launches the OS-native handler
  // (tel:, mailto:, geo: / maps: depending on platform).
  function buildContactBlock(p) {
    const c = p.contact || {};
    const wrap = UI.el("div", { class: "contact-block" });
    // A view-only member (read-only tree) must not see fields the owner marked
    // private. We render a locked placeholder instead of the value, and — the
    // part that actually matters — never put the value into the DOM or into a
    // tappable tel:/mailto: href. NOTE: this is the UI half. With whole-blob
    // LWW the full JSONB still reaches a viewer's client, so a determined one
    // could read it via DevTools; true redaction needs the SECURITY DEFINER
    // RPC logged as a fast-follow (see docs/UX-BACKLOG.md + schema.sql).
    const isViewer = !!(window.FamilyStore && FamilyStore.isReadOnly && FamilyStore.isReadOnly());
    function row(field, value, isPrivate, icon, hrefBuilder, label) {
      if (!value) return;
      // Redacted branch: a private field on a read-only tree renders as a
      // non-interactive locked row. The real value is never emitted.
      if (isPrivate && isViewer) {
        wrap.appendChild(UI.el("div", { class: "contact-row contact-row--redacted", title: I18n.t("form.privateRedacted") }, [
          UI.el("i", { class: icon + " contact-row__icon", "aria-hidden": "true" }),
          UI.el("div", { class: "contact-row__body" }, [
            UI.el("div", { class: "contact-row__label" }, label),
            UI.el("div", { class: "contact-row__value contact-row__value--redacted" }, I18n.t("form.privateRedacted"))
          ]),
          UI.el("span", { class: "chip chip--muted contact-row__private" }, [
            UI.el("i", { class: "fa-solid fa-lock", "aria-hidden": "true" })
          ])
        ]));
        return;
      }
      const r = UI.el("a", {
        class: "contact-row",
        href: hrefBuilder(value),
        title: label
      }, [
        UI.el("i", { class: icon + " contact-row__icon", "aria-hidden": "true" }),
        UI.el("div", { class: "contact-row__body" }, [
          UI.el("div", { class: "contact-row__label" }, label),
          UI.el("div", { class: "contact-row__value" }, value)
        ]),
        isPrivate ? UI.el("span", { class: "chip chip--muted contact-row__private", title: I18n.t("form.privateExportOnly") }, [
          UI.el("i", { class: "fa-solid fa-lock", "aria-hidden": "true" }),
          UI.el("span", null, I18n.t("form.private"))
        ]) : null
      ]);
      wrap.appendChild(r);
    }
    row("phone", c.phone, c.privatePhone, "fa-solid fa-phone",
      (v) => "tel:" + v.replace(/\s+/g, ""), I18n.t("form.phoneLabel"));
    row("email", c.email, c.privateEmail, "fa-solid fa-envelope",
      (v) => "mailto:" + v, I18n.t("form.emailLabel"));
    row("address", c.address, c.privateAddress, "fa-solid fa-house",
      (v) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(v), I18n.t("form.addressLabel"));
    return wrap;
  }

  // === Stories block ===
  function buildStoriesBlock(p) {
    const wrap = UI.el("div", { class: "stories-block" });
    function render() {
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
      const stories = (p.stories || []).slice().sort(
        (a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")
      );
      if (stories.length === 0) {
        wrap.appendChild(muted(I18n.t("inspector.emptyStories")));
      } else {
        stories.forEach((s) => wrap.appendChild(storyCard(p, s)));
      }
      const addBtn = UI.el("button", {
        class: "btn btn--sm js-edit-only", type: "button",
        style: { marginTop: "12px" },
        onclick: () => openStoryEditor(p, null)
      }, [
        UI.el("i", { class: "fa-solid fa-plus" }),
        UI.el("span", null, I18n.t("inspector.addStory"))
      ]);
      wrap.appendChild(addBtn);
    }
    render();
    // NB: intentionally NO per-block FamilyStore.subscribe here. The inspector
    // already holds one master subscription (see mount → FamilyStore.subscribe
    // (() => render())) that rebuilds the ENTIRE panel — including a fresh
    // buildStoriesBlock(p) — on every store change. A second subscription here
    // fired on every one of those rebuilds and was never torn down (the old
    // wrap is discarded but its listener stays registered), so every store
    // mutation permanently leaked another orphaned listener doing wasted work
    // on a detached node. The master subscription covers the story list too.
    return wrap;
  }

  function storyCard(p, s) {
    const card = UI.el("article", {
      class: "story-card",
      tabindex: "0",
      "data-story-id": s.id,
      onclick: () => openStoryEditor(p, s),
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openStoryEditor(p, s); } }
    });
    if (s.title) card.appendChild(UI.el("h4", { class: "story-card__title" }, s.title));
    const preview = (s.body || "").trim().slice(0, 220);
    if (preview) card.appendChild(UI.el("p", { class: "story-card__body" }, preview + ((s.body || "").length > 220 ? "…" : "")));
    if (s.tags && s.tags.length) {
      const tagRow = UI.el("div", { class: "story-card__tags" },
        s.tags.map((t) => UI.el("span", { class: "chip chip--gold" }, "#" + t)));
      card.appendChild(tagRow);
    }
    if (s.updatedAt) {
      card.appendChild(UI.el("div", { class: "story-card__meta" },
        new Date(s.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })));
    }
    return card;
  }

  // "Need an idea?" — a gentle cure for the blank-page problem. Collapsed to a
  // single quiet link; expands into a card showing one heritage question at a
  // time. "Use this prompt" drops the question into the story (as the body when
  // it's empty, else appended as a fresh paragraph); "Show another" rotates. A
  // shuffled order means every prompt appears once before any repeats. Purely
  // additive — a suggestion, never required, and it never overwrites text.
  function buildPromptHelper(draft, titleInput, bodyInput) {
    const prompts = I18n.t("inspector.prompts");
    if (!Array.isArray(prompts) || !prompts.length) return null;

    // A shuffled queue of indices so "Show another" cycles without repeats.
    let order = shuffledIndices(prompts.length);
    let cursor = 0;
    const nextPrompt = () => {
      if (cursor >= order.length) { order = shuffledIndices(prompts.length); cursor = 0; }
      return prompts[order[cursor++]];
    };

    const wrap = UI.el("div", { class: "story-prompt" });
    const toggle = UI.el("button", {
      class: "story-prompt__toggle", type: "button", "aria-expanded": "false",
      onclick: () => setOpen(!wrap.classList.contains("is-open"))
    }, [
      UI.el("i", { class: "fa-regular fa-lightbulb", "aria-hidden": "true" }),
      UI.el("span", null, I18n.t("inspector.promptOpen"))
    ]);

    const questionEl = UI.el("p", { class: "story-prompt__question" });
    const useBtn = UI.el("button", { class: "btn btn--gold btn--sm", type: "button" }, [
      UI.el("i", { class: "fa-solid fa-arrow-down", "aria-hidden": "true" }),
      UI.el("span", null, I18n.t("inspector.promptUse"))
    ]);
    const anotherBtn = UI.el("button", { class: "btn btn--ghost btn--sm", type: "button" }, [
      UI.el("i", { class: "fa-solid fa-rotate", "aria-hidden": "true" }),
      UI.el("span", null, I18n.t("inspector.promptAnother"))
    ]);
    const panel = UI.el("div", { class: "story-prompt__panel", hidden: true }, [
      UI.el("span", { class: "story-prompt__label" }, I18n.t("inspector.promptHeading")),
      questionEl,
      UI.el("div", { class: "story-prompt__actions" }, [useBtn, anotherBtn])
    ]);

    function setOpen(open) {
      wrap.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      panel.hidden = !open;
      if (open && !questionEl.textContent) questionEl.textContent = nextPrompt();
    }
    anotherBtn.addEventListener("click", () => { questionEl.textContent = nextPrompt(); });
    useBtn.addEventListener("click", () => {
      const q = questionEl.textContent || "";
      if (!q) return;
      // Prefer the body: an empty body takes the question as its opening line;
      // a non-empty body gets it as a fresh paragraph the writer can answer
      // beneath. Never clobber what's already typed.
      const cur = draft.body || "";
      draft.body = cur.trim() ? cur.replace(/\s*$/, "") + "\n\n" + q + "\n" : q + "\n";
      bodyInput.value = draft.body;
      bodyInput.focus();
      // Put the caret at the end so the writer starts answering immediately.
      try { bodyInput.setSelectionRange(bodyInput.value.length, bodyInput.value.length); } catch (e) {}
    });

    wrap.appendChild(toggle);
    wrap.appendChild(panel);
    return wrap;
  }

  // Fisher–Yates shuffle of [0..n). Math.random is fine here — this is runtime
  // UI ordering, not anything that needs to be reproducible.
  function shuffledIndices(n) {
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function openStoryEditor(p, existing) {
    const isEdit = !!existing;
    // A story card is the read surface too — clicking one opens this modal. For
    // a read-only viewer (real viewer-role member OR an owner previewing) that
    // must be VIEW-only: the inputs go readonly and the Save/Delete paths are
    // dropped, mirroring the notes textarea above. Without this a viewer could
    // edit + Save and get a green "saved" toast while addStory/updateStory
    // no-op at the store — a lie. Viewing an existing story stays available.
    const ro = !!(FamilyStore.isReadOnly && FamilyStore.isReadOnly());
    const draft = {
      title: existing ? existing.title || "" : "",
      body: existing ? existing.body || "" : "",
      tags: existing ? (existing.tags || []).slice() : []
    };
    const titleInput = UI.el("input", {
      class: "input", type: "text", value: draft.title,
      readonly: ro ? "readonly" : null,
      placeholder: ro ? "" : I18n.t("inspector.storyTitlePlaceholder"),
      oninput: (e) => { draft.title = e.target.value; }
    });
    const bodyInput = UI.el("textarea", {
      class: "textarea",
      style: { minHeight: "180px" },
      readonly: ro ? "readonly" : null,
      placeholder: ro ? "" : I18n.t("inspector.storyBodyPlaceholder"),
      oninput: (e) => { draft.body = e.target.value; }
    }, draft.body);
    const tagsInput = UI.el("input", {
      class: "input", type: "text",
      value: draft.tags.join(", "),
      readonly: ro ? "readonly" : null,
      placeholder: ro ? "" : I18n.t("inspector.storyTagsPlaceholder"),
      oninput: (e) => {
        draft.tags = String(e.target.value || "")
          .split(/[,]+/)
          .map((t) => t.trim().toLowerCase()).filter(Boolean);
      }
    });
    const body = UI.el("div", { class: "form-stack" }, [
      UI.field(I18n.t("inspector.storyTitleLabel"), titleInput, I18n.t("inspector.storyTitleHint")),
      UI.field(I18n.t("inspector.storyBodyLabel"), bodyInput, I18n.t("inspector.storyBodyHint")),
      // The prompt helper writes into the draft/inputs — useless (and confusing)
      // when the fields are readonly, so it's omitted for viewers.
      ro ? null : buildPromptHelper(draft, titleInput, bodyInput),
      UI.field(I18n.t("inspector.storyTagsLabel"), tagsInput, I18n.t("inspector.storyTagsHint"))
    ]);
    // Read-only: just a Close button — no Save, no Delete. Editable: the full
    // cancel / save / (delete) footer.
    const cancelBtn = UI.cancelBtn(ro ? I18n.t("actions.close") : I18n.t("actions.cancel"));
    const saveBtn = ro ? null : UI.saveBtn(isEdit ? I18n.t("actions.save") : I18n.t("inspector.addStory"));
    const footer = ro ? [cancelBtn] : [cancelBtn, saveBtn];
    if (isEdit && !ro) {
      footer.unshift(UI.el("button", {
        class: "btn btn--danger", type: "button",
        style: { marginRight: "auto" },
        onclick: async () => {
          const ok = await UI.confirm({
            title: I18n.t("inspector.storyDeleteTitle"),
            message: I18n.t("inspector.storyDeleteMsg", { name: FamilyStore.getField(p, "name") || p.name }),
            confirmLabel: I18n.t("actions.delete"), danger: true
          });
          if (!ok) return;
          FamilyStore.deleteStory(p.id, existing.id);
          UI.toast(I18n.t("inspector.storyDeleted"), "success");
          dlg.close();
        }
      }, [
        UI.el("i", { class: "fa-regular fa-trash-can", "aria-hidden": "true" }),
        UI.el("span", null, I18n.t("actions.delete"))
      ]));
    }
    const dlg = UI.openModal({
      title: ro ? I18n.t("inspector.storyViewTitle")
                : (isEdit ? I18n.t("inspector.storyEditTitle") : I18n.t("inspector.storyNewTitle")),
      body, footer
    });
    cancelBtn.addEventListener("click", () => dlg.close());
    if (saveBtn) saveBtn.addEventListener("click", () => {
      if (!draft.body.trim() && !draft.title.trim()) {
        UI.toast(I18n.t("inspector.storyEmpty"), "danger");
        return;
      }
      if (isEdit) FamilyStore.updateStory(p.id, existing.id, draft);
      else FamilyStore.addStory(p.id, draft);
      UI.toast(isEdit ? I18n.t("inspector.storySaved") : I18n.t("inspector.storyAdded"), "success");
      dlg.close();
    });
    // Focus the body for editors; for viewers there's nothing to type into.
    if (!ro) setTimeout(() => bodyInput.focus(), 50);
  }

  function buildNotesBlock(p, currentNotes) {
    const displayName = FamilyStore.getField(p, "name") || p.name;
    // The inspector reads "displayNotes" via getField which falls back to EN
    // when the HI variant is empty. To prevent corrupting notes_hi when the
    // user types over the EN fallback in HI mode, the textarea must show the
    // *current language's* raw value (not the fallback).
    const lang = I18n.getLang();
    const rawValue = lang === "hi" ? (p.notes_hi || "") : (p.notes || "");
    // Viewers (read-only shared trees) see notes but can't edit them. The store
    // guard already no-ops the write; making the textarea readOnly keeps the UI
    // honest so a viewer isn't typing into a field that silently discards.
    const ro = !!(FamilyStore.isReadOnly && FamilyStore.isReadOnly());
    const ta = UI.el("textarea", {
      class: "inspector-notes-input",
      readonly: ro ? "readonly" : null,
      placeholder: ro ? "" : I18n.t("inspector.notesPlaceholder", { name: displayName })
    }, rawValue);
    let timer = null;
    ta.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const lang = I18n.getLang();
        const patch = lang === "hi" ? { notes_hi: ta.value } : { notes: ta.value };
        FamilyStore.updatePerson(p.id, patch);
      }, 600);
    });
    return ta;
  }

  function focusNotes() {
    // Force-open the Notes section if it's collapsed, then focus the textarea.
    const states = loadSectionStates();
    states.notes = true;
    persistSectionStates(states);
    render();
    setTimeout(() => {
      const ta = contentEl.querySelector(".inspector-notes-input");
      if (ta) ta.focus();
    }, 80);
  }

  function lifelineChips(p) {
    const out = [];
    const alive = FamilyStore.isAlive(p);
    const age = FamilyStore.calcAge(p);
    if (alive) out.push(UI.el("span", { class: "chip chip--alive" }, age != null ? I18n.t("people.ageLiving", { n: age }) : I18n.t("people.living")));
    else out.push(UI.el("span", { class: "chip chip--deceased" }, age != null ? I18n.t("people.ageLived", { n: age }) : I18n.t("people.deceased")));
    if (p.birthDate) out.push(UI.el("span", { class: "chip" }, FamilyStore.formatDateRange(p)));
    return out;
  }

  // A gold chip naming how THIS person relates to the pinned "self" (set via
  // the tree's right-click "This is me"). Returns [] — so callers can .concat
  // it — when no self is pinned, when this person IS self, or when the exact
  // kin word is outside KinTerms' close-kin lexicon (distant / in-law chains,
  // where we'd rather show nothing than a vague "relative"). The self-anchor is
  // per-viewer and local-only, so this label differs per viewer by design.
  function selfChip(p) {
    if (!window.SelfAnchor || !window.KinTerms || !p) return [];
    const selfId = SelfAnchor.get();
    if (!selfId) return [];
    // The pinned person themselves gets a "This is you" marker so it's clear
    // which node the labels are measured from.
    if (selfId === p.id) {
      return [UI.el("span", { class: "chip chip--gold" }, [
        UI.el("i", { class: "fa-solid fa-user-check", "aria-hidden": "true" }),
        UI.el("span", null, I18n.t("inspector.youAreSelf") || "This is you")
      ])];
    }
    const term = KinTerms.label(FamilyStore.findRelationPath(selfId, p.id));
    if (!term) return [];
    const nameOf = (pid) => { const q = FamilyStore.getPerson(pid); return q ? (FamilyStore.getField(q, "name") || q.name) : ""; };
    return [UI.el("span", {
      class: "chip chip--gold",
      // Screen readers get the full sentence ("Meera is Ankit's bua"); the
      // visible chip stays the single kin word so it reads as a label, not a
      // caption. Reuses path.kinAria (from = self, to = this person).
      "aria-label": I18n.t("path.kinAria", { from: nameOf(selfId), to: nameOf(p.id), term: term })
    }, [
      UI.el("i", { class: "fa-solid fa-people-roof", "aria-hidden": "true" }),
      UI.el("span", null, term)
    ])];
  }

  // ===== Read-aloud narration =====
  // Reads the selected person's text (name, lifespan, occupation, About,
  // achievements, education, notes, stories) via the browser's built-in
  // SpeechSynthesis — no network, no API key, works offline. Pure progressive
  // enhancement: if the engine is missing the button never appears. Available
  // to viewers too — listening isn't editing.
  const speech = (typeof window !== "undefined" && window.speechSynthesis) || null;
  let readBtn = null;
  let speaking = false;
  // Bumped on every stop/restart so a queued segment from a superseded run
  // (whose onend still fires after speech.cancel()) knows to bail.
  let readRun = 0;

  function supportsSpeech() {
    return !!(speech && typeof window.SpeechSynthesisUtterance === "function");
  }

  // getVoices() is populated asynchronously — often empty on the first call and
  // filled later, firing `voiceschanged`. Cache it and refresh on that event so
  // voice selection has real material to work with.
  let voiceList = [];
  function refreshVoices() { if (speech) voiceList = speech.getVoices() || []; }
  if (speech) {
    refreshVoices();
    try { speech.addEventListener("voiceschanged", refreshVoices); } catch (_) { speech.onvoiceschanged = refreshVoices; }
  }

  // macOS ships "fun" voices (Bad News, Boing, Bubbles, Zarvox…) tagged en-US
  // that sing/robotise text; if one is the OS default it mangles ordinary prose
  // into gibberish. Skip only these unambiguous novelty voices so a real spoken
  // voice is always chosen — being any broader risks emptying the usable set on
  // a stripped-down system. (Rishi/Fred/Kathy etc. are legitimate voices and are
  // deliberately NOT here.)
  const NOVELTY_VOICE = /^(Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Pipe Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Deranged|Hysterical)\b/i;

  // Pick the best real, script-appropriate voice for a segment. Relying on
  // `utterance.lang` alone is unreliable (Chrome frequently keeps the OS default
  // voice regardless), so we choose an explicit voice: skip novelty voices,
  // prefer a small ordered set of standard locales, then the engine default,
  // then any usable match. Returns null when the platform has no matching voice
  // (the lang hint is then the only signal — still better than a wrong voice).
  function pickVoice(kind) {
    if (!voiceList.length) refreshVoices();
    const wanted = kind === "hi" ? /^hi(-|$)/i : /^en(-|$)/i;
    const usable = voiceList.filter((v) => wanted.test(v.lang) && !NOVELTY_VOICE.test(v.name));
    if (!usable.length) return null;
    const prefer = kind === "hi" ? ["hi-IN"] : ["en-IN", "en-US", "en-GB"];
    for (const loc of prefer) {
      const hit = usable.find((v) => v.lang.toLowerCase() === loc.toLowerCase());
      if (hit) return hit;
    }
    return usable.find((v) => v.default) || usable[0];
  }

  // Classify a text run by its dominant script so a Hindi sentence gets a Hindi
  // voice and an English one gets an English voice — even in Hindi UI mode,
  // where getField() falls back to the English field when a translation is
  // missing, so a single person's narration is routinely mixed-script.
  function scriptOf(text) {
    const deva = (String(text).match(/[ऀ-ॿ]/g) || []).length;
    const latin = (String(text).match(/[A-Za-z]/g) || []).length;
    return deva > latin ? "hi" : "en";
  }

  // Chrome silently truncates a long utterance (~15 s of audio). Biographies and
  // stories easily exceed that, so split prose into sentence-sized chunks
  // (honouring the Hindi danda "।") and regroup to ≤200 chars so nothing is cut
  // off mid-word.
  function chunkText(text) {
    const out = [];
    const sentences = String(text).split(/(?<=[.?!।])\s+/);
    let buf = "";
    for (const s of sentences) {
      if (buf && (buf.length + s.length + 1) > 200) { out.push(buf); buf = s; }
      else buf = buf ? buf + " " + s : s;
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
  }

  // Assemble the spoken script from whatever text the person actually has, as an
  // ordered list of parts. Uses the display-language field (getField) so Hindi
  // mode narrates Hindi where a translation exists — and falls back to the
  // English field where it doesn't, which is exactly why each part is later
  // script-classified and voiced independently rather than forced to one voice.
  function narrationParts(p) {
    const parts = [];
    const name = FamilyStore.getField(p, "name") || p.name;
    if (name) parts.push(name + ".");
    const from = FamilyStore.getYear ? FamilyStore.getYear(p.birthDate) : null;
    const to = FamilyStore.getYear ? FamilyStore.getYear(p.deathDate) : null;
    if (from != null && to != null) parts.push(I18n.t("profile.lived", { from, to }) + ".");
    else if (from != null) parts.push(I18n.t("profile.livedFrom", { from }) + ".");
    const occ = FamilyStore.getField(p, "occupation") || p.occupation;
    if (occ) parts.push(occ + ".");
    const about = FamilyStore.getField(p, "description") || p.description;
    if (about) parts.push(about);
    const ach = FamilyStore.getField(p, "achievements") || p.achievements;
    if (Array.isArray(ach)) ach.forEach((a) => { if (a) parts.push(a + "."); });
    const edu = FamilyStore.getField(p, "education") || p.education;
    if (Array.isArray(edu)) edu.forEach((e) => { if (e) parts.push(e + "."); });
    const notes = FamilyStore.getField(p, "notes") || p.notes;
    if (notes) parts.push(notes);
    (p.stories || []).forEach((s) => {
      if (s && s.title) parts.push(s.title + ".");
      if (s && s.body) parts.push(s.body);
    });
    return parts;
  }

  // Turn the parts into a queue of {text, kind} segments to speak in order:
  // classify each part's script, merge consecutive same-script parts, then
  // sentence-chunk each so no segment is long enough to hit Chrome's truncation.
  function narrationQueue(p) {
    const merged = [];
    narrationParts(p).forEach((part) => {
      const kind = scriptOf(part);
      const last = merged[merged.length - 1];
      if (last && last.kind === kind) last.text += "  " + part;
      else merged.push({ kind, text: part });
    });
    const queue = [];
    merged.forEach((seg) => chunkText(seg.text).forEach((t) => queue.push({ text: t, kind: seg.kind })));
    return queue;
  }

  function stopReading() {
    readRun++; // invalidate any queued segment whose onend fires post-cancel
    if (speech) speech.cancel();
    speaking = false;
    syncReadBtn();
  }

  function syncReadBtn() {
    if (!readBtn) return;
    const icon = readBtn.querySelector("i");
    if (icon) icon.className = (speaking ? "fa-solid fa-stop" : "fa-solid fa-volume-high");
    const text = I18n.t(speaking ? "profile.stopReading" : "profile.readAloud");
    readBtn.setAttribute("aria-label", text);
    readBtn.setAttribute("title", text);
    readBtn.setAttribute("aria-pressed", speaking ? "true" : "false");
    readBtn.classList.toggle("is-active", speaking);
  }

  function toggleReading(p) {
    if (!supportsSpeech() || !speech) { UI.toast(I18n.t("profile.readAloudUnavailable"), "info"); return; }
    if (speaking) { stopReading(); return; }
    const queue = narrationQueue(p);
    if (!queue.length) return;
    // Cancel anything already queued (e.g. a prior person) before starting, and
    // claim this run so a late onend from the cancelled one can't advance us.
    speech.cancel();
    const run = ++readRun;
    speaking = true;
    syncReadBtn();

    let i = 0;
    const speakNext = () => {
      if (run !== readRun) return;           // superseded by stop / new run
      if (i >= queue.length) { speaking = false; syncReadBtn(); return; }
      const seg = queue[i++];
      const u = new window.SpeechSynthesisUtterance(seg.text);
      // Explicit voice + matching lang tag. Picking the voice is what actually
      // fixes garbled output — u.lang alone is only a hint many engines ignore,
      // so without this the OS default voice (possibly a wrong-language or
      // novelty voice) speaks every segment. Neutral rate/pitch for clarity.
      const voice = pickVoice(seg.kind);
      if (voice) u.voice = voice;
      u.lang = seg.kind === "hi" ? "hi-IN" : "en-US";
      u.rate = 1;
      u.pitch = 1;
      u.onend = () => { if (run === readRun) speakNext(); };
      u.onerror = () => { if (run === readRun) speakNext(); };
      speech.speak(u);
    };
    speakNext();
  }

  // Returns the read-aloud action button, or null when the engine is missing.
  // A fresh render replaces the DOM node, so reset the shared speaking flag and
  // cancel any lingering utterance to keep engine + UI in sync.
  function readAloudAction(p) {
    if (!supportsSpeech()) return null;
    speaking = false;
    if (speech) speech.cancel();
    readBtn = UI.el("button", {
      class: "inspector-action",
      type: "button",
      "aria-pressed": "false",
      "aria-label": I18n.t("profile.readAloud"),
      title: I18n.t("profile.readAloud"),
      onclick: () => toggleReading(p)
    }, [UI.el("i", { class: "fa-solid fa-volume-high", "aria-hidden": "true" })]);
    return readBtn;
  }

  // Actions that mutate the tree (add-note, edit, delete) carry the js-edit-only
  // marker so viewer-role shared trees hide them (body.is-viewer in CSS). Share
  // is a read-only export and stays visible to everyone.
  const EDIT_ACTIONS = { note: true, edit: true, delete: true };
  function iconAction(name, icon, label, handler) {
    return UI.el("button", {
      class: "inspector-action" + (EDIT_ACTIONS[name] ? " js-edit-only" : ""),
      type: "button",
      "aria-label": label,
      title: label,
      onclick: handler
    }, [UI.el("i", { class: icon })]);
  }

  // Auto-mount when DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }

  global.Inspector = { mount, show, clear, getSelected, onSelect };
})(window);
