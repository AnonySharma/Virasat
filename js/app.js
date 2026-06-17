(function () {
  "use strict";

  const views = {
    people: { el: document.getElementById("view-people"), mount: window.PeopleView, mounted: false },
    tree: { el: document.getElementById("view-tree"), mount: window.TreeView, mounted: false },
    timeline: { el: document.getElementById("view-timeline"), mount: window.TimelineView, mounted: false }
  };

  let activeView = "people";

  function activate(name) {
    activeView = name;
    Object.entries(views).forEach(([k, v]) => v.el.classList.toggle("is-active", k === name));
    // Hide profile view if it exists
    const prof = document.getElementById("view-profile");
    if (prof) prof.classList.remove("is-active");
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.view === name));
    const v = views[name];
    if (v && v.mount && typeof v.mount.render === "function") v.mount.render();
  }

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => activate(btn.dataset.view));
  });

  // Mount each view once at startup
  Object.entries(views).forEach(([k, v]) => {
    if (v.mount && typeof v.mount.mount === "function") {
      try { v.mount.mount(v.el); v.mounted = true; }
      catch (e) { console.error("Failed to mount", k, e); }
    }
  });

  // Re-render active view on store changes
  FamilyStore.subscribe(() => {
    const v = views[activeView];
    if (v && v.mount && typeof v.mount.render === "function") v.mount.render();
  });

  // Apply translations to the static DOM and react to language changes
  if (window.I18n) {
    I18n.applyToDOM();
    I18n.onChange(() => {
      I18n.applyToDOM();
      // Re-render active view (subscribers in each view also do this)
      const v = views[activeView];
      if (v && v.mount && typeof v.mount.render === "function") v.mount.render();
    });
    // Wire language switcher buttons
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

  // Wire export/import/collect buttons
  const exportBtn = document.getElementById("export-btn");
  if (exportBtn) exportBtn.addEventListener("click", () => window.ExportImport && ExportImport.openExport());
  const importBtn = document.getElementById("import-btn");
  if (importBtn) importBtn.addEventListener("click", () => window.ExportImport && ExportImport.openImport());
  const collectBtn = document.getElementById("collect-btn");
  if (collectBtn) collectBtn.addEventListener("click", () => window.CollectForm && CollectForm.open());

  // Once photos finish migration, force a re-render (avatars may need to load IDB urls).
  if (window.PhotoStore && PhotoStore.ready) {
    PhotoStore.ready().then(() => {
      const v = views[activeView];
      if (v && v.mount && typeof v.mount.render === "function") v.mount.render();
    }).catch(() => {});
  }

  // First-run: offer sample data
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

  // Activate initial view (read from hash if present)
  const initial = (location.hash || "").replace(/^#/, "");
  if (views[initial]) activate(initial); else activate("people");

  window.addEventListener("hashchange", () => {
    const n = (location.hash || "").replace(/^#/, "");
    if (views[n]) activate(n);
  });
})();
