/**
 * Inspector — right-pane panel that shows details for the currently selected person.
 *
 * window.Inspector = {
 *   show(personId)  — load a person into the panel
 *   clear()         — show the empty state
 *   getSelected()   — current person id
 *   onSelect(fn)    — subscribe to selection changes
 * }
 *
 * Tabs: Details · Media · Family · Notes
 */
(function (global) {
  "use strict";

  let mounted = false;
  let emptyEl = null;
  let contentEl = null;
  let panelEl = null;
  let selectedId = null;
  const listeners = new Set();

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
        const card = contentEl.querySelector('[data-story-id="' + opts.scrollToStoryId + '"]');
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

  // Family highlights shown in the empty inspector. Recomputes on every
  // render, which is cheap because the calls are O(N) over a small N.
  function renderHighlights() {
    if (!contentEl) return;
    const ppl = FamilyStore.getPeople();
    while (contentEl.firstChild) contentEl.removeChild(contentEl.firstChild);
    const wrap = UI.el("div", { class: "highlights" });

    if (ppl.length === 0) {
      wrap.appendChild(UI.el("div", { class: "highlights__intro" }, [
        UI.el("h3", { class: "highlights__title" }, "Welcome"),
        UI.el("p", { class: "highlights__hint" },
          "Add your first relative to start your tree, or load the sample family from the rail to see what's possible.")
      ]));
      contentEl.appendChild(wrap);
      return;
    }

    wrap.appendChild(UI.el("div", { class: "highlights__intro" }, [
      UI.el("div", { class: "highlights__eyebrow" }, "Family highlights"),
      UI.el("p", { class: "highlights__hint" }, "Pick anyone in the tree, list, or timeline to see their full profile.")
    ]));

    const grid = UI.el("div", { class: "highlights__grid" });
    function card(label, person, footer, icon) {
      if (!person) return;
      const c = UI.el("button", {
        class: "highlights__card",
        type: "button",
        onclick: () => show(person.id)
      }, [
        UI.el("div", { class: "highlights__label" }, [
          UI.el("i", { class: icon, "aria-hidden": "true" }),
          UI.el("span", null, label)
        ]),
        UI.el("div", { class: "highlights__person" }, [
          UI.avatar(person, "sm"),
          UI.el("div", { class: "highlights__person-name" },
            FamilyStore.getField(person, "name") || person.name)
        ]),
        footer ? UI.el("div", { class: "highlights__footer" }, footer) : null
      ]);
      grid.appendChild(c);
    }

    // Oldest known ancestor — earliest non-null birth year.
    let oldest = null;
    ppl.forEach((p) => {
      const y = FamilyStore.getYear(p.birthDate);
      if (y == null) return;
      const cy = oldest && FamilyStore.getYear(oldest.birthDate);
      if (cy == null || y < cy) oldest = p;
    });
    if (oldest) {
      const y = FamilyStore.getYear(oldest.birthDate);
      card("Oldest ancestor", oldest, "Born " + (y != null ? y : "—"), "fa-solid fa-tree");
    }

    // Latest addition — most recent createdAt.
    let latest = null;
    ppl.forEach((p) => {
      if (!latest || (p.createdAt || "") > (latest.createdAt || "")) latest = p;
    });
    if (latest) {
      const when = latest.createdAt ? new Date(latest.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
      card("Latest addition", latest, when ? "Added " + when : "", "fa-solid fa-user-plus");
    }

    // Most stories — person with the longest stories[] array (only if > 0).
    let mostStories = null;
    ppl.forEach((p) => {
      const n = (p.stories || []).length;
      if (n === 0) return;
      const cn = mostStories ? (mostStories.stories || []).length : 0;
      if (n > cn) mostStories = p;
    });
    if (mostStories) {
      const n = (mostStories.stories || []).length;
      card("Most stories", mostStories, n + (n === 1 ? " story" : " stories"), "fa-solid fa-book-open");
    }

    // Next upcoming anniversary (first hit from upcomingAnniversaries(60)).
    if (FamilyStore.upcomingAnniversaries) {
      const evs = FamilyStore.upcomingAnniversaries(60);
      if (evs.length) {
        const ev = evs[0];
        const days = ev.daysAway === 0 ? "today"
          : ev.daysAway === 1 ? "tomorrow"
          : "in " + ev.daysAway + " days";
        const label = ev.kind === "death" ? "Next memorial" : "Next birthday";
        card(label, ev.person, days, ev.kind === "death" ? "fa-solid fa-feather" : "fa-solid fa-cake-candles");
      }
    }

    wrap.appendChild(grid);

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
        const bar = UI.el("div", { class: "completion__bar" }, [
          UI.el("div", { class: "completion__fill", style: { width: pct + "%" } })
        ]);
        const completion = UI.el("div", { class: "completion" }, [
          UI.el("div", { class: "completion__head" }, [
            UI.el("div", { class: "completion__title" }, "Family archive"),
            UI.el("div", { class: "completion__pct" }, pct + "%")
          ]),
          bar,
          UI.el("div", { class: "completion__legend" }, [
            UI.el("span", null, filledPhotos + "/" + s.total + " photos"),
            UI.el("span", null, filledBirths + "/" + s.total + " birth dates"),
            UI.el("span", null, filledDesc + "/" + s.total + " descriptions")
          ])
        ]);
        wrap.appendChild(completion);
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

    // Hero block
    contentEl.appendChild(UI.el("div", { class: "inspector-hero" }, [
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
      UI.el("div", { class: "inspector-hero__chips" }, lifelineChips(p))
    ]));

    // Action row — only real, persistent actions
    contentEl.appendChild(UI.el("div", { class: "inspector-actions" }, [
      iconAction("note",  "fa-regular fa-pen-to-square", I18n.t("inspector.actAddNote"), () => focusNotes()),
      iconAction("share", "fa-solid fa-share-nodes",     I18n.t("inspector.actShare"), async () => {
        if (!window.ImageExport) return;
        try {
          const { blob, filename } = await ImageExport.exportFullProfile(p.id);
          await ImageExport.share(blob, filename, displayName);
          UI.toast(I18n.t("inspector.imageSaved"), "success");
        } catch (e) { UI.toast(e.message || "Failed", "danger"); }
      }),
      iconAction("edit",  "fa-solid fa-user-pen",        I18n.t("inspector.actEdit"), () =>
        window.PeopleView && PeopleView.openForm && PeopleView.openForm(p.id)
      ),
      iconAction("delete","fa-regular fa-trash-can",     I18n.t("inspector.actDelete"), async () => {
        const ok = await UI.confirm({
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
      sections.push(makeSection("contact", "Contact", "fa-solid fa-address-card", false,
        buildContactBlock(p), sectionStates));
    }

    sections.push(makeSection("stories", I18n.t("inspector.secStories"), "fa-solid fa-book-open", false,
      buildStoriesBlock(p), sectionStates));

    sections.push(makeSection("photo", I18n.t("inspector.secPhoto"), "fa-regular fa-image", false,
      buildPhotoBlock(p), sectionStates));

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
    const head = UI.el("div", { class: "inspector-section__head", role: "button", tabindex: "0",
      onclick: toggle,
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }
    }, [
      UI.el("h3", { class: "inspector-section__title" }, [
        UI.el("i", { class: icon, "aria-hidden": "true" }),
        UI.el("span", null, title)
      ]),
      UI.el("i", { class: "fa-solid fa-chevron-down inspector-section__chevron", "aria-hidden": "true" })
    ]);
    const bodyWrap = UI.el("div", { class: "inspector-section__body" }, [body]);
    sec.appendChild(head);
    sec.appendChild(bodyWrap);

    function toggle() {
      sec.classList.toggle("is-open");
      const states = loadSectionStates();
      states[id] = sec.classList.contains("is-open");
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
      if (precision === "about")  return "c. " + formatted;
      if (precision === "before") return "before " + formatted;
      if (precision === "after")  return "after "  + formatted;
      return formatted;
    }
    if (p.birthDate) rows.push([t("born"), withPrecision(p.birthDate, p.birthDatePrecision) + (ctx.displayBirthPlace ? " · " + ctx.displayBirthPlace : "")]);
    else if (ctx.displayBirthPlace) rows.push([t("born"), ctx.displayBirthPlace]);
    if (p.deathDate) rows.push([t("died"), withPrecision(p.deathDate, p.deathDatePrecision) + (ctx.displayDeathPlace ? " · " + ctx.displayDeathPlace : "")]);
    else if (ctx.displayDeathPlace) rows.push([t("died"), ctx.displayDeathPlace]);
    if (p.gender) rows.push([t("gender"), { m: I18n.t("form.genderM"), f: I18n.t("form.genderF"), o: I18n.t("form.genderO") }[p.gender] || p.gender]);
    if (F("occupation")) rows.push([t("occupation"), F("occupation")]);
    const age = FamilyStore.calcAge(p);
    if (age != null) rows.push([p.deathDate ? t("lifespan") : t("age"), age + (p.deathDate ? " yrs" : "")]);
    return UI.el("dl", { class: "inspector-rows" },
      rows.map(([k, v]) => UI.el("div", { class: "inspector-row" }, [
        UI.el("dt", null, k),
        UI.el("dd", null, v)
      ]))
    );
  }

  function formatDateLong(s) {
    if (!s) return "";
    // YYYY-MM-DD → "DD MMM YYYY"; YYYY → "YYYY".
    const m = String(s).match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
    if (!m) return s;
    const y = +m[1];
    if (!m[2]) return String(y);
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const mo = +m[2];
    if (!m[3]) return months[mo - 1] + " " + y;
    return (+m[3]) + " " + months[mo - 1] + " " + y;
  }

  function buildFamilyBlock(p, parents, spouses, children, siblings) {
    const wrap = UI.el("div", null);
    const groups = [
      [I18n.t("profile.parents"), parents],
      [I18n.t("profile.spouses"), spouses],
      [I18n.t("profile.children"), children],
      [I18n.t("profile.siblings"), siblings]
    ];
    let any = false;
    groups.forEach(([label, list]) => {
      if (!list || !list.length) return;
      any = true;
      wrap.appendChild(UI.el("div", { class: "inspector-family-group" }, [
        UI.el("div", { class: "inspector-family-group__label" }, label),
        UI.el("div", { class: "inspector-chiplist" }, list.map((person) => {
          const dn = FamilyStore.getField(person, "name") || person.name;
          return UI.el("button", {
            class: "inspector-chip", type: "button",
            onclick: () => show(person.id)
          }, [
            UI.avatar(person, "xs"),
            UI.el("span", null, dn),
            UI.el("span", { class: "inspector-chip__role" }, FamilyStore.formatDateRange(person))
          ]);
        }))
      ]));
    });
    if (!any) wrap.appendChild(muted(I18n.t("inspector.emptyFamily")));

    wrap.appendChild(UI.el("div", { class: "inspector-add-row" }, [
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
    const url = window.PhotoStore ? PhotoStore.getUrlSync(p) : (p.photo || null);
    if (url) {
      big.appendChild(UI.el("img", { src: url, alt: "", style: { width: "100%", height: "100%", objectFit: "cover" } }));
    } else if (window.PhotoStore && (p.photoId)) {
      const img = UI.el("img", { src: "", alt: "", style: { width: "100%", height: "100%", objectFit: "cover" } });
      big.appendChild(img);
      PhotoStore.getUrl(p).then((u) => { if (u) img.src = u; });
    } else {
      big.appendChild(UI.el("div", {
        style: {
          width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--text-3)", fontSize: "13px", textAlign: "center", padding: "24px",
          fontFamily: "var(--font-display)"
        }
      }, I18n.t("inspector.emptyPhoto")));
    }
    photoWrap.appendChild(big);
    photoWrap.appendChild(UI.el("button", {
      class: "btn btn--sm", type: "button",
      onclick: () => window.PeopleView && PeopleView.openForm && PeopleView.openForm(p.id)
    }, [UI.el("i", { class: "fa-regular fa-pen-to-square" }), UI.el("span", null, I18n.t("inspector.editPhoto"))]));
    return photoWrap;
  }

  // === Contact block ===
  // Render phone / email / address rows; each shows a "private" badge when
  // its privacy flag is on. Tapping any row launches the OS-native handler
  // (tel:, mailto:, geo: / maps: depending on platform).
  function buildContactBlock(p) {
    const c = p.contact || {};
    const wrap = UI.el("div", { class: "contact-block" });
    function row(field, value, isPrivate, icon, hrefBuilder, label) {
      if (!value) return;
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
        isPrivate ? UI.el("span", { class: "chip chip--muted contact-row__private", title: "Hidden from exports" }, [
          UI.el("i", { class: "fa-solid fa-lock", "aria-hidden": "true" }),
          UI.el("span", null, "Private")
        ]) : null
      ]);
      wrap.appendChild(r);
    }
    row("phone", c.phone, c.privatePhone, "fa-solid fa-phone",
      (v) => "tel:" + v.replace(/\s+/g, ""), "Phone");
    row("email", c.email, c.privateEmail, "fa-solid fa-envelope",
      (v) => "mailto:" + v, "Email");
    row("address", c.address, c.privateAddress, "fa-solid fa-house",
      (v) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(v), "Address");
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
        class: "btn btn--sm", type: "button",
        style: { marginTop: "12px" },
        onclick: () => openStoryEditor(p, null)
      }, [
        UI.el("i", { class: "fa-solid fa-plus" }),
        UI.el("span", null, I18n.t("inspector.addStory"))
      ]);
      wrap.appendChild(addBtn);
    }
    render();
    // Re-render whenever the store changes (someone added/edited a story)
    const unsub = FamilyStore.subscribe(() => {
      const fresh = FamilyStore.getPerson(p.id);
      if (!fresh) { unsub && unsub(); return; }
      p = fresh;
      render();
    });
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

  function openStoryEditor(p, existing) {
    const isEdit = !!existing;
    const draft = {
      title: existing ? existing.title || "" : "",
      body: existing ? existing.body || "" : "",
      tags: existing ? (existing.tags || []).slice() : []
    };
    const titleInput = UI.el("input", {
      class: "input", type: "text", value: draft.title,
      placeholder: "A short title (optional)",
      oninput: (e) => { draft.title = e.target.value; }
    });
    const bodyInput = UI.el("textarea", {
      class: "textarea",
      style: { minHeight: "180px" },
      placeholder: "Tell the story — a memory, a journey, a moment worth keeping…",
      oninput: (e) => { draft.body = e.target.value; }
    }, draft.body);
    const tagsInput = UI.el("input", {
      class: "input", type: "text",
      value: draft.tags.join(", "),
      placeholder: "family, childhood, war, migration …",
      oninput: (e) => {
        draft.tags = String(e.target.value || "")
          .split(/[,]+/)
          .map((t) => t.trim().toLowerCase()).filter(Boolean);
      }
    });
    const body = UI.el("div", { class: "form-stack" }, [
      UI.field("Title", titleInput, "Optional — leave blank for a quick memory"),
      UI.field("Story", bodyInput, "Use multiple paragraphs if you'd like."),
      UI.field("Tags", tagsInput, "Comma-separated. Helpful for searching later.")
    ]);
    const cancelBtn = UI.el("button", { class: "btn btn--ghost", type: "button" }, "Cancel");
    const saveBtn = UI.el("button", { class: "btn btn--primary", type: "button" },
      [UI.el("i", { class: "fa-solid fa-floppy-disk" }), UI.el("span", null, isEdit ? "Save" : "Add story")]);
    const footer = [cancelBtn, saveBtn];
    if (isEdit) {
      footer.unshift(UI.el("button", {
        class: "btn btn--danger", type: "button",
        style: { marginRight: "auto" },
        onclick: async () => {
          const ok = await UI.confirm({
            title: "Delete this story?",
            message: "It can't be recovered. The rest of " + (FamilyStore.getField(p, "name") || p.name) + "'s record stays intact.",
            confirmLabel: "Delete", danger: true
          });
          if (!ok) return;
          FamilyStore.deleteStory(p.id, existing.id);
          UI.toast("Story deleted", "success");
          dlg.close();
        }
      }, "Delete"));
    }
    const dlg = UI.openModal({
      title: isEdit ? "Edit story" : "New story",
      body, footer
    });
    cancelBtn.addEventListener("click", () => dlg.close());
    saveBtn.addEventListener("click", () => {
      if (!draft.body.trim() && !draft.title.trim()) {
        UI.toast("A story needs at least a title or some text.", "danger");
        return;
      }
      if (isEdit) FamilyStore.updateStory(p.id, existing.id, draft);
      else FamilyStore.addStory(p.id, draft);
      UI.toast(isEdit ? "Story saved" : "Story added", "success");
      dlg.close();
    });
    setTimeout(() => bodyInput.focus(), 50);
  }

  function buildNotesBlock(p, currentNotes) {
    const displayName = FamilyStore.getField(p, "name") || p.name;
    // The inspector reads "displayNotes" via getField which falls back to EN
    // when the HI variant is empty. To prevent corrupting notes_hi when the
    // user types over the EN fallback in HI mode, the textarea must show the
    // *current language's* raw value (not the fallback).
    const lang = I18n.getLang();
    const rawValue = lang === "hi" ? (p.notes_hi || "") : (p.notes || "");
    const ta = UI.el("textarea", {
      class: "inspector-notes-input",
      placeholder: I18n.t("inspector.notesPlaceholder", { name: displayName })
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

  function iconAction(name, icon, label, handler) {
    return UI.el("button", {
      class: "inspector-action",
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
