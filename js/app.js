(function () {
  "use strict";

  const views = {
    tree:     { el: document.getElementById("view-tree"),     mount: window.TreeView },
    people:   { el: document.getElementById("view-people"),   mount: window.PeopleView },
    timeline: { el: document.getElementById("view-timeline"), mount: window.TimelineView }
  };
  let activeView = "tree";

  function activate(name) {
    if (!views[name]) return;
    activeView = name;
    Object.entries(views).forEach(([k, v]) => v.el.classList.toggle("is-active", k === name));
    document.querySelectorAll(".nav-btn[data-view]").forEach((b) => b.classList.toggle("is-active", b.dataset.view === name));
    document.querySelectorAll(".rail-item[data-view]").forEach((b) => b.classList.toggle("is-active", b.dataset.view === name));
    const v = views[name];
    if (v && v.mount && typeof v.mount.render === "function") v.mount.render();
    // Close mobile rail/inspector when switching
    closeMobilePanels();
  }

  // Mount each view once
  Object.entries(views).forEach(([k, v]) => {
    if (v.mount && typeof v.mount.mount === "function") {
      try { v.mount.mount(v.el); }
      catch (e) { console.error("Failed to mount", k, e); }
    }
  });

  // Re-render active view on store changes + refresh rail counts/stats
  FamilyStore.subscribe(() => {
    refreshRail();
    const v = views[activeView];
    if (v && v.mount && typeof v.mount.render === "function") v.mount.render();
  });

  // — Header & rail wiring —
  document.querySelectorAll(".nav-btn[data-view], .rail-item[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => activate(btn.dataset.view));
  });

  // — Header search → filter People view —
  const headerSearch = document.getElementById("header-search-input");
  if (headerSearch) {
    headerSearch.addEventListener("input", (e) => {
      const q = e.target.value || "";
      if (window.PeopleView && PeopleView.setSearch) PeopleView.setSearch(q);
      // Switch to people view if there's a query
      if (q.trim() && activeView !== "people") activate("people");
    });
  }

  // — Lang switcher —
  if (window.I18n) {
    I18n.applyToDOM();
    I18n.onChange(() => {
      I18n.applyToDOM();
      const v = views[activeView];
      if (v && v.mount && typeof v.mount.render === "function") v.mount.render();
    });
    document.querySelectorAll(".lang-switch__btn").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.lang === I18n.getLang());
      btn.addEventListener("click", () => {
        I18n.setLang(btn.dataset.lang);
        document.querySelectorAll(".lang-switch__btn").forEach((b) => {
          b.classList.toggle("is-active", b.dataset.lang === I18n.getLang());
        });
      });
    });
  }

  // — Rail tools —
  document.getElementById("tool-add")?.addEventListener("click", () => {
    if (window.PeopleView && PeopleView.openForm) PeopleView.openForm(null);
  });
  document.getElementById("tool-edit")?.addEventListener("click", () => activate("people"));
  document.getElementById("cta-export")?.addEventListener("click", () => window.ExportImport && ExportImport.openExport());

  // — Header actions —
  document.getElementById("export-btn")?.addEventListener("click", () => window.ExportImport && ExportImport.openExport());
  document.getElementById("import-btn")?.addEventListener("click", () => window.ExportImport && ExportImport.openImport());
  document.getElementById("collect-btn")?.addEventListener("click", () => window.CollectForm && CollectForm.open());

  // — Filter buttons —
  document.querySelectorAll(".rail-item[data-filter]").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".rail-item[data-filter]").forEach((x) => x.classList.toggle("is-active", x === b));
      const f = b.dataset.filter;
      if (window.PeopleView && PeopleView.setFilter) PeopleView.setFilter(f);
      if (activeView !== "people") activate("people");
    });
  });

  // — Once photos finish migration, force a re-render —
  if (window.PhotoStore && PhotoStore.ready) {
    PhotoStore.ready().then(() => {
      const v = views[activeView];
      if (v && v.mount && typeof v.mount.render === "function") v.mount.render();
    }).catch(() => {});
  }

  // — Mobile rail/inspector toggles via overlay —
  const overlay = document.getElementById("app-overlay");
  function closeMobilePanels() {
    document.getElementById("rail")?.classList.remove("is-open");
    document.getElementById("inspector")?.classList.remove("is-open");
    overlay?.classList.remove("is-on");
  }
  overlay?.addEventListener("click", closeMobilePanels);

  // Hamburger toggles the rail on small screens
  document.getElementById("hamburger-btn")?.addEventListener("click", () => {
    const rail = document.getElementById("rail");
    if (!rail) return;
    const opening = !rail.classList.contains("is-open");
    rail.classList.toggle("is-open", opening);
    overlay?.classList.toggle("is-on", opening);
  });

  // Inspector close button (mobile)
  document.getElementById("inspector-close")?.addEventListener("click", () => {
    if (window.Inspector) Inspector.clear();
    document.getElementById("inspector")?.classList.remove("is-open");
    overlay?.classList.remove("is-on");
  });
  // Open inspector when a person is selected (mobile)
  if (window.Inspector) {
    Inspector.onSelect((id) => {
      if (id && window.matchMedia("(max-width: 1100px)").matches) {
        document.getElementById("inspector")?.classList.add("is-open");
        overlay?.classList.add("is-on");
      }
    });
  }

  // — Rail counts / stats —
  function refreshRail() {
    const ppl = FamilyStore.getPeople();
    const alive = ppl.filter((p) => FamilyStore.isAlive(p));
    const dec = ppl.filter((p) => FamilyStore.isDeceased(p));
    setText("cnt-all", ppl.length);
    setText("cnt-alive", alive.length);
    setText("cnt-deceased", dec.length);
    setText("stat-members", ppl.length);
    setText("stat-generations", computeGenerations(ppl));
  }
  function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = String(v); }
  function computeGenerations(ppl) {
    if (!ppl.length) return 0;
    const gens = FamilyStore.buildGenerations();
    let max = 0; gens.forEach((v) => { if (v > max) max = v; });
    return max + 1;
  }
  refreshRail();

  // — First-run sample —
  if (FamilyStore.getPeople().length === 0) {
    setTimeout(() => offerSampleData(), 200);
  }
  async function offerSampleData() {
    if (!window.UI) return;
    const ok = await UI.confirm({
      title: I18n.t("welcome.title"),
      message: I18n.t("welcome.msg"),
      confirmLabel: I18n.t("welcome.btn")
    });
    if (ok) {
      FamilyStore.replaceAll(FamilyStore.sampleData());
      UI.toast(I18n.t("welcome.loaded"), "success");
    }
  }

  // — Initial view —
  const initial = (location.hash || "").replace(/^#/, "");
  if (views[initial]) activate(initial); else activate("tree");
  window.addEventListener("hashchange", () => {
    const n = (location.hash || "").replace(/^#/, "");
    if (views[n]) activate(n);
  });
})();
