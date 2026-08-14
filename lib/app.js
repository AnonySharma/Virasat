// @ts-check
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
          UI.toast(I18n.t("sync.persistDenied"), "warning");
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
    timeline: { el: document.getElementById("view-timeline"), mount: window.TimelineView },
    insights: { el: document.getElementById("view-insights"), mount: window.InsightsView }
  };
  let activeView = "tree";

  function activate(name) {
    if (!views[name]) return;
    activeView = name;
    Object.entries(views).forEach(([k, v]) => /** @type {HTMLElement} */ (v.el).classList.toggle("is-active", k === name));
    document.querySelectorAll(".nav-btn[data-view]").forEach((b) => b.classList.toggle("is-active", /** @type {HTMLElement} */ (b).dataset.view === name));
    document.querySelectorAll(".rail-item[data-view]").forEach((b) => b.classList.toggle("is-active", /** @type {HTMLElement} */ (b).dataset.view === name));
    const v = views[name];
    if (v && v.mount && typeof v.mount.render === "function") v.mount.render();
    // Close mobile rail/inspector when switching
    closeMobilePanels();
  }

  // View mount, store subscriptions, first-run offer, and initial routing are
  // deferred into bootApp() at the end of this file so cloud mode can gate
  // them behind sign-in. With cloud OFF (the default), bootApp() runs on the
  // next microtask and behaves exactly as the local-only app always has.

  // Cross-tab conflict — when another tab persists while this tab had a
  // pending edit, the data-store fires this event after silently reloading
  // the other tab's state. Surface a non-blocking banner so the user knows
  // their last edit was overwritten and can act on it instead of losing
  // work without a clue.
  window.addEventListener("virasat:cross-tab-conflict", (e) => {
    showCrossTabBanner(e && /** @type {CustomEvent} */ (e).detail && /** @type {CustomEvent} */ (e).detail.losing);
  });

  // "Show me where this person sits" — fired by the inspector, People cards,
  // Timeline rows, and PathFinder hops, none of which can see the local
  // activate(). Switch to the tree (which renders synchronously, so the node's
  // layout position is current) and pan/zoom to the node. Decoupled via an
  // event so those modules don't need an App handle.
  window.addEventListener("virasat:reveal-in-tree", (e) => {
    const id = e && /** @type {CustomEvent} */ (e).detail && /** @type {CustomEvent} */ (e).detail.id;
    if (!id) return;
    activate("tree");
    if (window.TreeView && TreeView.revealPerson) TreeView.revealPerson(id);
    else if (window.Inspector && Inspector.show) Inspector.show(id);
  });

  // Cloud sync state changed (saved / saving / offline) — repaint the header
  // pip. Fired by CloudStore on every transition; the handler is safe in
  // local-only mode too (refreshSyncPip just keeps the pip hidden).
  window.addEventListener("virasat:sync-state", () => { refreshSyncPip(); });
  function showCrossTabBanner(losing) {
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
    msg.textContent = I18n.t("sync.conflict");
    banner.appendChild(ico);
    banner.appendChild(msg);

    // "Save my version" — only when there's a losing snapshot to rescue and the
    // backup pipeline is present. Downloads the overwritten edit as a backup
    // JSON so last-writer-wins never means silent data loss.
    if (losing && window.ExportImport && ExportImport.downloadBackupState) {
      const save = document.createElement("button");
      save.className = "btn btn--sm";
      save.type = "button";
      save.textContent = I18n.t("sync.saveBackup");
      save.addEventListener("click", async () => {
        save.disabled = true;
        const res = await ExportImport.downloadBackupState(losing);
        if (res && res.ok) {
          UI.toast(I18n.t("sync.backupSaved"), "success");
          save.remove();
        } else if (res && res.empty) {
          UI.toast(I18n.t("sync.backupEmpty"), "warning");
          save.disabled = false;
        } else {
          UI.toast(I18n.t("sync.backupError"), "danger");
          save.disabled = false;
        }
      });
      banner.appendChild(save);
    }

    const reload = document.createElement("button");
    reload.className = "btn btn--sm btn--ghost";
    reload.type = "button";
    reload.textContent = I18n.t("sync.reload");
    reload.addEventListener("click", () => location.reload());
    const dismiss = document.createElement("button");
    dismiss.className = "btn btn--sm btn--ghost x-tab-banner__close";
    dismiss.type = "button";
    dismiss.setAttribute("aria-label", I18n.t("sync.dismiss"));
    const dismissIcon = document.createElement("i");
    dismissIcon.className = "fa-solid fa-xmark";
    dismissIcon.setAttribute("aria-hidden", "true");
    dismiss.appendChild(dismissIcon);
    dismiss.addEventListener("click", () => banner.remove());
    banner.appendChild(reload);
    banner.appendChild(dismiss);
    document.body.appendChild(banner);
    // Auto-dismiss after 30 s — a long time for a non-blocking nag, short
    // enough that it doesn't camp on the screen forever. Longer when there's a
    // backup to save, so the offer doesn't disappear before the user reacts.
    setTimeout(() => { if (banner.parentNode) banner.remove(); }, losing ? 60000 : 30000);
  }

  // — Header & rail wiring —
  document.querySelectorAll(".nav-btn[data-view], .rail-item[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => activate(/** @type {HTMLElement} */ (btn).dataset.view));
  });

  // — Header search → filter People view —
  const headerSearch = document.getElementById("header-search-input");
  const headerSearchClear = document.getElementById("header-search-clear");
  if (headerSearch) {
    // Soften the auto-switch to People. Filtering stays live (so searching
    // while already on People is instant), but the *view switch* is debounced:
    // a quick type-and-delete, or a stray keystroke while you're reading a
    // profile, no longer yanks you to People on the very first character. The
    // switch only fires once typing settles and text still remains.
    let searchSwitchTimer = null;
    headerSearch.addEventListener("input", (e) => {
      const q = /** @type {HTMLInputElement} */ (e.target).value || "";
      if (window.PeopleView && PeopleView.setSearch) PeopleView.setSearch(q);
      if (headerSearchClear) headerSearchClear.hidden = !q;
      if (searchSwitchTimer) { clearTimeout(searchSwitchTimer); searchSwitchTimer = null; }
      if (q.trim() && activeView !== "people") {
        searchSwitchTimer = setTimeout(() => {
          searchSwitchTimer = null;
          const still = (/** @type {HTMLInputElement} */ (headerSearch).value || "").trim();
          if (still && activeView !== "people") activate("people");
        }, 400);
      }
    });
    if (headerSearchClear) {
      headerSearchClear.addEventListener("click", () => {
        /** @type {HTMLInputElement} */ (headerSearch).value = "";
        headerSearchClear.hidden = true;
        if (window.PeopleView && PeopleView.setSearch) PeopleView.setSearch("");
        headerSearch.focus();
      });
    }
    // Graft the People view's search-scope toggle into the header bar too, so
    // the one desktop search bar can narrow what it searches (names / stories /
    // etc.) just like the in-view bar. Drives the same shared state + popover.
    if (window.PeopleView && PeopleView.mountHeaderScope) {
      PeopleView.mountHeaderScope(headerSearch.closest(".header-search"));
    }
  }

  // — Lang switcher —
  if (window.I18n) {
    I18n.applyToDOM();
    I18n.onChange(() => {
      I18n.applyToDOM();
      const v = views[activeView];
      if (v && v.mount && typeof v.mount.render === "function") v.mount.render();
      // The filter panel builds its labels imperatively (place/occupation
      // display strings, "{d}s" eras, "Show all (N)"), so applyToDOM can't
      // re-translate them — rebuild it on language change.
      renderFilterPanel();
      // The sync pip's label + aria are set imperatively (state-dependent), so
      // applyToDOM can't re-translate them — repaint on language change.
      refreshSyncPip();
    });
    function syncLangButtons() {
      document.querySelectorAll(".lang-switch__btn").forEach((b) => {
        const active = /** @type {HTMLElement} */ (b).dataset.lang === I18n.getLang();
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-pressed", active ? "true" : "false");
      });
    }
    document.querySelectorAll(".lang-switch__btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        I18n.setLang(/** @type {HTMLElement} */ (btn).dataset.lang);
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
  document.getElementById("tool-trees")?.addEventListener("click", () => {
    if (window.TreeList && typeof TreeList.open === "function") TreeList.open();
  });
  document.getElementById("cta-export")?.addEventListener("click", () => window.ExportImport && ExportImport.openExport());

  // Try-sample-family — gated by confirm, swaps the current tree for the
  // built-in 4-generation Sharma sample so demoers can reset → reload.
  document.getElementById("tool-sample")?.addEventListener("click", async () => {
    const hasData = FamilyStore.getPeople().length > 0;
    const ok = !hasData ? true : await UI.confirm({
      title: I18n.t("rail.sampleTitle"),
      message: I18n.t("rail.sampleMsg"),
      confirmLabel: I18n.t("rail.sampleConfirm"),
      danger: true
    });
    if (!ok) return;
    try {
      if (!window.SampleData) throw new Error(I18n.t("rail.sampleNotLoaded"));
      FamilyStore.replaceAll(SampleData.build());
      UI.toast(I18n.t("rail.sampleLoaded"), "success");
    } catch (e) {
      UI.toast(I18n.t("rail.sampleError", { msg: (e && e.message) || "unknown" }), "danger");
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

  // Help — a "how this app works" guide listing every feature + how to use it.
  document.getElementById("tool-help")?.addEventListener("click", () => {
    if (window.HelpGuide && HelpGuide.open) HelpGuide.open();
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
      // Re-apply default filter so dim classes drop and the panel resets.
      if (window.Filter) Filter.clear();
      UI.toast(I18n.t("rail.resetDone"), "success");
    } catch (e) {
      try { console.warn("[Virasat] reset failed:", e); } catch (_) {}
      UI.toast(I18n.t("rail.resetFailed"), "danger");
    }
  });

  // — Header actions —
  // Collect / Import / Export used to be three separate header buttons; they're
  // now folded into one "Data ▾" overflow so Share is the lone primary. The
  // menu reuses the .kebab-menu popover styling + the account-menu dismiss
  // idiom (click-away / Escape / pick-a-row).
  document.getElementById("data-btn")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const existing = document.querySelector(".data-menu");
    if (existing) { closeDataMenu(); return; }
    openDataMenu(/** @type {HTMLElement} */ (ev.currentTarget));
  });
  function closeDataMenu(restoreFocus) {
    const menu = document.querySelector(".data-menu");
    if (menu) menu.remove();
    const btn = document.getElementById("data-btn");
    if (btn) {
      btn.setAttribute("aria-expanded", "false");
      if (restoreFocus) btn.focus();
    }
  }
  function openDataMenu(anchor) {
    const menu = document.createElement("div");
    menu.className = "kebab-menu data-menu";
    menu.setAttribute("role", "menu");
    function row(icon, label, onClick) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "kebab-menu__item";
      item.setAttribute("role", "menuitem");
      const ic = document.createElement("i");
      ic.className = icon + " kebab-menu__icon";
      ic.setAttribute("aria-hidden", "true");
      const lab = document.createElement("span");
      lab.textContent = label;
      item.appendChild(ic);
      item.appendChild(lab);
      item.addEventListener("click", () => { closeDataMenu(); onClick(); });
      return item;
    }
    // Collect + Import mutate the tree, so they're viewer-hidden (the store
    // guard would no-op them anyway). Export is read-only and always shown, so
    // a viewer still sees a useful one-item menu rather than an empty popover.
    const canEdit = !(window.FamilyStore && FamilyStore.isReadOnly && FamilyStore.isReadOnly());
    if (canEdit) {
      menu.appendChild(row("fa-solid fa-clipboard", I18n.t("actions.collectVia"),
        () => window.CollectForm && CollectForm.open()));
      menu.appendChild(row("fa-solid fa-file-import", I18n.t("actions.import"),
        () => window.ExportImport && ExportImport.openImport()));
    }
    menu.appendChild(row("fa-solid fa-file-export", I18n.t("actions.export"),
      () => window.ExportImport && ExportImport.openExport()));
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.top = (r.bottom + 4) + "px";
    menu.style.right = (window.innerWidth - r.right) + "px";
    anchor.setAttribute("aria-expanded", "true");
    setTimeout(() => {
      const teardown = () => {
        document.removeEventListener("click", onAway);
        document.removeEventListener("keydown", onEsc);
      };
      const onAway = (e) => {
        if (!menu.contains(e.target) && e.target !== anchor) { teardown(); closeDataMenu(); }
      };
      const onEsc = (e) => {
        if (e.key === "Escape") { teardown(); closeDataMenu(true); }
      };
      document.addEventListener("click", onAway);
      document.addEventListener("keydown", onEsc);
      const first = /** @type {HTMLElement|null} */ (menu.querySelector(".kebab-menu__item"));
      if (first) first.focus();
    }, 0);
  }
  document.getElementById("share-btn")?.addEventListener("click", shareActiveTree);

  // Open the invite dialog for the active cloud tree. Owner-gated at the call
  // sites (the button/kebab row only appear for owners), but guard here too.
  function shareActiveTree() {
    if (!window.Sharing || typeof Sharing.open !== "function") return;
    if (!window.CloudStore || !CloudStore.isOwner || !CloudStore.isOwner()) return;
    const id = CloudStore.activeTreeId && CloudStore.activeTreeId();
    if (!id) return;
    const title = (window.FamilyStore && FamilyStore.getFamilyTitle && FamilyStore.getFamilyTitle()) || "";
    Sharing.open(id, title);
  }
  // Reveal the header Share button only for the owner of a live cloud tree.
  function refreshShareButton() {
    const btn = document.getElementById("share-btn");
    if (!btn) return;
    const canShare = !!(window.CloudStore && CloudStore.isActive && CloudStore.isActive()
      && CloudStore.isOwner && CloudStore.isOwner()
      && CloudStore.activeTreeId && CloudStore.activeTreeId());
    btn.hidden = !canShare;
  }
  // Sync pip — a small "Saved / Saving… / Offline" chip driven off
  // CloudStore.syncState(). Shown only in a live cloud session (local-only
  // mode has no cloud to sync to); repainted on each virasat:sync-state event
  // and on language change. Reads existing state — no new network.
  function refreshSyncPip() {
    const pip = document.getElementById("sync-pip");
    if (!pip) return;
    const inCloud = !!(window.CloudStore && CloudStore.isActive && CloudStore.isActive()
      && CloudStore.activeTreeId && CloudStore.activeTreeId());
    if (!inCloud) { pip.hidden = true; return; }
    const state = (CloudStore.syncState && CloudStore.syncState()) || "synced";
    const label = document.getElementById("sync-pip-label");
    const map = { synced: "stSynced", pending: "stPending", offline: "stOffline" };
    const ariaMap = { synced: "stSyncedAria", pending: "stPendingAria", offline: "stOfflineAria" };
    const key = map[state] || "stSynced";
    if (label) label.textContent = I18n.t("sync." + key);
    pip.setAttribute("aria-label", I18n.t("sync." + (ariaMap[state] || "stSyncedAria")));
    pip.setAttribute("data-state", state);
    pip.hidden = false;
  }

  // Reveal the "Your trees" rail block only in cloud mode — a persistent,
  // labelled home for multi-tree switching that doesn't hide behind the
  // account avatar. Local single-device builds never show a dead entry.
  function refreshTreesRail() {
    const block = document.getElementById("rail-trees-block");
    if (!block) return;
    const inCloud = !!(window.CloudStore && CloudStore.isActive && CloudStore.isActive()
      && window.TreeList && typeof TreeList.open === "function");
    block.hidden = !inCloud;
  }
  // The rail "Preserve your legacy" CTA pitches local-device storage + opens
  // Export. For a signed-in cloud user that's wrong twice over: their data IS
  // synced/backed up, and Export is a manual download, not the primary safety
  // net. In cloud mode, swap the body + button copy to reflect "synced" and
  // reframe Export as an optional extra backup. Restore the data-i18n bindings
  // in local mode so I18n owns them again on language change (like
  // refreshShellTitle). Export stays the click target either way.
  function refreshLegacyCta() {
    const body = document.getElementById("cta-body");
    const btn = document.getElementById("cta-export");
    const inCloud = !!(window.CloudStore && CloudStore.isActive && CloudStore.isActive());
    if (body) {
      const key = inCloud ? "rail.legacyBodyCloud" : "rail.legacyBody";
      body.setAttribute("data-i18n", key);
      body.textContent = I18n.t(key);
    }
    if (btn) {
      const key = inCloud ? "rail.legacyCtaCloud" : "rail.legacyCta";
      btn.setAttribute("data-i18n", key);
      btn.textContent = I18n.t(key);
    }
  }
  // In cloud mode, replace the static tagline in the header with the active
  // tree's title, so a user with several trees always sees which one they're
  // in. Falls back to the tagline (via data-i18n) in local mode — where there's
  // only ever one tree, so naming it adds nothing. I18n.applyTo re-seeds the
  // data-i18n text on language change; we override it again here on store change.
  function refreshShellTitle() {
    const sub = document.getElementById("app-subtitle");
    if (!sub) return;
    const inCloud = !!(window.CloudStore && CloudStore.isActive && CloudStore.isActive()
      && CloudStore.activeTreeId && CloudStore.activeTreeId());
    if (inCloud && window.FamilyStore && FamilyStore.getFamilyTitle) {
      const title = String(FamilyStore.getFamilyTitle() || "").trim();
      if (title) { sub.textContent = title; sub.removeAttribute("data-i18n"); return; }
    }
    // Local mode (or no title): restore the tagline binding so i18n owns it.
    sub.setAttribute("data-i18n", "app.tagline");
    sub.textContent = I18n.t("app.tagline");
  }

  // — Phone overflow menu —
  // The desktop header row holds theme / lang / Collect / Import / Export.
  // On phone (≤ 768 px) all of those collapse into a kebab-anchored
  // popover so the header can fit on a 360 px viewport without overflow.
  // The kebab button itself is hidden via CSS ≥ 769 px so this listener
  // is harmless on desktop.
  document.getElementById("kebab-btn")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const existing = document.querySelector(".kebab-menu");
    if (existing) { closeKebabMenu(); return; }
    openKebabMenu(ev.currentTarget);
  });
  // Shared teardown so aria-expanded + focus restore happen on EVERY close
  // route (re-tap the kebab, click-away, Escape, or picking an item).
  function closeKebabMenu(restoreFocus) {
    const menu = document.querySelector(".kebab-menu");
    if (menu) menu.remove();
    const btn = document.getElementById("kebab-btn");
    if (btn) {
      btn.setAttribute("aria-expanded", "false");
      if (restoreFocus) btn.focus();
    }
  }
  function openKebabMenu(anchor) {
    const menu = document.createElement("div");
    menu.className = "kebab-menu";
    menu.setAttribute("role", "menu");
    function row(icon, label, onClick) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "kebab-menu__item";
      item.setAttribute("role", "menuitem");
      const ic = document.createElement("i");
      ic.className = icon + " kebab-menu__icon";
      ic.setAttribute("aria-hidden", "true");
      const lab = document.createElement("span");
      lab.textContent = label;
      item.appendChild(ic);
      item.appendChild(lab);
      item.addEventListener("click", () => { closeKebabMenu(); onClick(); });
      return item;
    }
    function divider() {
      const d = document.createElement("div");
      d.className = "kebab-menu__divider";
      return d;
    }
    // — Primary actions first — the header's Add-person and search both vanish
    //   on phone, so the kebab is the ONLY path to them here.
    const canEditTop = !(window.FamilyStore && FamilyStore.isReadOnly && FamilyStore.isReadOnly());
    if (canEditTop) {
      menu.appendChild(row("fa-solid fa-user-plus", I18n.t("actions.add"),
        () => { if (window.PeopleView && PeopleView.openForm) PeopleView.openForm(null); }));
    }
    // Search people — the header search is hidden on phone, so route here:
    // switch to People (which shows its own searchbar) and focus it.
    menu.appendChild(row("fa-solid fa-magnifying-glass", I18n.t("actions.searchPeople"), () => {
      activate("people");
      setTimeout(() => {
        const input = document.querySelector("#view-people .searchbar input");
        if (input && typeof (/** @type {HTMLElement} */ (input).focus) === "function") {
          /** @type {HTMLElement} */ (input).focus();
        }
      }, 60);
    }));
    // Help — always available (viewers benefit too); mirrors the rail Tools row.
    menu.appendChild(row("fa-solid fa-circle-question", I18n.t("rail.help"),
      () => { if (window.HelpGuide && HelpGuide.open) HelpGuide.open(); }));
    menu.appendChild(divider());
    // Theme — text label flips with current state so the user knows what
    // the tap will produce.
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    menu.appendChild(row(
      isDark ? "fa-solid fa-sun" : "fa-solid fa-moon",
      isDark ? I18n.t("actions.lightMode") : I18n.t("actions.darkMode"),
      () => document.getElementById("theme-toggle")?.click()
    ));
    // Language — flip target. Same affordance as the desktop EN/HI pair,
    // collapsed into one menu row.
    const curLang = window.I18n ? I18n.getLang() : "en";
    menu.appendChild(row(
      "fa-solid fa-language",
      curLang === "en" ? "हिन्दी" : "English",
      () => {
        const next = curLang === "en" ? "hi" : "en";
        if (window.I18n) I18n.setLang(next);
        document.querySelectorAll(".lang-switch__btn").forEach((b) => {
          const active = /** @type {HTMLElement} */ (b).dataset.lang === next;
          b.classList.toggle("is-active", active);
          b.setAttribute("aria-pressed", active ? "true" : "false");
        });
      }
    ));
    menu.appendChild(divider());
    // Collect + Import mutate the tree, so they're hidden for viewer-role
    // shared trees (the store guard would no-op them anyway). Export is
    // read-only and always available.
    const canEdit = !(window.FamilyStore && FamilyStore.isReadOnly && FamilyStore.isReadOnly());
    if (canEdit) {
      menu.appendChild(row("fa-solid fa-clipboard", I18n.t("actions.collectVia"),
        () => window.CollectForm && CollectForm.open()));
      menu.appendChild(row("fa-solid fa-file-import", I18n.t("actions.import"),
        () => window.ExportImport && ExportImport.openImport()));
    }
    menu.appendChild(row("fa-solid fa-file-export", I18n.t("actions.export"),
      () => window.ExportImport && ExportImport.openExport()));
    // Signed-in only: show who's signed in + a sign-out row, mirroring the
    // desktop account chip so phone users aren't stranded without a logout.
    if (isSignedIn()) {
      menu.appendChild(divider());
      const who = document.createElement("div");
      who.className = "kebab-menu__meta";
      who.textContent = (I18n.t("auth.signedInAs") + " " + currentUserEmail()).trim();
      menu.appendChild(who);
      if (window.TreeList && typeof TreeList.open === "function") {
        menu.appendChild(row("fa-solid fa-folder-tree", I18n.t("tree.yourTrees"),
          () => TreeList.open()));
      }
      // Invite family — owner of a live cloud tree only, mirroring the header
      // Share button (which is hidden on phone with the rest of the actions).
      if (window.CloudStore && CloudStore.isOwner && CloudStore.isOwner()
          && CloudStore.activeTreeId && CloudStore.activeTreeId()) {
        menu.appendChild(row("fa-solid fa-user-plus", I18n.t("share.title"), shareActiveTree));
      }
      menu.appendChild(row("fa-solid fa-right-from-bracket", I18n.t("auth.signOut"), signOutFlow));
    }
    document.body.appendChild(menu);
    // Position under the kebab — flush right on phone.
    const r = anchor.getBoundingClientRect();
    menu.style.top = (r.bottom + 4) + "px";
    menu.style.right = (window.innerWidth - r.right) + "px";
    anchor.setAttribute("aria-expanded", "true");

    // Keyboard: roving focus across the menuitems. Arrow keys move, Home/End
    // jump, Escape closes and returns focus to the kebab. The click-away and
    // Escape both funnel through closeKebabMenu so aria-expanded resets.
    const items = () => /** @type {HTMLElement[]} */ (Array.from(menu.querySelectorAll(".kebab-menu__item")));
    menu.addEventListener("keydown", (e) => {
      const list = items();
      if (!list.length) return;
      const idx = list.indexOf(/** @type {HTMLElement} */ (document.activeElement));
      if (e.key === "ArrowDown") { e.preventDefault(); list[(idx + 1 + list.length) % list.length].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); list[(idx - 1 + list.length) % list.length].focus(); }
      else if (e.key === "Home") { e.preventDefault(); list[0].focus(); }
      else if (e.key === "End") { e.preventDefault(); list[list.length - 1].focus(); }
    });

    // Move focus to the first item so keyboard users land inside the menu.
    setTimeout(() => { const first = /** @type {HTMLElement|null} */ (menu.querySelector(".kebab-menu__item")); if (first) first.focus(); }, 0);

    // Click-outside / Escape closes the menu.
    setTimeout(() => {
      const teardown = () => {
        document.removeEventListener("click", onAway);
        document.removeEventListener("keydown", onEsc);
      };
      const onAway = (e) => {
        if (!menu.contains(e.target) && e.target !== anchor) { teardown(); closeKebabMenu(); }
      };
      const onEsc = (e) => {
        if (e.key === "Escape") { teardown(); closeKebabMenu(true); }
      };
      document.addEventListener("click", onAway);
      document.addEventListener("keydown", onEsc);
    }, 0);
  }

  // — Account menu (cloud only) —
  // Only meaningful when signed into a live cloud session; in local-only mode
  // there's no account, so none of this renders. Shows who's signed in and a
  // sign-out affordance the user was previously missing after login.
  function isSignedIn() {
    return !!(window.Auth && Auth.isCloud && Auth.isCloud() && Auth.getUser && Auth.getUser());
  }
  function currentUserEmail() {
    const u = window.Auth && Auth.getUser && Auth.getUser();
    return (u && u.email) || "";
  }
  // Shared by the desktop chip and the phone kebab. Confirms, flushes any
  // pending cloud push so the last edit isn't lost, signs out, then reloads —
  // a full reload is the clean way back to the sign-in gate (drops in-memory
  // state, re-runs the boot gate).
  async function signOutFlow() {
    const ok = await UI.confirm({
      title: I18n.t("auth.signOut"),
      message: I18n.t("auth.signOutConfirm"),
      confirmLabel: I18n.t("auth.signOut")
    });
    if (!ok) return;
    try { if (window.CloudStore && CloudStore.flush) await CloudStore.flush(); } catch (_) {}
    try {
      if (window.CloudStore && CloudStore.stop) CloudStore.stop();
      if (window.Auth && Auth.signOut) await Auth.signOut();
    } catch (e) {
      try { console.warn("[Virasat] sign-out failed:", e); } catch (_) {}
      UI.toast(I18n.t("auth.signOutFailed"), "danger");
      return;
    }
    location.reload();
  }

  // Inject the desktop account chip into the header action row. A button
  // showing the email's initials that opens a small popover (email + sign
  // out), reusing the kebab-menu popover styles + click-away/Escape idiom.
  function setupAccountMenu() {
    if (!isSignedIn()) return;
    const actions = document.querySelector(".app-header__actions");
    if (!actions || document.getElementById("account-btn")) return;
    const btn = document.createElement("button");
    btn.className = "btn btn--ghost btn--icon account-btn";
    btn.id = "account-btn";
    btn.type = "button";
    btn.setAttribute("aria-label", I18n.t("auth.account"));
    btn.setAttribute("aria-haspopup", "menu");
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const existing = document.querySelector(".account-menu");
      if (existing) { existing.remove(); return; }
      openAccountMenu(btn);
    });
    actions.appendChild(btn);
    paintAccountButton();
  }

  // (Re)render the account chip's avatar + tooltip from the current identity.
  // Split out so the profile editor can refresh it in place after a name
  // change without a reload. Initials come from the display name when we have
  // one (friendlier than an email's first letter), else the email.
  function paintAccountButton() {
    const btn = document.getElementById("account-btn");
    if (!btn) return;
    const email = currentUserEmail();
    const name = (window.Auth && Auth.getFirstName && Auth.getFirstName()) || "";
    btn.setAttribute("title", name ? name + " · " + email : (email || I18n.t("auth.account")));
    btn.textContent = "";
    btn.appendChild(UI.avatar({ name: name || email || "?" }, "sm"));
  }

  function openAccountMenu(anchor) {
    const menu = document.createElement("div");
    menu.className = "kebab-menu account-menu";
    menu.setAttribute("role", "menu");
    const meta = document.createElement("div");
    meta.className = "kebab-menu__meta";
    // Greet by first name when we have one; the label line then reads
    // "Signed in as" over the email beneath.
    const firstName = (window.Auth && Auth.getFirstName && Auth.getFirstName()) || "";
    if (firstName) {
      const hi = document.createElement("div");
      hi.className = "kebab-menu__meta-greeting";
      hi.textContent = I18n.t("auth.greeting", { name: firstName });
      meta.appendChild(hi);
    }
    const who = document.createElement("div");
    who.className = "kebab-menu__meta-label";
    who.textContent = I18n.t("auth.signedInAs");
    const mail = document.createElement("div");
    mail.className = "kebab-menu__meta-email";
    mail.textContent = currentUserEmail();
    meta.appendChild(who);
    meta.appendChild(mail);
    menu.appendChild(meta);
    const div = document.createElement("div");
    div.className = "kebab-menu__divider";
    menu.appendChild(div);
    // Edit profile — update the display name that drives the greeting + avatar.
    {
      const ep = document.createElement("button");
      ep.type = "button";
      ep.className = "kebab-menu__item";
      ep.setAttribute("role", "menuitem");
      const epIco = document.createElement("i");
      epIco.className = "fa-regular fa-id-badge kebab-menu__icon";
      epIco.setAttribute("aria-hidden", "true");
      const epLab = document.createElement("span");
      epLab.textContent = I18n.t("auth.editProfile");
      ep.appendChild(epIco);
      ep.appendChild(epLab);
      ep.addEventListener("click", () => { menu.remove(); openProfileEditor(); });
      menu.appendChild(ep);
    }
    // Your trees — the multi-tree switcher. Only meaningful in cloud mode
    // (which the account menu already implies).
    if (window.TreeList && typeof TreeList.open === "function") {
      const trees = document.createElement("button");
      trees.type = "button";
      trees.className = "kebab-menu__item";
      trees.setAttribute("role", "menuitem");
      const tIco = document.createElement("i");
      tIco.className = "fa-solid fa-folder-tree kebab-menu__icon";
      tIco.setAttribute("aria-hidden", "true");
      const tLab = document.createElement("span");
      tLab.textContent = I18n.t("tree.yourTrees");
      trees.appendChild(tIco);
      trees.appendChild(tLab);
      trees.addEventListener("click", () => { menu.remove(); TreeList.open(); });
      menu.appendChild(trees);
    }
    const out = document.createElement("button");
    out.type = "button";
    out.className = "kebab-menu__item";
    out.setAttribute("role", "menuitem");
    const ico = document.createElement("i");
    ico.className = "fa-solid fa-right-from-bracket kebab-menu__icon";
    ico.setAttribute("aria-hidden", "true");
    const lab = document.createElement("span");
    lab.textContent = I18n.t("auth.signOut");
    out.appendChild(ico);
    out.appendChild(lab);
    out.addEventListener("click", () => { menu.remove(); signOutFlow(); });
    menu.appendChild(out);
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.top = (r.bottom + 4) + "px";
    menu.style.right = (window.innerWidth - r.right) + "px";
    setTimeout(() => {
      const onAway = (e) => {
        if (!menu.contains(e.target) && e.target !== anchor) {
          menu.remove();
          document.removeEventListener("click", onAway);
          document.removeEventListener("keydown", onEsc);
        }
      };
      const onEsc = (e) => {
        if (e.key === "Escape") {
          menu.remove();
          document.removeEventListener("click", onAway);
          document.removeEventListener("keydown", onEsc);
        }
      };
      document.addEventListener("click", onAway);
      document.addEventListener("keydown", onEsc);
    }, 0);
  }

  // Small modal to edit the signed-in user's own profile. Today just the
  // display first name (the greeting + account avatar read it); email is shown
  // read-only since changing it is a separate verified-email flow. Mirrors the
  // person-form's unsaved-changes discard guard via openModal's beforeClose.
  function openProfileEditor() {
    if (!(window.Auth && Auth.updateProfile)) return;
    const startName = (Auth.getFirstName && Auth.getFirstName()) || "";
    const email = currentUserEmail();

    const nameInput = UI.el("input", {
      class: "input", type: "text", autocomplete: "given-name",
      placeholder: I18n.t("auth.firstNamePlaceholder"), value: startName
    });
    const emailInput = UI.el("input", {
      class: "input", type: "email", value: email, disabled: true
    });
    const errorBox = UI.el("div", { class: "signin__error", role: "alert", hidden: true });
    const setError = (msg) => {
      if (!msg) { errorBox.hidden = true; errorBox.textContent = ""; return; }
      errorBox.hidden = false; errorBox.textContent = msg;
    };

    const body = UI.el("div", { class: "profile-edit" }, [
      errorBox,
      UI.el("label", { class: "field" }, [
        UI.el("span", { class: "field__label" }, I18n.t("auth.firstName")), nameInput
      ]),
      UI.el("label", { class: "field" }, [
        UI.el("span", { class: "field__label" }, I18n.t("auth.email")), emailInput,
        UI.el("span", { class: "field__hint" }, I18n.t("auth.emailReadonly"))
      ])
    ]);

    let saved = false;
    let discardConfirming = false;
    const dirty = () => nameInput.value.trim() !== startName.trim();

    const saveBtn = UI.el("button", { class: "btn btn--primary", type: "button" },
      [UI.el("span", null, I18n.t("actions.save"))]);
    const cancelBtn = UI.el("button", { class: "btn btn--ghost", type: "button" },
      [UI.el("span", null, I18n.t("actions.cancel"))]);

    const dlg = UI.openModal({
      title: I18n.t("auth.editProfile"),
      body,
      footer: [cancelBtn, saveBtn],
      beforeClose: () => {
        if (saved || !dirty()) return true;
        if (discardConfirming) return false;
        discardConfirming = true;
        UI.confirm({
          title: I18n.t("form.discardTitle"),
          message: I18n.t("form.discardMsg"),
          confirmLabel: I18n.t("actions.discard"),
          danger: true
        }).then((ok) => { discardConfirming = false; if (ok) dlg.close(true); });
        return false;
      }
    });

    cancelBtn.addEventListener("click", () => dlg.close());
    saveBtn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      if (!name) { setError(I18n.t("auth.errNameRequired")); nameInput.focus(); return; }
      setError("");
      saveBtn.disabled = true; cancelBtn.disabled = true;
      try {
        await Auth.updateProfile({ firstName: name });
        saved = true;
        paintAccountButton();
        dlg.close(true);
        if (UI.toast) UI.toast(I18n.t("auth.profileSaved"), "success");
      } catch (e) {
        saveBtn.disabled = false; cancelBtn.disabled = false;
        setError((e && e.message) || I18n.t("auth.errGeneric"));
      }
    });
  }

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

  // — Filter (faceted, shared predicate) —
  // The rail's Filter panel is the single home for narrowing the family by
  // status / gender / birthplace / occupation / era / needs-attention. All three
  // filterable views consult the SAME predicate, Filter.matches(person): the
  // People grid HIDES non-matches; the Tree and Timeline DIM them (a soft fade,
  // so the shape of the family is never lost). State persists for the session.
  const FILTER_KEY = "virasat.filter";
  const FILTER_DIMS = ["status", "gender", "place", "occupation", "era", "missing"];
  const FILTER_DEFAULT = { status: "all", gender: "", place: "", occupation: "", era: "", missing: "" };
  let filterState = (() => {
    try {
      const raw = sessionStorage.getItem(FILTER_KEY);
      if (!raw) return { ...FILTER_DEFAULT };
      // Back-compat: earlier builds persisted a bare status string.
      if (raw === "all" || raw === "alive" || raw === "deceased") return { ...FILTER_DEFAULT, status: raw };
      const o = JSON.parse(raw);
      return { ...FILTER_DEFAULT, ...(o && typeof o === "object" ? o : {}) };
    } catch (_) { return { ...FILTER_DEFAULT }; }
  })();
  // Which capped facet groups (place / occupation) are currently expanded.
  const filterExpanded = { place: false, occupation: false };
  function saveFilter() { try { sessionStorage.setItem(FILTER_KEY, JSON.stringify(filterState)); } catch (_) {} }

  // Language-independent canonical key for a facetable text field — index BOTH
  // scripts so a place chosen in English still matches after switching to Hindi.
  function facetKey(p, key) {
    const base = (p[key] || "").trim();
    const hi = (p[key + "_hi"] || "").trim();
    return (base || hi).toLowerCase();
  }
  function personDecade(p) {
    const y = FamilyStore.getYear ? FamilyStore.getYear(p.birthDate) : null;
    return y == null ? null : String(Math.floor(y / 10) * 10);
  }
  function personMissing(p, field) {
    switch (field) {
      case "birth": return !p.birthDate;
      case "photo": return !p.photo && !p.photoId;
      case "description": return !(p.description || "").trim();
      default: return false;
    }
  }
  // Does a person clear EVERY active dimension except the one named (so a facet's
  // own option counts reflect narrowing by the OTHER active facets — the
  // ecommerce "23 remaining if you also pick this" behaviour). exclude=null
  // applies all dimensions → the full predicate.
  function filterMatchesExcept(p, exclude, state) {
    if (!p) return false;
    const s = state || filterState;
    if (exclude !== "status") {
      if (s.status === "alive" && !FamilyStore.isAlive(p)) return false;
      if (s.status === "deceased" && !FamilyStore.isDeceased(p)) return false;
    }
    if (exclude !== "gender" && s.gender && p.gender !== s.gender) return false;
    if (exclude !== "place" && s.place && facetKey(p, "birthPlace") !== s.place) return false;
    if (exclude !== "occupation" && s.occupation && facetKey(p, "occupation") !== s.occupation) return false;
    if (exclude !== "era" && s.era && personDecade(p) !== s.era) return false;
    if (exclude !== "missing" && s.missing && !personMissing(p, s.missing)) return false;
    return true;
  }
  function filterMatches(p) { return filterMatchesExcept(p, null); }
  function filterActiveCount() {
    let n = 0;
    if (filterState.status !== "all") n++;
    if (filterState.gender) n++;
    if (filterState.place) n++;
    if (filterState.occupation) n++;
    if (filterState.era) n++;
    if (filterState.missing) n++;
    return n;
  }
  function notifyViewsOfFilter() {
    if (window.PeopleView && PeopleView.setFilter) PeopleView.setFilter();
    if (window.TreeView && TreeView.setFilter) TreeView.setFilter();
    if (window.TimelineView && TimelineView.setFilter) TimelineView.setFilter();
  }
  // The richer facets (gender / era / birthplace / occupation / needs-attention)
  // live in a "More filters" modal so the rail stays a calm Status list. When
  // that modal is open, filter mutations must repaint its body too.
  let filterModal = null;      // open modal handle { close } or null
  let filterModalBody = null;  // the body element to repaint on change
  // Staged edit: the modal mutates this draft, not the live filter, so the
  // views underneath stay put until the user commits with Apply. Null when the
  // modal is closed. Cancel/Escape/backdrop simply drops it.
  let filterDraft = null;
  let filterModalClearBtn = null;   // footer refs, kept in step with the draft
  let filterModalApplyBtn = null;
  function applyFilter(patch) {
    if (typeof patch === "string") patch = { status: patch };   // back-compat (Filter.set("all"))
    if (patch && typeof patch === "object") {
      FILTER_DIMS.forEach((k) => { if (k in patch) filterState[k] = patch[k]; });
    }
    saveFilter();
    renderFilterPanel();
    notifyViewsOfFilter();
  }
  // The modal's dispatcher — edits the draft and repaints only the modal body
  // (never the rail/views), so nothing commits until Apply.
  function applyDraft(patch) {
    if (!filterDraft) return;
    if (patch && typeof patch === "object") {
      FILTER_DIMS.forEach((k) => { if (k in patch) filterDraft[k] = patch[k]; });
    }
    if (filterModalBody) renderFilterModalBody();
  }
  window.Filter = {
    get: () => ({ ...filterState }),
    getStatus: () => filterState.status,
    set: applyFilter,
    setStatus: (s) => applyFilter({ status: s || "all" }),
    clear: () => applyFilter({ ...FILTER_DEFAULT }),
    matches: filterMatches,
    isActive: () => filterActiveCount() > 0,
    activeCount: filterActiveCount
  };

  // Build the option universe for the data-driven facets (place / occupation /
  // era / whether any gender is on file), walking ALL people so narrowing one
  // facet never empties another's list.
  function computeFilterIndex(people) {
    const placeMap = new Map();   // canonical key → display label
    const occMap = new Map();
    const decadeSet = new Set();
    let hasGender = false;
    people.forEach((p) => {
      const pk = facetKey(p, "birthPlace");
      if (pk && !placeMap.has(pk)) placeMap.set(pk, (FamilyStore.getField(p, "birthPlace") || p.birthPlace || p.birthPlace_hi || "").trim());
      const ok = facetKey(p, "occupation");
      if (ok && !occMap.has(ok)) occMap.set(ok, (FamilyStore.getField(p, "occupation") || p.occupation || p.occupation_hi || "").trim());
      const d = personDecade(p);
      if (d != null) decadeSet.add(d);
      if (p.gender) hasGender = true;
    });
    return {
      places: Array.from(placeMap, ([value, label]) => ({ value, label })),
      occupations: Array.from(occMap, ([value, label]) => ({ value, label })),
      decades: Array.from(decadeSet).sort((a, b) => Number(a) - Number(b)),
      hasGender
    };
  }

  // Render the whole faceted filter panel into the rail. Called on data change
  // (refreshRail), on language change, and after every filter mutation. Groups
  // render only when they carry options, so an all-from-one-town tree shows no
  // empty "Birthplace" group. Stale selections (a place whose last person was
  // deleted) are pruned silently — the caller re-renders the active view next.
  // Prune selections whose underlying value no longer exists (a place whose
  // last person was deleted, a gender on a now-genderless tree) so the panel
  // can't strand the family behind an invisible filter. Returns the index.
  function pruneFilterState(people, state) {
    const idx = computeFilterIndex(people);
    const s = state || filterState;
    if (s.place && !idx.places.some((o) => o.value === s.place)) s.place = "";
    if (s.occupation && !idx.occupations.some((o) => o.value === s.occupation)) s.occupation = "";
    if (s.era && !idx.decades.includes(s.era)) s.era = "";
    if (s.gender && !idx.hasGender) s.gender = "";
    // Only the committed state is persisted; a draft is pruned in memory only.
    if (!state) saveFilter();
    return idx;
  }
  const railT = (k, p) => I18n.t("rail." + k, p);
  // Count people who'd clear a hypothetical pick, in the CONTEXT of the other
  // active facets (the ecommerce "N remaining if you also pick this" behaviour).
  function filterCountFor(people, dim, test, state) {
    let n = 0;
    for (const p of people) if (filterMatchesExcept(p, dim, state) && test(p)) n++;
    return n;
  }
  // One selectable facet value. Renders as a vertical rail row (rail Status) or,
  // when opts.chip is set, as a wrapping pill-chip with the count baked inside
  // (the modal facets) — chips can't clip their count the way a grid row can.
  function filterRow(dim, value, label, count, opts) {
    opts = opts || {};
    const chip = !!opts.chip;
    // Which state drives the active look + toggle logic. The rail reads the
    // committed filterState; the modal passes its uncommitted draft so chips
    // reflect the pending edit, not the live filter.
    const state = opts.state || filterState;
    const dispatch = opts.dispatch || applyFilter;
    const active = state[dim] === value;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = chip
      ? "filter-chip" + (active ? " is-active" : "") + (opts.danger ? " filter-chip--needs" : "")
      : "rail-item rail-item--filter" + (active ? " is-active" : "") + (opts.danger ? " rail-item--needs" : "");
    btn.setAttribute("aria-pressed", active ? "true" : "false");
    if (opts.icon) {
      const i = document.createElement("i");
      i.className = opts.icon;
      i.setAttribute("aria-hidden", "true");
      if (opts.iconColor) i.style.color = opts.iconColor;
      btn.appendChild(i);
    }
    const sp = document.createElement("span");
    if (chip) sp.className = "filter-chip__label";
    sp.textContent = label;
    sp.title = label; // full value stays readable when the label is ellipsised
    btn.appendChild(sp);
    if (count != null) {
      const c = document.createElement("span");
      c.className = chip ? "filter-chip__count" : "rail-count";
      c.textContent = String(count);
      btn.appendChild(c);
    }
    btn.addEventListener("click", () => {
      // Clicking the active option clears that dimension (status → "all").
      const cur = state[dim];
      const next = cur === value ? (dim === "status" ? "all" : "") : value;
      dispatch({ [dim]: next });
    });
    return btn;
  }
  function filterGroup(title, rows, opts) {
    opts = opts || {};
    const list = rows.filter(Boolean);
    if (!list.length) return null;
    const wrap = document.createElement("div");
    wrap.className = opts.chip ? "filter-fgroup" : "rail-fgroup";
    const h = document.createElement("h4");
    h.className = opts.chip ? "filter-fgroup__title" : "rail-fgroup__title";
    h.textContent = title;
    wrap.appendChild(h);
    if (opts.chip) {
      const bag = document.createElement("div");
      bag.className = "filter-chips";
      list.forEach((r) => bag.appendChild(r));
      wrap.appendChild(bag);
    } else {
      list.forEach((r) => wrap.appendChild(r));
    }
    return wrap;
  }
  // A capped list facet (place / occupation): count each option in context,
  // drop zero-count options (unless selected), sort by frequency, and show the
  // top few behind a "Show all (N)" toggle. repaint re-renders its container.
  function filterListFacet(people, dim, field, title, options, icon, repaint, chip, ctx) {
    ctx = ctx || {};
    const state = ctx.state || filterState;
    const dispatch = ctx.dispatch || applyFilter;
    const scored = options
      .map((o) => ({ o, count: filterCountFor(people, dim, (p) => facetKey(p, field) === o.value, state) }))
      .filter((x) => x.count > 0 || state[dim] === x.o.value)
      .sort((a, b) => b.count - a.count || a.o.label.localeCompare(b.o.label));
    if (!scored.length) return null;
    const CAP = chip ? 10 : 6;
    const expanded = filterExpanded[dim];
    const shown = expanded ? scored : scored.slice(0, CAP);
    const rows = shown.map((x) => filterRow(dim, x.o.value, x.o.label, x.count, { icon, chip, state, dispatch }));
    const g = filterGroup(title, rows, { chip });
    if (g && scored.length > CAP) {
      const more = document.createElement("button");
      more.type = "button";
      more.textContent = expanded ? railT("showLess") : railT("showMore", { n: scored.length });
      more.addEventListener("click", () => { filterExpanded[dim] = !expanded; repaint(); });
      if (chip) {
        // A ghost chip that wraps inline with the value chips.
        more.className = "filter-chip filter-chip--more";
        (g.querySelector(".filter-chips") || g).appendChild(more);
      } else {
        more.className = "rail-showmore";
        g.appendChild(more);
      }
    }
    return g;
  }
  // Count of active facets that live in the "More filters" modal (everything
  // but Status) — drives the button's badge + label.
  function filterModalActiveCount(state) {
    const s = state || filterState;
    let n = 0;
    if (s.gender) n++;
    if (s.place) n++;
    if (s.occupation) n++;
    if (s.era) n++;
    if (s.missing) n++;
    return n;
  }

  // The rail keeps only the Status list + a compact "More filters (N)" button;
  // the heavier facets (gender / era / birthplace / occupation / needs) moved
  // into a modal so the rail reads calm. Called on data change (refreshRail),
  // language change, and after every filter mutation.
  function renderFilterPanel() {
    const host = document.getElementById("rail-filter-panel");
    if (!host) return;
    const people = FamilyStore.getPeople();
    pruneFilterState(people);

    while (host.firstChild) host.removeChild(host.firstChild);

    // Status — the everyday narrow, kept in the rail.
    const statusGroup = filterGroup(railT("status"), [
      filterRow("status", "all", railT("all"), filterCountFor(people, "status", () => true), { icon: "fa-solid fa-circle-dot" }),
      filterRow("status", "alive", railT("living"), filterCountFor(people, "status", (p) => FamilyStore.isAlive(p)), { icon: "fa-solid fa-leaf", iconColor: "var(--sage)" }),
      filterRow("status", "deceased", railT("deceased"), filterCountFor(people, "status", (p) => FamilyStore.isDeceased(p)), { icon: "fa-regular fa-circle" })
    ]);
    if (statusGroup) host.appendChild(statusGroup);

    // "More filters (N)" — opens the modal. The badge counts active non-status
    // facets so a narrowed-but-collapsed state is never invisible.
    const moreN = filterModalActiveCount();
    const more = document.createElement("button");
    more.type = "button";
    more.className = "rail-more-filters" + (moreN > 0 ? " has-active" : "");
    more.appendChild(Object.assign(document.createElement("i"), { className: "fa-solid fa-sliders", "aria-hidden": "true" }));
    const ms = document.createElement("span");
    ms.textContent = railT("moreFilters");
    more.appendChild(ms);
    if (moreN > 0) {
      const badge = document.createElement("span");
      badge.className = "rail-count rail-more-filters__badge";
      badge.textContent = String(moreN);
      more.appendChild(badge);
    }
    more.addEventListener("click", () => openFilterModal());
    host.appendChild(more);

    // Clear-all — shown under the button whenever anything (incl. status) is
    // narrowed, so the reset is reachable without opening the modal.
    if (filterActiveCount() > 0) {
      const clr = document.createElement("button");
      clr.type = "button";
      clr.className = "rail-clear-filters";
      clr.appendChild(Object.assign(document.createElement("i"), { className: "fa-solid fa-filter-circle-xmark" }));
      const cs = document.createElement("span");
      cs.textContent = railT("clearFilters");
      clr.appendChild(cs);
      clr.addEventListener("click", () => { filterExpanded.place = false; filterExpanded.occupation = false; applyFilter({ ...FILTER_DEFAULT }); });
      host.appendChild(clr);
    }
  }

  // Build the modal's inner facet stack (gender / era / birthplace / occupation
  // / needs-attention). Re-rendered in place on every change so counts stay
  // live and the show-more toggles work without closing the modal.
  function renderFilterModalBody() {
    const host = filterModalBody;
    if (!host || !filterDraft) return;
    const draft = filterDraft;
    const people = FamilyStore.getPeople();
    const idx = pruneFilterState(people, draft);
    while (host.firstChild) host.removeChild(host.firstChild);
    const repaint = renderFilterModalBody;
    const addGroup = (g) => { if (g) host.appendChild(g); };
    // Every chip in the modal reads + writes the draft, not the live filter.
    const ctx = { state: draft, dispatch: applyDraft };

    // Gender — only when at least one person has one on file, and only chips
    // that match somebody (or are the active pick).
    if (idx.hasGender) {
      const gv = (code) => I18n.t("form.gender" + code.toUpperCase());
      const codes = ["m", "f", "o"];
      const icons = { m: "fa-solid fa-mars", f: "fa-solid fa-venus", o: "fa-solid fa-genderless" };
      addGroup(filterGroup(railT("gender"), codes.map((code) => {
        const count = filterCountFor(people, "gender", (p) => p.gender === code, draft);
        return (count > 0 || draft.gender === code)
          ? filterRow("gender", code, gv(code), count, { icon: icons[code], chip: true, state: draft, dispatch: applyDraft })
          : null;
      }), { chip: true }));
    }

    // Era (birth decade) — drop zero-count decades unless one is the active pick.
    if (idx.decades.length) {
      addGroup(filterGroup(railT("era"), idx.decades
        .map((d) => ({ d, count: filterCountFor(people, "era", (p) => personDecade(p) === d, draft) }))
        .filter((x) => x.count > 0 || draft.era === x.d)
        .map((x) => filterRow("era", x.d, railT("eraDecade", { d: x.d }), x.count, { icon: "fa-solid fa-calendar-day", chip: true, state: draft, dispatch: applyDraft })),
      { chip: true }));
    }

    // Birthplace + Occupation (capped, frequency-sorted).
    addGroup(filterListFacet(people, "place", "birthPlace", railT("birthplace"), idx.places, "fa-solid fa-location-dot", repaint, true, ctx));
    addGroup(filterListFacet(people, "occupation", "occupation", railT("occupation"), idx.occupations, "fa-solid fa-briefcase", repaint, true, ctx));

    // Needs attention — context-aware counts, so the number shown always matches
    // what a click surfaces even when another filter is active.
    const needsDefs = [
      ["birth", "fa-regular fa-calendar-xmark", railT("needsBirth")],
      ["photo", "fa-regular fa-image", railT("needsPhoto")],
      ["description", "fa-regular fa-pen-to-square", railT("needsDescription")]
    ];
    addGroup(filterGroup(railT("maintenance"), needsDefs.map(([field, icon, label]) => {
      const count = filterCountFor(people, "missing", (p) => personMissing(p, field), draft);
      return (count > 0 || draft.missing === field)
        ? filterRow("missing", field, label, count, { icon, danger: true, chip: true, state: draft, dispatch: applyDraft })
        : null;
    }), { chip: true }));

    if (!host.firstChild) {
      const empty = document.createElement("p");
      empty.className = "filter-modal__empty";
      empty.textContent = railT("noFacets");
      host.appendChild(empty);
    }
    syncFilterModalFooter();
  }

  function openFilterModal() {
    if (!window.UI || !UI.openModal) return;
    if (filterModal) return;   // already open — don't stack a second copy
    // Seed the draft from the committed non-status facets (Status stays a rail
    // concern, so the modal neither shows nor touches it). Editing the draft
    // repaints only the modal; nothing reaches the views until Apply.
    filterDraft = { ...filterState };
    filterModalBody = document.createElement("div");
    filterModalBody.className = "filter-modal";
    renderFilterModalBody();

    let committed = false;   // Apply sets this; onClose without it = discard.
    const commit = () => {
      committed = true;
      // Commit the drafted facets onto the live filter in one shot. Status is
      // left as-is (the modal never edits it).
      applyFilter({ gender: filterDraft.gender, place: filterDraft.place,
        occupation: filterDraft.occupation, era: filterDraft.era, missing: filterDraft.missing });
      if (filterModal) filterModal.close();
    };

    // Clear resets the DRAFT only (so it's still undoable via Cancel until you
    // Apply), repainting the modal in place.
    filterModalClearBtn = UI.el("button", {
      class: "btn btn--ghost", type: "button",
      onclick: () => {
        filterExpanded.place = false; filterExpanded.occupation = false;
        FILTER_DIMS.forEach((k) => { if (k !== "status") filterDraft[k] = FILTER_DEFAULT[k]; });
        renderFilterModalBody();
      }
    }, [
      UI.el("i", { class: "fa-solid fa-filter-circle-xmark", "aria-hidden": "true" }),
      UI.el("span", null, railT("clearFilters"))
    ]);
    const cancelBtn = UI.el("button", {
      class: "btn btn--ghost", type: "button",
      onclick: () => { if (filterModal) filterModal.close(); }   // discard
    }, [UI.el("span", null, I18n.t("actions.cancel"))]);
    filterModalApplyBtn = UI.el("button", {
      class: "btn btn--primary", type: "button", onclick: commit
    }, [UI.el("span", null, railT("applyFilters"))]);

    filterModal = UI.openModal({
      title: railT("moreFilters"),
      body: filterModalBody,
      footer: [filterModalClearBtn, cancelBtn, filterModalApplyBtn],
      onEnter: commit,
      onClose: () => {
        filterModal = null; filterModalBody = null; filterDraft = null;
        filterModalClearBtn = null; filterModalApplyBtn = null;
        // Discard path (Cancel/Escape/backdrop/X): collapse any expanded facet
        // so the next open starts tidy, exactly as a committed close would.
        if (!committed) { filterExpanded.place = false; filterExpanded.occupation = false; }
      }
    });
    syncFilterModalFooter();
  }
  // Keep the footer's Clear/Apply in step with the draft: Clear is only useful
  // when something's drafted; Apply carries a live count of pending facets.
  function syncFilterModalFooter() {
    if (!filterDraft) return;
    const n = filterModalActiveCount(filterDraft);
    if (filterModalClearBtn) filterModalClearBtn.disabled = n === 0;
    if (filterModalApplyBtn) {
      const label = filterModalApplyBtn.querySelector("span");
      if (label) label.textContent = n > 0 ? railT("applyFiltersN", { n }) : railT("applyFilters");
    }
  }

  // Apply once on startup so the panel paints and views show correct state.
  setTimeout(() => applyFilter(), 0);

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
    document.getElementById("hamburger-btn")?.setAttribute("aria-expanded", "false");
  }
  overlay?.addEventListener("click", closeMobilePanels);

  // Hamburger toggles the rail on small screens
  document.getElementById("hamburger-btn")?.addEventListener("click", (ev) => {
    const rail = document.getElementById("rail");
    if (!rail) return;
    const opening = !rail.classList.contains("is-open");
    rail.classList.toggle("is-open", opening);
    overlay?.classList.toggle("is-on", opening);
    /** @type {HTMLElement} */ (ev.currentTarget).setAttribute("aria-expanded", opening ? "true" : "false");
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

  // — Mobile drawer accessibility (rail / inspector as modal dialogs) —
  // On phone/tablet the rail and inspector become overlay drawers, but they're
  // plain <aside>s toggled by class from several places (hamburger, person
  // select, lineage-focus, view switch). Give them the dialog semantics every
  // other overlay has — role=dialog + aria-modal, Escape-to-close, a Tab
  // focus-trap, focus move-in/restore — without touching each toggle site, by
  // reconciling off the live classes: a drawer is "modal" exactly while it has
  // .is-open AND the scrim (.app-overlay.is-on) is up. The scrim is raised only
  // by the mobile open paths, so desktop's persistent columns (which also carry
  // .is-open on select) never get dialog semantics.
  const DRAWER_FOCUSABLE = [
    "a[href]", "button:not([disabled])", "input:not([disabled])",
    "select:not([disabled])", "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])"
  ].join(",");
  const drawers = [
    { id: "rail", labelKey: "actions.menuDialog", ret: /** @type {HTMLElement|null} */ (null) },
    { id: "inspector", labelKey: "actions.detailsDialog", ret: /** @type {HTMLElement|null} */ (null) }
  ];
  const drawerEl = (d) => document.getElementById(d.id);
  const isDrawerModal = (el) =>
    !!(el && el.classList.contains("is-open") && overlay && overlay.classList.contains("is-on"));
  function reconcileDrawer(d) {
    const el = drawerEl(d);
    if (!el) return;
    const shouldModal = isDrawerModal(el);
    const isModal = el.getAttribute("role") === "dialog";
    if (shouldModal && !isModal) {
      // Opening: remember who to hand focus back to, then move it in. The
      // observer fires before any handler has moved focus, so activeElement is
      // still the opener (hamburger button / tapped node) — same trick as
      // openModal's previousFocus.
      d.ret = /** @type {HTMLElement|null} */ (document.activeElement);
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-modal", "true");
      el.setAttribute("aria-label", I18n.t(d.labelKey));
      if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
      setTimeout(() => {
        if (!isDrawerModal(el)) return;
        const first = /** @type {HTMLElement|null} */ (el.querySelector(DRAWER_FOCUSABLE));
        if (first && typeof first.focus === "function") first.focus();
        else if (typeof el.focus === "function") el.focus();
      }, 0);
    } else if (!shouldModal && isModal) {
      // Closing: drop dialog semantics; restore focus if it's still trapped here.
      el.removeAttribute("role");
      el.removeAttribute("aria-modal");
      el.removeAttribute("aria-label");
      const focusInside = document.activeElement && el.contains(document.activeElement);
      if (focusInside && d.ret && d.ret.isConnected && typeof d.ret.focus === "function") {
        try { d.ret.focus(); } catch (_) { /* opener may be gone */ }
      }
      d.ret = null;
    }
  }
  const reconcileDrawers = () => drawers.forEach(reconcileDrawer);
  if (typeof MutationObserver === "function" && (drawerEl(drawers[0]) || drawerEl(drawers[1]) || overlay)) {
    const mo = new MutationObserver(reconcileDrawers);
    [drawerEl(drawers[0]), drawerEl(drawers[1]), overlay].forEach((n) => {
      if (n) mo.observe(n, { attributes: true, attributeFilter: ["class"] });
    });
  }
  // Escape closes the open drawer; Tab is trapped within it. Capture phase so
  // it runs before in-drawer handlers (mirrors openModal's trap). Yields
  // entirely when an openModal dialog is stacked on top (e.g. the person form
  // opened from the inspector) so that dialog owns the keyboard.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" && e.key !== "Tab") return;
    const modalRoot = document.getElementById("modal-root");
    if (modalRoot && modalRoot.firstElementChild) return;
    const el = drawers.map(drawerEl).find((n) => isDrawerModal(n));
    if (!el) return;
    if (e.key === "Escape") { e.preventDefault(); closeMobilePanels(); return; }
    const focusables = Array.from(el.querySelectorAll(DRAWER_FOCUSABLE))
      .filter((n) => /** @type {HTMLElement} */ (n).offsetParent !== null || n === document.activeElement);
    if (!focusables.length) { e.preventDefault(); if (typeof el.focus === "function") el.focus(); return; }
    const first = /** @type {HTMLElement} */ (focusables[0]);
    const last = /** @type {HTMLElement} */ (focusables[focusables.length - 1]);
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !el.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (active === last || !el.contains(active))) { e.preventDefault(); first.focus(); }
  }, true);

  // — Rail counts / stats / cards —
  function refreshRail() {
    const ppl = FamilyStore.getPeople();
    setText("stat-members", ppl.length);
    setText("stat-generations", computeGenerations(ppl));
    // The faceted Filter panel (status / gender / place / occupation / era /
    // needs-attention) rebuilds its options + per-option counts against the
    // current data. Anniversaries surface in Family Highlights (right
    // inspector), so the rail doesn't duplicate them.
    renderFilterPanel();
  }
  function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = String(v); }
  function computeGenerations(ppl) {
    if (!ppl.length) return 0;
    const gens = FamilyStore.buildGenerations();
    let max = 0; gens.forEach((v) => { if (v > max) max = v; });
    return max + 1;
  }

  async function offerSampleData() {
    if (!window.UI) return;
    const ok = await UI.confirm({
      title: I18n.t("welcome.title"),
      message: I18n.t("welcome.msg"),
      confirmLabel: I18n.t("welcome.btn")
    });
    if (ok) {
      if (!window.SampleData) {
        UI.toast(I18n.t("rail.sampleNotLoaded"), "danger");
        return;
      }
      FamilyStore.replaceAll(SampleData.build());
      UI.toast(I18n.t("welcome.loaded"), "success");
    }
  }

  // — Boot —
  // Everything below is deferred here so cloud mode can gate it behind
  // sign-in. Mount views, wire store→render, run the first-run offer, and
  // route to the initial view. Idempotent (a stray second call is a no-op).
  let booted = false;
  function bootApp() {
    if (booted) return;
    booted = true;
    hideSplash();                 // data is in FamilyStore — reveal the shell
    // Drop the <head> anti-FOUC guard now that we're painting the real app —
    // this is the single choke point every boot path funnels through, so the
    // shell was never visible before a data-complete first paint.
    document.documentElement.classList.remove("is-booting");

    // Mount each view once.
    Object.entries(views).forEach(([k, v]) => {
      if (v.mount && typeof v.mount.mount === "function") {
        try { v.mount.mount(v.el); }
        catch (e) { console.error("Failed to mount", k, e); }
      }
    });

    // One subscription drives both the rail and the active view on every
    // store change. (Previously two subscriptions each re-ran refreshRail;
    // consolidated here — same result, half the work.)
    FamilyStore.subscribe(() => {
      refreshRail();
      const v = views[activeView];
      if (v && v.mount && typeof v.mount.render === "function") v.mount.render();
    });
    refreshRail();

    // First-run sample offer — only on a genuinely empty tree, and only in
    // local-only mode. In cloud mode an accepted offer would replaceAll →
    // push the sample (fixed ids) onto the active tree, which could be one
    // shared with the user; the plan flags that as a data-loss risk. The
    // manual "Try sample family" rail tool stays available regardless.
    const cloudTreeActive = typeof FamilyStore.getActiveTreeId === "function"
      && FamilyStore.getActiveTreeId() !== null;
    if (FamilyStore.getPeople().length === 0 && !cloudTreeActive) {
      setTimeout(() => offerSampleData(), 200);
    }

    // Initial view from the hash, then keep it in sync.
    const initial = (location.hash || "").replace(/^#/, "");
    if (views[initial]) activate(initial); else activate("tree");
    window.addEventListener("hashchange", () => {
      const n = (location.hash || "").replace(/^#/, "");
      if (views[n]) activate(n);
    });
  }

  // First-run gate: a signed-in user with no tree yet (brand-new account, or
  // one that deleted its last tree) has CloudStore.activeTreeId() === null.
  // Show the "create your first tree" screen and wait for it to produce a real
  // tree before booting. In local-only mode (no CloudStore) there's always a
  // local tree, so this resolves immediately.
  function maybeFirstRun() {
    const needs = window.CloudStore && typeof CloudStore.isActive === "function"
      && CloudStore.isActive() && CloudStore.activeTreeId() === null;
    if (!needs) return Promise.resolve();
    if (!window.FirstRun || typeof FirstRun.show !== "function") return Promise.resolve();
    hideSplash();                 // FirstRun owns the viewport now
    return FirstRun.show();
  }

  // Load the signed-in user's cloud tree into FamilyStore BEFORE bootApp(), so
  // the first paint is data-complete (no empty-then-populate flash) and the
  // first-run sample offer sees the real people count. CloudStore.start() is a
  // no-op when cloud is off. A hard load failure degrades to the local cache:
  // we still boot rather than strand the user on a blank screen — their last
  // offline snapshot is already in FamilyStore.
  // Persistent "view-only access" banner for viewers. The stylesheet hides
  // every edit affordance for body.is-viewer, but without a word of explanation
  // an invited relative just sees buttons missing and assumes it's broken. The
  // copy (share.viewerNote) has always existed in EN+HI — it just was never
  // rendered anywhere. Shown at the top of the main canvas, above all views.
  function renderViewerBanner() {
    const main = document.querySelector(".app-main");
    if (!main) return;
    const isViewer = !!(window.FamilyStore && FamilyStore.isReadOnly && FamilyStore.isReadOnly());
    const existing = document.getElementById("viewer-banner");
    if (!isViewer) { if (existing) existing.remove(); return; }
    if (existing) return;                       // already shown
    const banner = document.createElement("div");
    banner.id = "viewer-banner";
    banner.className = "viewer-banner";
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    const ico = document.createElement("i");
    ico.className = "fa-solid fa-eye viewer-banner__icon";
    ico.setAttribute("aria-hidden", "true");
    const msg = document.createElement("span");
    msg.className = "viewer-banner__msg";
    msg.textContent = I18n.t("share.viewerNote");
    banner.appendChild(ico);
    banner.appendChild(msg);
    main.insertBefore(banner, main.firstChild);
  }
  // Keep the banner + Share button + shell title in sync when the role/tree
  // changes (tree switch) without a full reboot — cloud-store toggles
  // body.is-viewer and repoints activeTreeId, so re-evaluate all on store change.
  if (window.FamilyStore && FamilyStore.subscribe) FamilyStore.subscribe(() => {
    renderViewerBanner();
    refreshShareButton();
    refreshShellTitle();
    refreshTreesRail();
    refreshLegacyCta();
    refreshSyncPip();
  });

  // — Boot splash —
  // Covers the async gap between a resolved session and the first data-complete
  // paint (the CloudStore.start() tree fetch). Without it a returning user
  // stares at a blank/flashing shell for a few seconds — worse on a cold
  // Supabase project. Reuses the .signin jali backdrop for visual continuity
  // from the sign-in screen. Idempotent show/hide.
  let splashEl = null;
  function showSplash() {
    if (splashEl || !document.body) return;
    const wrap = document.createElement("div");
    wrap.className = "signin app-splash";
    wrap.setAttribute("role", "status");
    wrap.setAttribute("aria-live", "polite");
    const inner = document.createElement("div");
    inner.className = "app-splash__inner";
    const logo = document.createElement("img");
    logo.className = "app-splash__logo"; logo.src = "assets/icon.svg"; logo.alt = "";
    logo.width = 56; logo.height = 56;
    const spin = document.createElement("i");
    spin.className = "fa-solid fa-circle-notch fa-spin app-splash__spinner";
    spin.setAttribute("aria-hidden", "true");
    const msg = document.createElement("div");
    msg.className = "app-splash__msg";
    msg.setAttribute("data-i18n", "sync.loadingTree");
    msg.textContent = window.I18n ? I18n.t("sync.loadingTree") : "Loading your tree…";
    inner.appendChild(logo); inner.appendChild(spin); inner.appendChild(msg);
    wrap.appendChild(inner);
    document.body.appendChild(wrap);
    splashEl = wrap;
  }
  function hideSplash() {
    if (splashEl && splashEl.parentNode) splashEl.parentNode.removeChild(splashEl);
    splashEl = null;
  }

  function bootWithCloud() {
    if (!window.CloudStore || typeof CloudStore.start !== "function") { bootApp(); return; }
    showSplash();
    CloudStore.start()
      .catch((err) => {
        console.warn("Cloud load failed — using local cache:", err && err.message || err);
        if (window.UI && UI.toast) UI.toast(I18n.t("sync.cloudUnreachable"), "warning");
      })
      .then(() => maybeFirstRun())
      .then(() => { setupAccountMenu(); renderViewerBanner(); refreshShareButton(); refreshShellTitle(); refreshTreesRail(); refreshLegacyCta(); refreshSyncPip(); bootApp(); });
    // Best-effort flush of any pending cloud push on tab close, so the last
    // edit isn't stranded behind the ~1.5s debounce.
    window.addEventListener("pagehide", () => { try { CloudStore.flush(); } catch (_) {} });
  }

  // Gate boot on auth. When Auth is absent (smoke harness, or auth scripts
  // failed to load) or cloud is off, boot immediately — the local-only app is
  // unchanged. When cloud is on: load the tree then boot if signed in, else
  // show the sign-in gate and load+boot once a session is established.
  if (window.Auth && typeof Auth.ready === "function") {
    Auth.ready().then((res) => {
      if (!res || !res.cloud) { bootApp(); return; }      // local-only
      if (res.session) { bootWithCloud(); return; }        // already signed in
      if (window.SignIn && typeof SignIn.show === "function") {
        SignIn.show().then(() => bootWithCloud());          // sign in, then load+boot
      } else {
        bootApp(); // no gate available — don't strand the user on a blank page
      }
    }).catch(() => bootApp());
  } else {
    bootApp();
  }
})();
