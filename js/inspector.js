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

    // Re-render when the underlying person changes
    if (window.FamilyStore && FamilyStore.subscribe) {
      FamilyStore.subscribe(() => { if (selectedId) render(); });
    }
    if (window.I18n && I18n.onChange) I18n.onChange(() => { if (selectedId) render(); });
  }

  function show(personId) {
    if (!mounted) mount();
    selectedId = personId || null;
    if (panelEl) panelEl.classList.toggle("is-open", !!personId);
    render();
    listeners.forEach((fn) => { try { fn(selectedId); } catch (_) {} });
  }

  function clear() { show(null); }
  function getSelected() { return selectedId; }
  function onSelect(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function render() {
    if (!mounted) return;
    if (!selectedId) {
      emptyEl.hidden = false;
      contentEl.hidden = true;
      contentEl.innerHTML = "";
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
          const { blob, filename } = await ImageExport.exportProfileCard(p.id);
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
    const sec = UI.el("section", { class: "inspector-section" + (isOpen ? " is-open" : "") });
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
    if (p.birthDate) rows.push([t("born"), formatDateLong(p.birthDate) + (ctx.displayBirthPlace ? " · " + ctx.displayBirthPlace : "")]);
    else if (ctx.displayBirthPlace) rows.push([t("born"), ctx.displayBirthPlace]);
    if (p.deathDate) rows.push([t("died"), formatDateLong(p.deathDate) + (ctx.displayDeathPlace ? " · " + ctx.displayDeathPlace : "")]);
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
    } else if (window.PhotoStore && (p.photoId || p.photoUrl)) {
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
