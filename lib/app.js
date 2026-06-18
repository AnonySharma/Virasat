(function () {
  "use strict";

  // Register the service worker for offline support. Skipped on file:// or
  // any non-HTTP context where SW registration would just throw.
  if ("serviceWorker" in navigator
      && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((err) => {
        console.warn("Service worker registration failed:", err);
      });
    });
  }
  // Ask the browser to keep our data around even when storage runs low.
  // Without this, Safari/iOS may clear IndexedDB photos after ~7 days idle.
  // The promise resolves to a boolean — true means granted, false means
  // denied (common on iOS without a clear user gesture). Surface denial
  // once per session so the user knows their data may be evicted.
  if (navigator.storage && typeof navigator.storage.persist === "function") {
    navigator.storage.persist().then((granted) => {
      if (granted) return;
      console.warn("Storage persistence denied — data may be cleared if inactive.");
      try {
        if (!sessionStorage.getItem("virasat.persistWarned") && window.UI && UI.toast) {
          UI.toast("Heads-up: storage isn't pinned on this browser. Export regularly.", "warning");
          sessionStorage.setItem("virasat.persistWarned", "1");
        }
      } catch (_) {}
    }, (err) => {
      console.warn("Storage persistence check failed:", err);
    });
  }

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

  // Cross-tab conflict — when another tab persists while this tab had a
  // pending edit, the data-store fires this event after silently reloading
  // the other tab's state. Surface a non-blocking banner so the user knows
  // their last edit was overwritten and can act on it instead of losing
  // work without a clue.
  window.addEventListener("virasat:cross-tab-conflict", () => {
    showCrossTabBanner();
  });
  function showCrossTabBanner() {
    // De-dupe — only one banner at a time.
    if (document.querySelector(".x-tab-banner")) return;
    const banner = document.createElement("div");
    banner.className = "x-tab-banner";
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    const ico = document.createElement("i");
    ico.className = "fa-solid fa-arrows-rotate x-tab-banner__icon";
    ico.setAttribute("aria-hidden", "true");
    const msg = document.createElement("span");
    msg.className = "x-tab-banner__msg";
    msg.textContent = "Another tab updated this tree — your last edit may have been overwritten.";
    const reload = document.createElement("button");
    reload.className = "btn btn--sm";
    reload.type = "button";
    reload.textContent = "Reload";
    reload.addEventListener("click", () => location.reload());
    const dismiss = document.createElement("button");
    dismiss.className = "btn btn--sm btn--ghost x-tab-banner__close";
    dismiss.type = "button";
    dismiss.setAttribute("aria-label", "Dismiss");
    const dismissIcon = document.createElement("i");
    dismissIcon.className = "fa-solid fa-xmark";
    dismissIcon.setAttribute("aria-hidden", "true");
    dismiss.appendChild(dismissIcon);
    dismiss.addEventListener("click", () => banner.remove());
    banner.appendChild(ico);
    banner.appendChild(msg);
    banner.appendChild(reload);
    banner.appendChild(dismiss);
    document.body.appendChild(banner);
    // Auto-dismiss after 30 s — a long time for a non-blocking nag, short
    // enough that it doesn't camp on the screen forever.
    setTimeout(() => { if (banner.parentNode) banner.remove(); }, 30000);
  }

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
    function syncLangButtons() {
      document.querySelectorAll(".lang-switch__btn").forEach((b) => {
        const active = b.dataset.lang === I18n.getLang();
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-pressed", active ? "true" : "false");
      });
    }
    document.querySelectorAll(".lang-switch__btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        I18n.setLang(btn.dataset.lang);
        syncLangButtons();
      });
    });
    syncLangButtons();
  }

  // — Rail tools —
  document.getElementById("tool-add")?.addEventListener("click", () => {
    if (window.PeopleView && PeopleView.openForm) PeopleView.openForm(null);
  });
  document.getElementById("tool-edit")?.addEventListener("click", () => activate("people"));
  document.getElementById("cta-export")?.addEventListener("click", () => window.ExportImport && ExportImport.openExport());

  // Try-sample-family — gated by confirm, swaps the current tree for the
  // built-in 4-generation Sharma sample so demoers can reset → reload.
  document.getElementById("tool-sample")?.addEventListener("click", async () => {
    const hasData = FamilyStore.getPeople().length > 0;
    const ok = !hasData ? true : await UI.confirm({
      title: "Load sample family?",
      message: "This replaces your current tree with the 4-generation Sharma sample (14 people, 5 marriages, photos, stories). Export your data first if you want to keep it.",
      confirmLabel: "Replace with sample",
      danger: true
    });
    if (!ok) return;
    try {
      FamilyStore.replaceAll(FamilyStore.sampleData());
      UI.toast("Sample family loaded", "success");
    } catch (e) {
      UI.toast("Couldn't load sample: " + (e && e.message || "unknown"), "danger");
    }
  });

  // Path-finder — shortest relationship chain between two people.
  document.getElementById("tool-path")?.addEventListener("click", () => {
    if (window.PathFinder && PathFinder.open) PathFinder.open();
  });

  // Print family book — every person on their own page (one A4 each).
  document.getElementById("tool-print")?.addEventListener("click", () => {
    if (window.PrintBook && PrintBook.open) PrintBook.open();
  });

  document.getElementById("tool-reset")?.addEventListener("click", async () => {
    const ok = await UI.confirm({
      title: I18n.t("rail.resetTitle"),
      message: I18n.t("rail.resetMsg"),
      confirmLabel: I18n.t("rail.resetConfirm"),
      danger: true
    });
    if (!ok) return;
    try {
      if (window.Inspector) Inspector.clear();
      FamilyStore.clearAll();
      if (window.PhotoStore && PhotoStore.clearAll) await PhotoStore.clearAll();
      try { sessionStorage.removeItem("virasat.filter"); } catch (_) {}
      // Re-apply default filter so dim classes drop
      if (window.Filter) Filter.set("all");
      UI.toast(I18n.t("rail.resetDone"), "success");
    } catch (e) {
      UI.toast("Reset failed: " + (e && e.message || "unknown"), "danger");
    }
  });

  // — Header actions —
  document.getElementById("export-btn")?.addEventListener("click", () => window.ExportImport && ExportImport.openExport());
  document.getElementById("import-btn")?.addEventListener("click", () => window.ExportImport && ExportImport.openImport());
  document.getElementById("collect-btn")?.addEventListener("click", () => window.CollectForm && CollectForm.open());

  // — Theme toggle (light / dark) —
  // Persists to localStorage; tokens.css defines [data-theme="dark"] swatches.
  const THEME_KEY = "virasat.theme";
  function applyTheme(t) {
    if (t === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    try { localStorage.setItem(THEME_KEY, t); } catch (_) {}
    const btn = document.getElementById("theme-toggle");
    if (btn) {
      btn.classList.toggle("is-dark", t === "dark");
      btn.setAttribute("aria-pressed", t === "dark" ? "true" : "false");
    }
  }
  let savedTheme = "light";
  try { savedTheme = localStorage.getItem(THEME_KEY) || "light"; } catch (_) {}
  applyTheme(savedTheme);
  document.getElementById("theme-toggle")?.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
  });

  // — Filter (global, soft) —
  // Dim non-matching members in whichever view is active. Don't switch views.
  const FILTER_KEY = "virasat.filter";
  let currentFilter = (() => {
    try { return sessionStorage.getItem(FILTER_KEY) || "all"; } catch (_) { return "all"; }
  })();
  function applyFilter(f) {
    currentFilter = f || "all";
    try { sessionStorage.setItem(FILTER_KEY, currentFilter); } catch (_) {}
    document.querySelectorAll(".rail-item[data-filter]").forEach((x) =>
      x.classList.toggle("is-active", x.dataset.filter === currentFilter));
    if (window.PeopleView && PeopleView.setFilter) PeopleView.setFilter(currentFilter);
    if (window.TreeView && TreeView.setFilter) TreeView.setFilter(currentFilter);
    if (window.TimelineView && TimelineView.setFilter) TimelineView.setFilter(currentFilter);
  }
  window.Filter = { get: () => currentFilter, set: applyFilter };
  document.querySelectorAll(".rail-item[data-filter]").forEach((b) => {
    b.addEventListener("click", () => applyFilter(b.dataset.filter));
  });
  // Apply once on startup so views show correct opacities
  setTimeout(() => applyFilter(currentFilter), 0);

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

  // — Rail counts / stats / cards —
  function refreshRail() {
    const ppl = FamilyStore.getPeople();
    const alive = ppl.filter((p) => FamilyStore.isAlive(p));
    const dec = ppl.filter((p) => FamilyStore.isDeceased(p));
    setText("cnt-all", ppl.length);
    setText("cnt-alive", alive.length);
    setText("cnt-deceased", dec.length);
    setText("stat-members", ppl.length);
    setText("stat-generations", computeGenerations(ppl));
    // Anniversaries surface in Family Highlights (right inspector) so the
    // rail doesn't duplicate them. Maintenance counts stay in the rail
    // because they're admin / tidy-up territory, not a heritage moment.
    refreshMaintenance();
  }
  function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = String(v); }
  function computeGenerations(ppl) {
    if (!ppl.length) return 0;
    const gens = FamilyStore.buildGenerations();
    let max = 0; gens.forEach((v) => { if (v > max) max = v; });
    return max + 1;
  }

  function refreshMaintenance() {
    const block = document.getElementById("rail-maintenance-block");
    const list = document.getElementById("rail-maintenance");
    if (!block || !list || !FamilyStore.maintenanceStats) return;
    const s = FamilyStore.maintenanceStats();
    if (s.total === 0 || (s.missingBirth === 0 && s.missingPhoto === 0 && s.missingDescription === 0)) {
      block.hidden = true; return;
    }
    block.hidden = false;
    while (list.firstChild) list.removeChild(list.firstChild);
    function row(field, count, icon, label) {
      if (!count) return;
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.className = "rail-item rail-item--needs";
      btn.type = "button";
      // Build via DOM API rather than template-string-into-innerHTML so
      // we don't normalise that pattern in the codebase.
      const iconEl = document.createElement("i");
      iconEl.className = icon;
      iconEl.setAttribute("aria-hidden", "true");
      const labelEl = document.createElement("span");
      labelEl.textContent = label;
      const countEl = document.createElement("span");
      countEl.className = "rail-count";
      countEl.textContent = String(count);
      btn.appendChild(iconEl);
      btn.appendChild(labelEl);
      btn.appendChild(countEl);
      btn.addEventListener("click", () => {
        if (window.PeopleView && PeopleView.setMissingFilter) {
          PeopleView.setMissingFilter(field);
        }
        activate("people");
      });
      li.appendChild(btn);
      list.appendChild(li);
    }
    row("birth", s.missingBirth, "fa-regular fa-calendar-xmark", "Missing birth date");
    row("photo", s.missingPhoto, "fa-regular fa-image", "Missing photo");
    row("description", s.missingDescription, "fa-regular fa-pen-to-square", "Missing description");
  }

  refreshRail();
  // Re-render the rail whenever the store changes — anniversary / maintenance
  // counts must stay in sync with edits.
  FamilyStore.subscribe(() => refreshRail());

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
