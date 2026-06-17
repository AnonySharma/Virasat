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
  let activeTab = "details";
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

    // Action row
    contentEl.appendChild(UI.el("div", { class: "inspector-actions" }, [
      iconAction("comment", "fa-regular fa-comment", "Add note", () => focusNotes()),
      iconAction("share",   "fa-solid fa-share-nodes", "Share as image", async () => {
        if (!window.ImageExport) return;
        try {
          const { blob, filename } = await ImageExport.exportProfileCard(p.id);
          await ImageExport.share(blob, filename, displayName);
          UI.toast("Profile image saved", "success");
        } catch (e) { UI.toast(e.message || "Failed", "danger"); }
      }),
      iconAction("favorite","fa-regular fa-heart", "Favorite", () => UI.toast("Favorited", "success")),
      iconAction("edit",    "fa-regular fa-pen-to-square", "Edit", () =>
        window.PeopleView && PeopleView.openForm && PeopleView.openForm(p.id)
      ),
      iconAction("delete",  "fa-regular fa-trash-can", "Delete", async () => {
        const ok = await UI.confirm({
          title: "Remove " + displayName + "?",
          message: "They'll be unlinked from any parent or spouse relations. This can't be undone.",
          confirmLabel: "Remove",
          danger: true
        });
        if (ok) { FamilyStore.deletePerson(p.id); clear(); UI.toast("Removed", "success"); }
      })
    ]));

    // Tabs
    const tabs = [
      ["details", "Details"],
      ["media", "Media"],
      ["family", "Family"],
      ["notes", "Notes"]
    ];
    contentEl.appendChild(UI.el("div", { class: "inspector-tabs" },
      tabs.map(([id, label]) => UI.el("button", {
        class: "inspector-tab" + (activeTab === id ? " is-active" : ""),
        type: "button",
        onclick: () => { activeTab = id; render(); }
      }, label))
    ));

    // Tab body
    if (activeTab === "details") {
      contentEl.appendChild(buildDetailsTab(p, F, {
        displayBirthPlace, displayDeathPlace, displayDesc, displayAchievements, displayEducation
      }));
    } else if (activeTab === "media") {
      contentEl.appendChild(buildMediaTab(p));
    } else if (activeTab === "family") {
      contentEl.appendChild(buildFamilyTab(p, parents, spouses, children, siblings));
    } else {
      contentEl.appendChild(buildNotesTab(p, displayNotes));
    }

    // Meta footer
    if (p.createdAt || p.updatedAt) {
      const fmt = (s) => s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
      contentEl.appendChild(UI.el("div", { class: "inspector-meta" }, [
        UI.el("span", null, "Created · " + fmt(p.createdAt)),
        UI.el("span", null, "Updated · " + fmt(p.updatedAt))
      ]));
    }
  }

  // — Tab builders —
  function buildDetailsTab(p, F, ctx) {
    const wrap = UI.el("div", null);
    const rows = [];
    rows.push(["Full name", F("name") || p.name || "—"]);
    if (p.gender) rows.push(["Gender", { m: "Male", f: "Female", o: "Other" }[p.gender] || p.gender]);
    if (p.birthDate) rows.push(["Birth date", p.birthDate]);
    if (ctx.displayBirthPlace) rows.push(["Birth place", ctx.displayBirthPlace]);
    if (p.deathDate) rows.push(["Death date", p.deathDate]);
    if (ctx.displayDeathPlace) rows.push(["Death place", ctx.displayDeathPlace]);
    if (F("occupation")) rows.push(["Occupation", F("occupation")]);

    wrap.appendChild(UI.el("section", { class: "inspector-section" }, [
      UI.el("h3", { class: "inspector-section__title" }, "Personal information"),
      UI.el("dl", { class: "inspector-rows" },
        rows.map(([k, v]) => UI.el("div", { class: "inspector-row" }, [
          UI.el("dt", null, k),
          UI.el("dd", null, v)
        ]))
      )
    ]));

    if (ctx.displayDesc) {
      wrap.appendChild(UI.el("section", { class: "inspector-section" }, [
        UI.el("h3", { class: "inspector-section__title" }, "About"),
        UI.el("p", { style: { margin: 0, color: "var(--text)", fontSize: "13px", lineHeight: "1.6", whiteSpace: "pre-wrap" } }, ctx.displayDesc)
      ]));
    }

    if (ctx.displayAchievements && ctx.displayAchievements.length) {
      wrap.appendChild(UI.el("section", { class: "inspector-section" }, [
        UI.el("h3", { class: "inspector-section__title" }, "Achievements"),
        UI.el("ul", { class: "profile__list" },
          ctx.displayAchievements.map((a) => UI.el("li", null, a))
        )
      ]));
    }

    if (ctx.displayEducation && ctx.displayEducation.length) {
      wrap.appendChild(UI.el("section", { class: "inspector-section" }, [
        UI.el("h3", { class: "inspector-section__title" }, "Education"),
        UI.el("ul", { class: "profile__list profile__list--edu" },
          ctx.displayEducation.map((e) => UI.el("li", null, e))
        )
      ]));
    }

    return wrap;
  }

  function buildMediaTab(p) {
    const wrap = UI.el("section", { class: "inspector-section" }, [
      UI.el("h3", { class: "inspector-section__title" }, "Photo")
    ]);
    const photoWrap = UI.el("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" } });
    const big = UI.el("div", { style: { width: "100%", aspectRatio: "1/1", maxWidth: "240px", borderRadius: "var(--r-md)", overflow: "hidden", border: "1px solid var(--line)", background: "var(--surface-2)" } });
    const url = window.PhotoStore ? PhotoStore.getUrlSync(p) : (p.photo || null);
    if (url) {
      big.appendChild(UI.el("img", { src: url, alt: "", style: { width: "100%", height: "100%", objectFit: "cover" } }));
    } else if (window.PhotoStore && (p.photoId || p.photoUrl)) {
      const img = UI.el("img", { src: "", alt: "", style: { width: "100%", height: "100%", objectFit: "cover" } });
      big.appendChild(img);
      PhotoStore.getUrl(p).then((u) => { if (u) img.src = u; });
    } else {
      big.appendChild(UI.el("div", { style: { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-3)", fontSize: "13px" } }, "No photo yet"));
    }
    photoWrap.appendChild(big);
    photoWrap.appendChild(UI.el("button", {
      class: "btn",
      type: "button",
      onclick: () => window.PeopleView && PeopleView.openForm && PeopleView.openForm(p.id)
    }, [UI.el("i", { class: "fa-solid fa-pen-to-square", style: { marginRight: "4px" } }), "Edit photo"]));
    wrap.appendChild(photoWrap);
    return wrap;
  }

  function buildFamilyTab(p, parents, spouses, children, siblings) {
    const wrap = UI.el("section", { class: "inspector-section" }, [
      UI.el("h3", { class: "inspector-section__title" }, "Family")
    ]);
    const groups = [
      ["Parents", parents],
      ["Spouse", spouses],
      ["Children", children],
      ["Siblings", siblings]
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

    // Always show "Add" buttons at bottom
    wrap.appendChild(UI.el("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "16px" } }, [
      UI.el("button", {
        class: "btn btn--sm", type: "button",
        onclick: () => window.PeopleView && PeopleView.openForm && PeopleView.openForm(null, { parents: [p.id, ...(p.spouses && p.spouses.length === 1 ? [p.spouses[0]] : [])] })
      }, [UI.el("i", { class: "fa-solid fa-baby", style: { marginRight: "4px" } }), "Add child"]),
      UI.el("button", {
        class: "btn btn--sm", type: "button",
        onclick: () => window.PeopleView && PeopleView.openForm && PeopleView.openForm(null, { spouses: [p.id] })
      }, [UI.el("i", { class: "fa-solid fa-heart", style: { marginRight: "4px" } }), "Add spouse"]),
      UI.el("button", {
        class: "btn btn--sm", type: "button",
        onclick: () => window.PeopleView && PeopleView.openForm && PeopleView.openForm(null, { __addAsParentOf: p.id })
      }, [UI.el("i", { class: "fa-solid fa-user-plus", style: { marginRight: "4px" } }), "Add parent"])
    ]));

    if (!any) {
      wrap.insertBefore(UI.el("p", { class: "profile__muted" }, "No family connections yet — add a relative below."), wrap.children[1] || null);
    }
    return wrap;
  }

  function buildNotesTab(p, currentNotes) {
    const wrap = UI.el("section", { class: "inspector-section" });
    const ta = UI.el("textarea", {
      class: "inspector-notes-input",
      placeholder: "Add a note about " + (FamilyStore.getField(p, "name") || p.name) + "…"
    }, currentNotes || "");
    let timer = null;
    ta.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const lang = I18n.getLang();
        const patch = lang === "hi" ? { notes_hi: ta.value } : { notes: ta.value };
        FamilyStore.updatePerson(p.id, patch);
      }, 600);
    });
    wrap.appendChild(UI.el("h3", { class: "inspector-section__title" }, "Notes"));
    wrap.appendChild(ta);
    return wrap;
  }

  function focusNotes() {
    activeTab = "notes";
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
    if (alive) out.push(UI.el("span", { class: "chip chip--alive" }, age != null ? "Age " + age : "Living"));
    else out.push(UI.el("span", { class: "chip chip--deceased" }, age != null ? "Lived " + age + " yrs" : "Deceased"));
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
