// @ts-check
(function () {
  "use strict";

  // Register the service worker for offline support. Skipped on file:// or
  // any non-HTTP context where SW registration would just throw.
  if ("serviceWorker" in navigator
      && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").then((reg) => {
        // A new worker sits in `waiting` until the user consents (sw.js no
        // longer skipWaiting()s on its own). Surface the update prompt when one
        // is already parked, and again whenever a fresh one finishes installing
        // behind the live controller. Pass `reg` so the banner can re-resolve
        // reg.waiting at click time — a second deploy can supersede the worker
        // captured here, driving it `redundant`.
        if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg, reg.waiting);
        const watchInstalling = (incoming) => {
          if (!incoming) return;
          incoming.addEventListener("statechange", () => {
            // installed + an existing controller ⇒ this is an update, not the
            // first-ever install (which shouldn't nag a brand-new visitor).
            if (incoming.state === "installed" && navigator.serviceWorker.controller) {
              showUpdateBanner(reg, incoming);
            }
          });
        };
        // A worker already mid-install when register() resolves has already
        // fired updatefound, so the listener below would miss it — watch it
        // directly too. Distinct worker instances from any later updatefound,
        // and the banner is one-at-a-time, so there's no double-prompt.
        watchInstalling(reg.installing);
        reg.addEventListener("updatefound", () => watchInstalling(reg.installing));
      }).catch((err) => {
        console.warn("Service worker registration failed:", err);
      });
      // When the freshly-activated worker takes control (after SKIP_WAITING),
      // reload once so the page runs the new code. Two guards:
      //   • hadController — on a FIRST-EVER visit the page loads with no
      //     controller, then the activate handler's clients.claim() fires
      //     controllerchange; that's initial adoption, not an update, so we
      //     must not reload (would flash the brand-new visitor's first paint).
      //   • reloadingForUpdate — clients.claim() / a double event must reload
      //     at most once.
      const hadController = !!navigator.serviceWorker.controller;
      let reloadingForUpdate = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!hadController || reloadingForUpdate) return;
        reloadingForUpdate = true;
        location.reload();
      });
    });
  }
  // Non-blocking "new version ready" strip, reusing the cross-tab banner shell.
  // Accepting messages the waiting worker to activate; controllerchange (above)
  // then reloads into the new code. Dismiss just hides it until the next visit.
  function showUpdateBanner(reg, worker) {
    if (document.querySelector(".x-tab-banner--update")) return;   // one at a time
    const banner = document.createElement("div");
    banner.className = "x-tab-banner x-tab-banner--update";
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    const ico = document.createElement("i");
    ico.className = "fa-solid fa-arrow-rotate-right x-tab-banner__icon";
    ico.setAttribute("aria-hidden", "true");
    const msg = document.createElement("span");
    msg.className = "x-tab-banner__msg";
    msg.textContent = (window.I18n ? I18n.t("sync.updateReady") : "A new version is ready.");
    const reload = document.createElement("button");
    reload.className = "btn btn--sm";
    reload.type = "button";
    reload.textContent = (window.I18n ? I18n.t("sync.reload") : "Reload");
    reload.addEventListener("click", () => {
      reload.disabled = true;
      // Re-resolve the worker to message at click time. The banner may have
      // been raised for a worker that a later deploy has since superseded
      // (driving it `redundant`) while the one-at-a-time guard suppressed a
      // banner for its replacement — messaging the stale `redundant` worker
      // would be a silent no-op, leaving this button dead. reg.waiting always
      // points at the worker actually parked and ready to take over.
      const target = (reg && reg.waiting) || worker;
      // Nothing left waiting (already activated by another tab, or the captured
      // worker went redundant with no successor): controllerchange won't fire
      // for us, so just reload into whatever's now in control.
      if (!target || target.state === "activated" || target.state === "redundant") {
        location.reload();
        return;
      }
      target.postMessage({ type: "SKIP_WAITING" });
    });
    const dismiss = document.createElement("button");
    dismiss.className = "btn btn--sm btn--ghost x-tab-banner__close";
    dismiss.type = "button";
    dismiss.setAttribute("aria-label", (window.I18n ? I18n.t("sync.dismiss") : "Dismiss"));
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
  }

  // ── Overlay routes (#help, #about) ────────────────────────────────────────
  // These hashes don't switch the main view — they open a modal on TOP of
  // whatever view is showing, but still get a real, shareable/bookmarkable URL
  // and proper Back-button behaviour. The main-view hash router (boot block)
  // hands any hash it doesn't recognise as a view to openOverlayRoute() here.
  //
  // Contract with the modal: opening pushes the overlay hash (one history
  // entry); the modal's onClose reverts the hash to the current view via
  // replaceState (no new entry, no hashchange bounce); pressing browser Back
  // pops to the view hash, which the router sees and uses to close the modal.
  // A guard flag stops these two paths from re-triggering each other.
  // Only #about remains an in-app overlay route. Help moved to a standalone
  // page (help.html, opened in a new tab) — see openHelpPage.
  const OVERLAY_ROUTES = { about: openAbout };
  let overlayHandle = null;    // { close } of the currently-open overlay modal
  let overlayName = null;      // which overlay route is open ("help" | "about")
  let syncingOverlayHash = false;

  function currentViewHash() {
    return "#" + (views[activeView] ? activeView : "tree");
  }

  // Open the modal for an overlay route. `fromHash` is true when navigation
  // (hashchange / initial load) drove this, so we must NOT push another entry;
  // a direct call (menu click) sets the hash itself first via location.hash.
  function openOverlayRoute(name, fromHash) {
    const opener = OVERLAY_ROUTES[name];
    if (!opener) return false;
    if (overlayName === name && overlayHandle) return true;   // already open
    // Switching directly from one overlay to another: drop the old first.
    if (overlayHandle) { const h = overlayHandle; overlayHandle = null; overlayName = null; h.close(); }
    if (!fromHash && location.hash !== "#" + name) location.hash = name;   // push entry
    overlayName = name;
    overlayHandle = opener({
      onClose: () => {
        // Fires for every dismiss path (button, ×, Esc, backdrop). Clear state
        // first so the hash revert below doesn't recurse back into a close.
        const wasName = overlayName;
        overlayHandle = null;
        overlayName = null;
        // If the URL still sits on this overlay (UI-driven close, not a Back
        // that already moved it), revert to the view hash without a new entry.
        if (!syncingOverlayHash && location.hash === "#" + wasName) {
          syncingOverlayHash = true;
          history.replaceState(null, "", currentViewHash());
          syncingOverlayHash = false;
        }
      }
    });
    if (!overlayHandle) { overlayName = null; return false; }
    return true;
  }

  // Close any open overlay because the hash moved off it (browser Back, or a
  // switch to a view). Guarded so the modal's own onClose doesn't re-revert.
  function closeOverlayForHashChange() {
    if (!overlayHandle) return;
    const h = overlayHandle;
    overlayHandle = null;
    overlayName = null;
    syncingOverlayHash = true;
    h.close();
    syncingOverlayHash = false;
  }

  function isOverlayRoute(name) { return Object.prototype.hasOwnProperty.call(OVERLAY_ROUTES, name); }

  // Help now lives at a standalone, shareable page (help.html) rather than an
  // in-app modal — richer content, its own URL, and it opens in a NEW TAB so the
  // tree stays put behind it. Reached from the header menu (openAccountMenu).
  //
  // NOTE: do NOT pass "noopener" in the window.open FEATURES string — with a
  // features arg the browser returns null on success (the new tab is opened
  // with no back-reference), so `if (!w)` was ALWAYS true and the same-tab
  // fallback fired too, navigating BOTH tabs. Instead open normally and sever
  // `opener` on the returned handle for the same security, and only fall back
  // to same-tab when the popup was genuinely blocked (w === null). Relative
  // href so it works under the GitHub Pages subpath.
  function openHelpPage() {
    const w = window.open("help.html", "_blank");
    if (w) { try { w.opener = null; } catch (_) {} }
    else { location.href = "help.html"; }
  }

  // #about → the "About Virasat" copy (shared i18n source with the landing
  // footer's About modal) rendered through the shared legal renderer. Works
  // in-app (no landing beneath it), so it just uses UI.openModal directly.
  function openAbout(opts) {
    if (!(window.UI && UI.openModal)) return null;
    const o = opts || {};
    const t = (k, fb) => {
      const v = (window.I18n && typeof I18n.t === "function") ? I18n.t(k) : null;
      return (v && v !== k) ? v : fb;
    };
    const bodyLines = (window.I18n && typeof I18n.t === "function") ? I18n.t("landing.aboutBody") : null;
    const lines = Array.isArray(bodyLines) ? bodyLines : [t("landing.pitch", "Virasat — your family's living archive.")];
    const proseNodes = (window.UI && UI.legalProse) ? UI.legalProse(lines) : [UI.el("p", { class: "legal__p" }, lines[0])];
    const closeBtn = UI.el("button", { class: "btn btn--primary", type: "button" },
      [UI.el("span", null, t("landing.legalClose", "Close"))]);
    const handle = UI.openModal({
      title: t("landing.aboutTitle", "About Virasat"),
      body: UI.el("div", { class: "legal" }, proseNodes),
      footer: [closeBtn],
      onClose: typeof o.onClose === "function" ? o.onClose : undefined
    });
    if (handle) closeBtn.addEventListener("click", () => handle.close());
    return handle;
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

  function activate(name, opts) {
    if (!views[name]) return;
    activeView = name;
    // Reflect the active view in the URL hash so the browser Back/forward
    // buttons traverse view history and a #people / #timeline link deep-links
    // straight in. Writing the same value is a no-op that won't fire
    // hashchange; when activate() was itself triggered BY hashchange (Back/
    // forward), the hash already matches, so this doesn't push a duplicate
    // entry. The hashchange listener skips re-activating the current view, so a
    // user-initiated switch renders exactly once.
    // `opts.silent` paints the view WITHOUT touching the hash — used when an
    // overlay route (#help/#about) needs a view rendered beneath it while the
    // URL must stay on the overlay hash.
    if (!(opts && opts.silent) && location.hash !== "#" + name) location.hash = name;
    Object.entries(views).forEach(([k, v]) => /** @type {HTMLElement} */ (v.el).classList.toggle("is-active", k === name));
    document.querySelectorAll(".nav-btn[data-view]").forEach((b) => b.classList.toggle("is-active", /** @type {HTMLElement} */ (b).dataset.view === name));
    document.querySelectorAll(".rail-item[data-view]").forEach((b) => b.classList.toggle("is-active", /** @type {HTMLElement} */ (b).dataset.view === name));
    const v = views[name];
    if (v && v.mount && typeof v.mount.render === "function") v.mount.render();
    // The lineage-focus cue only shows OFF the tree, so its visibility flips on
    // every view switch (tree ⇄ people/timeline) even when the focus itself is
    // unchanged — re-evaluate here since the focus event won't fire.
    renderLineageFocusCue();
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
  // The phone pip is a bare coloured dot (its label is screen-reader-only), so a
  // tap surfaces the same plain-language status as a toast for sighted users.
  document.getElementById("sync-pip-phone")?.addEventListener("click", () => {
    const state = (window.CloudStore && CloudStore.syncState && CloudStore.syncState()) || "synced";
    const map = { synced: "stSynced", pending: "stPending", offline: "stOffline" };
    // Only success/danger toasts are styled; "pending" falls back to the neutral
    // ink toast (no kind) rather than an unstyled variant.
    const tone = state === "offline" ? "danger" : (state === "synced" ? "success" : "");
    UI.toast(I18n.t("sync." + (map[state] || "stSynced")), tone);
  });
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
      // The "You" picker's option labels + hint are built imperatively too.
      renderSelfPicker();
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
    // Owner-only on a shared cloud tree — replacing the blob would push the
    // sample over everyone else's copy (see canReplaceWholeTree). The row is
    // also hidden for non-owners in cloud mode (refreshDestructiveTools), so
    // this guards the keyboard/programmatic path.
    if (!canReplaceWholeTree()) { UI.toast(I18n.t("rail.ownerOnlyDestructive")); return; }
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
      migrateAndBackfillPhotos();
      UI.toast(I18n.t("rail.sampleLoaded"), "success");
    } catch (e) {
      UI.toast(I18n.t("rail.sampleError", { msg: (e && e.message) || "unknown" }), "danger");
    }
  });

  // Path-finder — shortest relationship chain between two people. If someone's
  // already selected, seed them as the first person so it opens on "compare X
  // with…" rather than two empty pickers.
  document.getElementById("tool-path")?.addEventListener("click", () => {
    if (!window.PathFinder || !PathFinder.open) return;
    const sel = window.Inspector && Inspector.getSelected ? Inspector.getSelected() : null;
    PathFinder.open(sel && FamilyStore.getPerson(sel) ? sel : undefined);
  });

  // Print family book — every person on their own page (one A4 each).
  document.getElementById("tool-print")?.addEventListener("click", () => {
    if (window.PrintBook && PrintBook.open) PrintBook.open();
  });

  // Help moved out of the rail into the header menu (openAccountMenu → Help),
  // where it opens the standalone help.html page in a new tab. The old rail
  // "How this app works" row + its #help overlay route are gone.

  // About — the app's story; also its own #about URL for the same reasons.
  document.getElementById("tool-about")?.addEventListener("click", () => {
    openOverlayRoute("about", false);
  });

  document.getElementById("tool-reset")?.addEventListener("click", () => { resetEverythingFlow(); });

  // Confirm-then-wipe the whole tree. Shared by the rail Reset row (local-only
  // surface) and the account modal's Reset action (signed-in surface), so the
  // copy + clear sequence lives in one place. In cloud mode clearAll() persists
  // an empty tree, which syncs to every member — the message says so.
  async function resetEverythingFlow() {
    const inCloud = !!(window.CloudStore && CloudStore.isActive && CloudStore.isActive());
    // Owner-only on a shared cloud tree: a reset wipes the blob for every
    // member (clearAll → markDirty → LWW push). Both entry points (rail row +
    // account modal) funnel here, so one guard covers them; the UI also hides
    // them for non-owners in cloud mode (refreshDestructiveTools + account modal).
    if (!canReplaceWholeTree()) { UI.toast(I18n.t("rail.ownerOnlyDestructive")); return false; }
    const ok = await UI.confirm({
      title: I18n.t("rail.resetTitle"),
      message: I18n.t(inCloud ? "rail.resetMsgCloud" : "rail.resetMsg"),
      confirmLabel: I18n.t("rail.resetConfirm"),
      danger: true
    });
    if (!ok) return false;
    try {
      if (window.Inspector) Inspector.clear();
      FamilyStore.clearAll();
      if (window.PhotoStore && PhotoStore.clearAll) await PhotoStore.clearAll();
      try { sessionStorage.removeItem("virasat.filter"); } catch (_) {}
      // Re-apply default filter so dim classes drop and the panel resets.
      if (window.Filter) Filter.clear();
      UI.toast(I18n.t("rail.resetDone"), "success");
      return true;
    } catch (e) {
      try { console.warn("[Virasat] reset failed:", e); } catch (_) {}
      UI.toast(I18n.t("rail.resetFailed"), "danger");
      return false;
    }
  }

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
  document.getElementById("share-btn-phone")?.addEventListener("click", shareActiveTree);

  // Open the invite dialog for the active cloud tree. Owner-gated at the call
  // sites (the button/kebab row only appear for owners), but guard here too.
  function shareActiveTree() {
    if (!window.Sharing || typeof Sharing.open !== "function") return;
    if (!window.CloudStore || !CloudStore.isOwner || !CloudStore.isOwner()) return;
    const id = CloudStore.activeTreeId && CloudStore.activeTreeId();
    if (!id) return;
    const title = (window.FamilyStore && FamilyStore.getFamilyTitle && FamilyStore.getFamilyTitle()) || "";
    // Owner by construction — this entry point is gated on isOwner() above.
    Sharing.open(id, title, "owner");
  }
  // Reveal the Share buttons only for the owner of a live cloud tree. Two live
  // in the DOM — the desktop header primary (#share-btn, hidden ≤768px with the
  // rest of .app-header__actions) and the phone-only top-level twin
  // (#share-btn-phone, shown ≤768px beside the kebab) — kept in lockstep here so
  // exactly one is visible at any width and both share the owner gate.
  function refreshShareButton() {
    const btn = document.getElementById("share-btn");
    const phoneBtn = document.getElementById("share-btn-phone");
    if (!btn && !phoneBtn) return;
    const canShare = !!(window.CloudStore && CloudStore.isActive && CloudStore.isActive()
      && CloudStore.isOwner && CloudStore.isOwner()
      && CloudStore.activeTreeId && CloudStore.activeTreeId());
    if (btn) btn.hidden = !canShare;
    if (phoneBtn) phoneBtn.hidden = !canShare;
  }
  // Sync pip — a small "Saved / Saving… / Offline" chip driven off
  // CloudStore.syncState(). Shown only in a live cloud session (local-only
  // mode has no cloud to sync to); repainted on each virasat:sync-state event
  // and on language change. Reads existing state — no new network.
  function refreshSyncPip() {
    const pip = document.getElementById("sync-pip");
    const phonePip = document.getElementById("sync-pip-phone");
    if (!pip && !phonePip) return;
    const inCloud = !!(window.CloudStore && CloudStore.isActive && CloudStore.isActive()
      && CloudStore.activeTreeId && CloudStore.activeTreeId());
    if (!inCloud) {
      if (pip) pip.hidden = true;
      if (phonePip) phonePip.hidden = true;
      return;
    }
    const state = (CloudStore.syncState && CloudStore.syncState()) || "synced";
    const map = { synced: "stSynced", pending: "stPending", offline: "stOffline" };
    const ariaMap = { synced: "stSyncedAria", pending: "stPendingAria", offline: "stOfflineAria" };
    const key = map[state] || "stSynced";
    const text = I18n.t("sync." + key);
    const aria = I18n.t("sync." + (ariaMap[state] || "stSyncedAria"));
    // Both the desktop pip and its phone twin (a bare coloured dot beside the
    // kebab) repaint off the same state — one source of truth, two surfaces.
    [pip, phonePip].forEach((p, i) => {
      if (!p) return;
      const label = document.getElementById(i === 0 ? "sync-pip-label" : "sync-pip-phone-label");
      if (label) label.textContent = text;
      p.setAttribute("aria-label", aria);
      p.setAttribute("data-state", state);
      p.hidden = false;
    });
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
  // Visibility of the rail's danger cluster (divider · Try sample · Reset).
  // Three cases:
  //   • Local-only  → both rows shown (the account page that would otherwise
  //     house Reset is unreachable), divider shown.
  //   • Cloud OWNER → Reset moves into the account page (destructive belongs
  //     behind the account surface, not one slip from Add); Try sample stays,
  //     so the divider stays.
  //   • Cloud EDITOR/other → BOTH rows hidden: each replaces or wipes the whole
  //     tree, which an editor must not do to a tree they don't own (the click
  //     handlers also hard-block this — see canReplaceWholeTree — so this is the
  //     matching UI half). With nothing under it, the divider hides too.
  // Viewers never reach here: .js-edit-only already display:none's the cluster.
  function refreshDestructiveTools() {
    const signedIn = isSignedIn();
    const owner = canReplaceWholeTree();   // true in local mode or as cloud owner
    const resetRow = document.getElementById("tool-reset");
    const sampleRow = document.getElementById("tool-sample");
    const divider = document.getElementById("tools-danger-divider");
    // Reset: hidden once signed in (owner → account page; non-owner → not at all).
    if (resetRow && resetRow.parentElement) resetRow.parentElement.hidden = signedIn;
    // Sample: hidden only for a non-owner on a shared cloud tree.
    if (sampleRow && sampleRow.parentElement) sampleRow.parentElement.hidden = !owner;
    // Divider dangles if BOTH rows below it are hidden — keep it only while
    // something under it still shows.
    const anyBelow = (resetRow && !signedIn) || owner;
    if (divider) divider.hidden = !anyBelow;
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
      // Undo / redo — no keyboard shortcut on phone, so the kebab is the only
      // touch path. Shown only when actionable (a dead menu row reads as broken).
      if (window.FamilyStore && FamilyStore.canUndo && FamilyStore.canUndo()) {
        menu.appendChild(row("fa-solid fa-rotate-left", I18n.t("actions.undo"), doUndo));
      }
      if (window.FamilyStore && FamilyStore.canRedo && FamilyStore.canRedo()) {
        menu.appendChild(row("fa-solid fa-rotate-right", I18n.t("actions.redo"), doRedo));
      }
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
    // Help — always available (viewers benefit too). Opens the standalone
    // help.html page (openHelpPage), same as the account menu's Help row; the
    // old in-app "help" overlay route was removed, so openOverlayRoute("help")
    // was a dead no-op (OVERLAY_ROUTES has no "help" opener).
    menu.appendChild(row("fa-solid fa-circle-question", I18n.t("rail.help"),
      () => { openHelpPage(); }));
    // About — the app's story + a jump-off to the privacy/terms pages.
    menu.appendChild(row("fa-solid fa-seedling", I18n.t("actions.about"),
      () => { openOverlayRoute("about", false); }));
    menu.appendChild(divider());
    // Theme — text label flips with current state so the user knows what
    // the tap will produce.
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    menu.appendChild(row(
      isDark ? "fa-solid fa-sun" : "fa-solid fa-moon",
      isDark ? I18n.t("actions.lightMode") : I18n.t("actions.darkMode"),
      () => document.getElementById("theme-toggle")?.click()
    ));
    // High contrast — label flips with state, same as Theme. The header
    // contrast toggle is hidden on phone, so this is the only path here.
    const hiContrast = document.documentElement.getAttribute("data-contrast") === "high";
    menu.appendChild(row(
      "fa-solid fa-circle-half-stroke",
      hiContrast ? I18n.t("actions.contrastOff") : I18n.t("actions.contrastOn"),
      () => document.getElementById("contrast-toggle")?.click()
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
      // Account — the header account chip is hidden on phone, so this is the
      // only path to profile / change-password / reset here.
      menu.appendChild(row("fa-regular fa-id-badge", I18n.t("auth.accountSettings"),
        () => openAccountModal()));
      if (window.TreeList && typeof TreeList.open === "function") {
        menu.appendChild(row("fa-solid fa-folder-tree", I18n.t("tree.yourTrees"),
          () => TreeList.open()));
      }
      // Invite family (Share) is NOT here — it's promoted to a top-level
      // phone header button (#share-btn-phone, beside the kebab), so folding it
      // into this overflow too would just duplicate it.
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
  // May this session run a WHOLE-TREE destructive op (load-sample, reset)?
  // Local-only mode: always yes. Cloud mode: OWNER only. An editor may edit
  // individual people, but replacing or wiping the entire blob LWW-pushes the
  // clobber to every member — and RLS can't stop it (editors legitimately hold
  // UPDATE on the row), so this app-layer gate is the actual enforcement. The
  // store's readOnly guard already blocks viewers; this closes the editor hole.
  function canReplaceWholeTree() {
    if (!(window.CloudStore && CloudStore.isActive && CloudStore.isActive())) return true;
    return !!(CloudStore.isOwner && CloudStore.isOwner());
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

  // Inject the header menu button into the action row. ALWAYS present — it's the
  // home for the appearance (theme + contrast) toggles and the Help link in both
  // modes, plus the account rows (greeting / Account / Your trees / Sign out)
  // when signed into a cloud session. Signed in → the identity avatar; offline
  // (local-only) → a neutral person icon (fa-circle-user), since there's no
  // account to represent. Opens a small popover reusing the kebab-menu styles +
  // click-away/Escape idiom.
  function setupAccountMenu() {
    const actions = document.querySelector(".app-header__actions");
    if (!actions || document.getElementById("account-btn")) return;
    // Signal that this menu exists: CSS then hides the standalone header
    // appearance toggles ([data-appearance-toggle]) because Theme +
    // High-contrast now live inside the menu — in BOTH modes (offline included),
    // so the header stays decluttered and the toggles have exactly one home.
    actions.classList.add("has-account-menu");
    const btn = document.createElement("button");
    btn.className = "btn btn--ghost btn--icon account-btn";
    btn.id = "account-btn";
    btn.type = "button";
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

  // (Re)render the menu button's face + tooltip from the current identity.
  // Split out so the profile editor can refresh it in place after a name
  // change without a reload. Signed in → an avatar with initials + name/email
  // tooltip; offline → a neutral person glyph labelled "Menu", since there's no
  // identity to show.
  function paintAccountButton() {
    const btn = document.getElementById("account-btn");
    if (!btn) return;
    btn.textContent = "";
    if (!isSignedIn()) {
      btn.setAttribute("aria-label", I18n.t("auth.menu"));
      btn.setAttribute("title", I18n.t("auth.menu"));
      const ic = document.createElement("i");
      ic.className = "fa-solid fa-circle-user";
      ic.setAttribute("aria-hidden", "true");
      btn.appendChild(ic);
      return;
    }
    btn.setAttribute("aria-label", I18n.t("auth.account"));
    const email = currentUserEmail();
    const name = (window.Auth && Auth.getFirstName && Auth.getFirstName()) || "";
    btn.setAttribute("title", name ? name + " · " + email : (email || I18n.t("auth.account")));
    btn.appendChild(UI.avatar({ name: name || email || "?" }, "sm"));
  }

  function openAccountMenu(anchor) {
    const menu = document.createElement("div");
    menu.className = "kebab-menu account-menu";
    menu.setAttribute("role", "menu");
    const signedIn = isSignedIn();
    // Identity header + account rows only exist in a live cloud session. Offline
    // (local-only) there's no account, so the menu opens straight to the shared
    // rows (Help + appearance) with no greeting or email.
    if (signedIn) {
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
      // Account — profile name, change password, and reset-everything, all on one
      // page (was "Edit profile", name-only; broadened for #115).
      {
        const ep = document.createElement("button");
        ep.type = "button";
        ep.className = "kebab-menu__item";
        ep.setAttribute("role", "menuitem");
        const epIco = document.createElement("i");
        epIco.className = "fa-regular fa-id-badge kebab-menu__icon";
        epIco.setAttribute("aria-hidden", "true");
        const epLab = document.createElement("span");
        epLab.textContent = I18n.t("auth.accountSettings");
        ep.appendChild(epIco);
        ep.appendChild(epLab);
        ep.addEventListener("click", () => { menu.remove(); openAccountModal(); });
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
    }
    // Help — the full "how this app works" guide, now a standalone page opened
    // in a new tab (keeps the tree in place behind it). Available to everyone,
    // signed in or not — this is why the menu is always present. In a cloud
    // session it sits under a divider after the account rows; offline it's the
    // first row.
    {
      if (signedIn) {
        const hDiv = document.createElement("div");
        hDiv.className = "kebab-menu__divider";
        menu.appendChild(hDiv);
      }
      const help = document.createElement("button");
      help.type = "button";
      help.className = "kebab-menu__item";
      help.setAttribute("role", "menuitem");
      const hIco = document.createElement("i");
      hIco.className = "fa-solid fa-circle-question kebab-menu__icon";
      hIco.setAttribute("aria-hidden", "true");
      const hLab = document.createElement("span");
      hLab.textContent = I18n.t("auth.help");
      help.appendChild(hIco);
      help.appendChild(hLab);
      help.addEventListener("click", () => { menu.remove(); openHelpPage(); });
      menu.appendChild(help);
    }
    // — Appearance — theme + high contrast. These lost their header spot when
    // the chrome was decluttered; the account menu is their home in a cloud
    // session (local-only mode keeps the header buttons, since there's no
    // avatar there). They're TWO independent on/off axes, so rather than two
    // full-width text rows they sit as a single compact row of icon toggles
    // (moon + half-circle) — same idiom as the header cluster. Each button
    // clicks the hidden header button so applyTheme / applyContrast stay the
    // single source of truth, and reflects the CURRENT state via aria-pressed +
    // an sr-only / title label (read at open time).
    {
      const aDiv = document.createElement("div");
      aDiv.className = "kebab-menu__divider";
      menu.appendChild(aDiv);
      const bar = document.createElement("div");
      bar.className = "account-menu__appearance";
      bar.setAttribute("role", "group");
      bar.setAttribute("aria-label", I18n.t("actions.appearance"));
      // Stable icon + noun label per axis (moon = dark mode, half-circle = high
      // contrast); the pressed state carries on/off, so the label needn't flip
      // to a verb the way the old full-width rows did.
      const toggle = (icon, label, pressed, targetId) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "account-menu__appearance-btn";
        b.setAttribute("aria-pressed", pressed ? "true" : "false");
        b.setAttribute("aria-label", label);
        b.title = label;
        const ic = document.createElement("i");
        ic.className = icon;
        ic.setAttribute("aria-hidden", "true");
        b.appendChild(ic);
        // Keep the menu open so both axes can be toggled in one visit; the
        // hidden header button stays the source of truth and flips the <html>
        // attribute, so just mirror the new state onto aria-pressed.
        b.addEventListener("click", () => {
          document.getElementById(targetId)?.click();
          b.setAttribute("aria-pressed",
            b.getAttribute("aria-pressed") === "true" ? "false" : "true");
        });
        return b;
      };
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      const hiContrast = document.documentElement.getAttribute("data-contrast") === "high";
      bar.appendChild(toggle("fa-solid fa-moon", I18n.t("actions.darkMode"), isDark, "theme-toggle"));
      bar.appendChild(toggle("fa-solid fa-circle-half-stroke", I18n.t("actions.contrast"), hiContrast, "contrast-toggle"));
      menu.appendChild(bar);
    }
    // Sign out — cloud session only; offline there's no session to end.
    if (signedIn) {
      const outDiv = document.createElement("div");
      outDiv.className = "kebab-menu__divider";
      menu.appendChild(outDiv);
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
    }
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

  // Build a masked password input with the reveal/hide eye affix (the same
  // pattern the sign-in card uses): tabindex=-1 so keyboard users tab past it
  // to the action, aria-pressed + translated aria-label expose state, flipping
  // the input `type` keeps the value + cursor. `onToggle(revealed)` lets a
  // caller react (the new-password field hides its confirm twin when revealed).
  function passwordField(labelText, autocomplete, onToggle) {
    const input = UI.el("input", {
      class: "input input--with-affix", type: "password",
      autocomplete: autocomplete || "off"
    });
    const toggle = UI.el("button", {
      class: "input-affix", type: "button", tabindex: "-1",
      "aria-pressed": "false", "aria-label": I18n.t("auth.showPassword")
    }, [UI.el("i", { class: "fa-solid fa-eye", "aria-hidden": "true" })]);
    toggle.addEventListener("click", () => {
      const revealed = input.getAttribute("type") === "text";
      input.setAttribute("type", revealed ? "password" : "text");
      toggle.setAttribute("aria-pressed", revealed ? "false" : "true");
      toggle.setAttribute("aria-label", I18n.t(revealed ? "auth.showPassword" : "auth.hidePassword"));
      const ic = toggle.querySelector("i");
      if (ic) ic.className = revealed ? "fa-solid fa-eye" : "fa-solid fa-eye-slash";
      if (typeof onToggle === "function") onToggle(!revealed);
      input.focus();
    });
    const label = UI.el("label", { class: "field" }, [
      UI.el("span", { class: "field__label" }, labelText),
      UI.el("div", { class: "input-affix-wrap" }, [input, toggle])
    ]);
    return { label, input, toggle };
  }

  // The account page. Three self-contained sections, each with its own action:
  //  • Profile   — edit the display first name (greeting + avatar read it);
  //                email is read-only (changing it is a separate verified flow).
  //  • Password  — change it, but only for email/password accounts (a Google-
  //                only user has no password to change); verifies the current
  //                one server-side by re-authenticating.
  //  • Reset     — wipe the whole tree (was a top-level rail row; moved here so
  //                the destructive action lives behind the account surface, not
  //                one slip from Add). Editors only — a viewer can't reset.
  // Only the name field participates in the unsaved-changes discard guard;
  // abandoning a half-typed password persists nothing, so it needn't warn.
  function openAccountModal() {
    if (!(window.Auth && Auth.updateProfile)) return;
    // The "last committed" name. Unlike the old one-shot editor (which closed on
    // save), this page stays open, so a save must re-baseline this — otherwise a
    // second edit reads as clean and the discard guard + Save-enable both break.
    let startName = (Auth.getFirstName && Auth.getFirstName()) || "";
    const email = currentUserEmail();
    const canChangePw = !!(Auth.hasPassword && Auth.hasPassword() && Auth.updatePassword);
    const canEdit = !(window.FamilyStore && FamilyStore.isReadOnly && FamilyStore.isReadOnly());

    const sections = [];

    // — Profile —
    const nameInput = UI.el("input", {
      class: "input", type: "text", autocomplete: "given-name",
      placeholder: I18n.t("auth.firstNamePlaceholder"), value: startName
    });
    const emailInput = UI.el("input", {
      class: "input", type: "email", value: email, disabled: true
    });
    const nameError = UI.el("div", { class: "signin__error", role: "alert", hidden: true });
    const setNameError = (msg) => {
      if (!msg) { nameError.hidden = true; nameError.textContent = ""; return; }
      nameError.hidden = false; nameError.textContent = msg;
    };
    const saveNameBtn = UI.el("button", { class: "btn btn--primary btn--sm", type: "button", disabled: true },
      [UI.el("span", null, I18n.t("actions.save"))]);
    const dirty = () => nameInput.value.trim() !== startName.trim();
    nameInput.addEventListener("input", () => { saveNameBtn.disabled = !dirty(); });
    sections.push(UI.el("section", { class: "account-section" }, [
      UI.el("h3", { class: "account-section__title" }, I18n.t("auth.secProfile")),
      nameError,
      UI.el("label", { class: "field" }, [
        UI.el("span", { class: "field__label" }, I18n.t("auth.firstName")), nameInput
      ]),
      UI.el("label", { class: "field" }, [
        UI.el("span", { class: "field__label" }, I18n.t("auth.email")), emailInput,
        UI.el("span", { class: "field__hint" }, I18n.t("auth.emailReadonly"))
      ]),
      UI.el("div", { class: "account-section__actions" }, [saveNameBtn])
    ]));

    // — Password — (email/password accounts only)
    let pwCurrent = null, pwNew = null, pwConfirm = null;
    if (canChangePw) {
      pwCurrent = passwordField(I18n.t("auth.currentPassword"), "current-password");
      // Revealing the new password makes the retype redundant — hide + clear
      // the confirm twin so it's "entered twice, or once if you can read it".
      pwConfirm = passwordField(I18n.t("auth.confirmNewPassword"), "new-password");
      pwNew = passwordField(I18n.t("auth.newPassword"), "new-password", (revealed) => {
        pwConfirm.label.hidden = revealed;
        if (revealed) pwConfirm.input.value = "";
      });
      const pwError = UI.el("div", { class: "signin__error", role: "alert", hidden: true });
      const setPwError = (msg) => {
        if (!msg) { pwError.hidden = true; pwError.textContent = ""; return; }
        pwError.hidden = false; pwError.textContent = msg;
      };
      const changeBtn = UI.el("button", { class: "btn btn--sm", type: "button" },
        [UI.el("span", null, I18n.t("auth.changePassword"))]);
      changeBtn.addEventListener("click", async () => {
        const cur = pwCurrent.input.value;
        const nw = pwNew.input.value;
        const newRevealed = pwNew.input.getAttribute("type") === "text";
        if (!cur || !nw) { setPwError(I18n.t("auth.errPwFields")); return; }
        if (nw.length < 6) { setPwError(I18n.t("auth.errPasswordShort")); pwNew.input.focus(); return; }
        if (!newRevealed && pwConfirm.input.value !== nw) {
          setPwError(I18n.t("auth.errPasswordMismatch")); pwConfirm.input.focus(); return;
        }
        if (nw === cur) { setPwError(I18n.t("auth.errSamePassword")); pwNew.input.focus(); return; }
        setPwError("");
        changeBtn.disabled = true;
        try {
          await Auth.updatePassword({ currentPassword: cur, newPassword: nw });
          pwCurrent.input.value = ""; pwNew.input.value = ""; pwConfirm.input.value = "";
          if (UI.toast) UI.toast(I18n.t("auth.passwordChanged"), "success");
        } catch (e) {
          const code = e && /** @type {any} */ (e).code;
          setPwError(code === "current-password"
            ? I18n.t("auth.errCurrentPassword")
            : ((e && e.message) || I18n.t("auth.errGeneric")));
        } finally {
          changeBtn.disabled = false;
        }
      });
      sections.push(UI.el("section", { class: "account-section" }, [
        UI.el("h3", { class: "account-section__title" }, I18n.t("auth.secPassword")),
        pwError,
        pwCurrent.label,
        pwNew.label,
        UI.el("span", { class: "field__hint account-section__hint" }, I18n.t("auth.newPasswordHint")),
        pwConfirm.label,
        UI.el("div", { class: "account-section__actions" }, [changeBtn])
      ]));
    }

    // — Reset — OWNER only. Reset wipes the whole tree for every member, so an
    // editor on a shared tree must not see it (canReplaceWholeTree; the flow
    // itself also hard-blocks non-owners). In local-only mode canReplaceWholeTree
    // is true, but the account modal is cloud-only anyway.
    if (canReplaceWholeTree()) {
      const resetBtn = UI.el("button", { class: "btn btn--danger btn--sm", type: "button" }, [
        UI.el("i", { class: "fa-solid fa-trash-can", "aria-hidden": "true" }),
        UI.el("span", null, I18n.t("rail.reset"))
      ]);
      resetBtn.addEventListener("click", async () => {
        const done = await resetEverythingFlow();
        if (done) dlg.close(true);
      });
      sections.push(UI.el("section", { class: "account-section account-section--danger" }, [
        UI.el("h3", { class: "account-section__title" }, I18n.t("auth.secDanger")),
        UI.el("p", { class: "account-section__note" }, I18n.t("auth.resetDesc")),
        UI.el("div", { class: "account-section__actions" }, [resetBtn])
      ]));
    }

    const body = UI.el("div", { class: "account-page" }, sections);

    let discardConfirming = false;
    const doneBtn = UI.el("button", { class: "btn btn--ghost", type: "button" },
      [UI.el("span", null, I18n.t("actions.done"))]);

    const dlg = UI.openModal({
      title: I18n.t("auth.accountSettings"),
      body,
      footer: [doneBtn],
      // Guard only the name field: a saved edit re-baselines startName (so
      // dirty() reads clean), and a half-typed password persists nothing.
      beforeClose: () => {
        if (!dirty()) return true;
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

    doneBtn.addEventListener("click", () => dlg.close());
    saveNameBtn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      if (!name) { setNameError(I18n.t("auth.errNameRequired")); nameInput.focus(); return; }
      setNameError("");
      saveNameBtn.disabled = true;
      try {
        await Auth.updateProfile({ firstName: name });
        startName = name;                 // re-baseline: this is now the clean state
        paintAccountButton();
        if (UI.toast) UI.toast(I18n.t("auth.profileSaved"), "success");
      } catch (e) {
        setNameError((e && e.message) || I18n.t("auth.errGeneric"));
      } finally {
        saveNameBtn.disabled = !dirty();
      }
    });
  }

  // — Undo / redo —
  // FamilyStore owns a snapshot history (see data-store.js); this is just the
  // chrome. doUndo/doRedo step the store and toast (the reverted change may be
  // off-screen — a profile field, a node the other side of the canvas — so a
  // silent swap would read as "nothing happened"). Three callers share this
  // funnel so the guard + toast live in ONE place: the keyboard shortcuts
  // below, the phone kebab rows, and the tree-canvas toolbar buttons
  // (tree-view.js), which reach back via the virasat:undo / virasat:redo events
  // — mirroring the virasat:reveal-in-tree seam other views already use. The
  // toolbar owns its buttons' disabled state (refreshed in its own render());
  // nothing here holds a button ref, so there's no stale-node problem when the
  // toolbar is rebuilt.
  function doUndo() {
    if (!(window.FamilyStore && FamilyStore.undo)) return;
    if (!FamilyStore.canUndo()) { if (window.UI && UI.toast) UI.toast(I18n.t("actions.nothingToUndo")); return; }
    if (FamilyStore.undo() && window.UI && UI.toast) UI.toast(I18n.t("actions.undone"), "success");
  }
  function doRedo() {
    if (!(window.FamilyStore && FamilyStore.redo)) return;
    if (!FamilyStore.canRedo()) { if (window.UI && UI.toast) UI.toast(I18n.t("actions.nothingToRedo")); return; }
    if (FamilyStore.redo() && window.UI && UI.toast) UI.toast(I18n.t("actions.redone"), "success");
  }
  window.addEventListener("virasat:undo", doUndo);
  window.addEventListener("virasat:redo", doRedo);

  // Global keyboard shortcuts: Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z or Ctrl+Y =
  // redo. Ignored while typing in a field (the native text-undo owns Z there)
  // and while any modal is open (an in-form edit shouldn't be reverted out from
  // under the dialog — the person form has its own discard guard). A viewer has
  // no history to walk, so the store no-ops it anyway; we still skip the toast.
  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
  }
  document.addEventListener("keydown", (e) => {
    const z = e.key === "z" || e.key === "Z";
    const y = e.key === "y" || e.key === "Y";
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    if (!z && !y) return;
    if (isTypingTarget(document.activeElement)) return;
    const modalRoot = document.getElementById("modal-root");
    if (modalRoot && modalRoot.firstElementChild) return;   // a dialog owns the keyboard
    if (window.FamilyStore && FamilyStore.isReadOnly && FamilyStore.isReadOnly()) return;
    // Redo = Ctrl/Cmd+Y, or Ctrl/Cmd+Shift+Z. Undo = Ctrl/Cmd+Z (no shift).
    if (y || (z && e.shiftKey)) { e.preventDefault(); doRedo(); }
    else if (z) { e.preventDefault(); doUndo(); }
  });

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

  // — High-contrast toggle —
  // A separate accessibility axis from light/dark: data-contrast="high" on
  // <html> layers stronger text/borders/focus over whichever theme is active
  // (tokens.css). Persisted under its own key so a low-vision user's contrast
  // choice and their light/dark choice are remembered independently.
  const CONTRAST_KEY = "virasat.contrast";
  function applyContrast(on) {
    if (on) document.documentElement.setAttribute("data-contrast", "high");
    else document.documentElement.removeAttribute("data-contrast");
    try { localStorage.setItem(CONTRAST_KEY, on ? "high" : "normal"); } catch (_) {}
    const btn = document.getElementById("contrast-toggle");
    if (btn) {
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      const label = I18n.t(on ? "actions.contrastOn" : "actions.contrastOff");
      btn.setAttribute("aria-label", label);
      btn.setAttribute("title", label);
    }
  }
  let savedContrast = false;
  try { savedContrast = localStorage.getItem(CONTRAST_KEY) === "high"; } catch (_) {}
  applyContrast(savedContrast);
  document.getElementById("contrast-toggle")?.addEventListener("click", () => {
    applyContrast(document.documentElement.getAttribute("data-contrast") !== "high");
  });

  // — Filter (faceted, shared predicate) —
  // The rail's Filter panel is the single home for narrowing the family by
  // status / gender / birthplace / occupation / era / needs-attention. All three
  // filterable views consult the SAME predicate, Filter.matches(person): the
  // People grid HIDES non-matches; the Tree and Timeline DIM them (a soft fade,
  // so the shape of the family is never lost). State persists for the session.
  const FILTER_KEY = "virasat.filter";
  // status is a 3-way radio (all/alive/deceased — mutually exclusive). The rest
  // are MULTI-select: each holds an array of chosen values, OR'd within the
  // section and AND'd across sections (standard faceted-search behaviour), so
  // "born in Delhi OR Mumbai, AND an engineer" is expressible.
  const MULTI_DIMS = ["gender", "place", "occupation", "era", "missing"];
  const FILTER_DIMS = ["status"].concat(MULTI_DIMS);
  // A fresh default — arrays are rebuilt each call so no two filter objects ever
  // alias the same array (a shared-array bug is easy to hit with spread-clone).
  function freshFilter() { return { status: "all", gender: [], place: [], occupation: [], era: [], missing: [] }; }
  function cloneFilter(s) {
    const o = { status: (s && s.status) || "all" };
    MULTI_DIMS.forEach((k) => { o[k] = Array.isArray(s && s[k]) ? s[k].slice() : []; });
    return o;
  }
  // Coerce any incoming value for a dimension into its canonical shape: status →
  // a string; a multi dim → a fresh array ("" / null → [], scalar → [scalar]).
  // Lets Filter.set({missing:"photo"}) and the old scalar-object cache both work.
  function normDimVal(dim, val) {
    if (dim === "status") return val || "all";
    if (Array.isArray(val)) return val.filter((v) => v != null && v !== "");
    return (val == null || val === "") ? [] : [val];
  }
  function normalizeFilter(o) {
    const s = freshFilter();
    if (!o || typeof o !== "object") return s;
    s.status = (o.status === "alive" || o.status === "deceased") ? o.status : "all";
    MULTI_DIMS.forEach((k) => { s[k] = normDimVal(k, o[k]); });
    return s;
  }
  let filterState = (() => {
    try {
      const raw = sessionStorage.getItem(FILTER_KEY);
      if (!raw) return freshFilter();
      // Back-compat: earlier builds persisted a bare status string, then a
      // scalar-per-dimension object; normalizeFilter folds both into arrays.
      if (raw === "all" || raw === "alive" || raw === "deceased") return normalizeFilter({ status: raw });
      return normalizeFilter(JSON.parse(raw));
    } catch (_) { return freshFilter(); }
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
  // A multi-select dimension matches when EMPTY (no narrowing) or when the
  // person's value is one of the chosen ones (OR within the section).
  function anyOf(arr, val) { return !arr || arr.length === 0 || arr.indexOf(val) !== -1; }
  function filterMatchesExcept(p, exclude, state) {
    if (!p) return false;
    const s = state || filterState;
    if (exclude !== "status") {
      if (s.status === "alive" && !FamilyStore.isAlive(p)) return false;
      if (s.status === "deceased" && !FamilyStore.isDeceased(p)) return false;
    }
    if (exclude !== "gender" && !anyOf(s.gender, p.gender)) return false;
    if (exclude !== "place" && !anyOf(s.place, facetKey(p, "birthPlace"))) return false;
    if (exclude !== "occupation" && !anyOf(s.occupation, facetKey(p, "occupation"))) return false;
    if (exclude !== "era" && s.era && s.era.length && !s.era.some((d) => personDecade(p) === d)) return false;
    if (exclude !== "missing" && s.missing && s.missing.length && !s.missing.some((f) => personMissing(p, f))) return false;
    return true;
  }
  function filterMatches(p) { return filterMatchesExcept(p, null); }
  // Each dimension counts ONCE toward "active" no matter how many values it
  // holds — the badge means "how many sections are narrowing", not value count.
  function filterActiveCount() {
    let n = filterState.status !== "all" ? 1 : 0;
    MULTI_DIMS.forEach((k) => { if (filterState[k] && filterState[k].length) n++; });
    return n;
  }
  function notifyViewsOfFilter() {
    if (window.PeopleView && PeopleView.setFilter) PeopleView.setFilter();
    if (window.TreeView && TreeView.setFilter) TreeView.setFilter();
    if (window.TimelineView && TimelineView.setFilter) TimelineView.setFilter();
    if (window.InsightsView && InsightsView.setFilter) InsightsView.setFilter();
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
  // Merge a patch into a target filter object, normalizing each named dimension
  // into its canonical shape. status takes a string; a multi dim takes an array
  // OR a bare scalar (coerced) — so external callers can still pass a string.
  function mergeInto(target, patch) {
    if (typeof patch === "string") patch = { status: patch };   // back-compat (Filter.set("all"))
    if (patch && typeof patch === "object") {
      FILTER_DIMS.forEach((k) => { if (k in patch) target[k] = normDimVal(k, patch[k]); });
    }
  }
  function applyFilter(patch) {
    mergeInto(filterState, patch);
    saveFilter();
    renderFilterPanel();
    notifyViewsOfFilter();
  }
  // The modal's dispatcher — edits the draft and repaints only the modal body
  // (never the rail/views), so nothing commits until Apply.
  function applyDraft(patch) {
    if (!filterDraft) return;
    mergeInto(filterDraft, patch);
    if (filterModalBody) renderFilterModalBody();
  }
  window.Filter = {
    get: () => cloneFilter(filterState),
    getStatus: () => filterState.status,
    set: applyFilter,
    setStatus: (s) => applyFilter({ status: s || "all" }),
    clear: () => applyFilter(freshFilter()),
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
    const placeSet = new Set(idx.places.map((o) => o.value));
    const occSet = new Set(idx.occupations.map((o) => o.value));
    const decadeSet = new Set(idx.decades);
    s.place = (s.place || []).filter((v) => placeSet.has(v));
    s.occupation = (s.occupation || []).filter((v) => occSet.has(v));
    s.era = (s.era || []).filter((v) => decadeSet.has(v));
    if (!idx.hasGender) s.gender = [];
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
    const active = dim === "status" ? state[dim] === value
      : Array.isArray(state[dim]) && state[dim].indexOf(value) !== -1;
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
      if (dim === "status") {
        // Status stays a radio: re-clicking the active option resets to "all".
        dispatch({ status: state[dim] === value ? "all" : value });
      } else {
        // Multi: toggle this value in/out of the section's set (OR within it).
        const cur = Array.isArray(state[dim]) ? state[dim] : [];
        const next = cur.indexOf(value) !== -1 ? cur.filter((v) => v !== value) : cur.concat([value]);
        dispatch({ [dim]: next });
      }
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
    const selected = Array.isArray(state[dim]) ? state[dim] : [];
    const scored = options
      .map((o) => ({ o, count: filterCountFor(people, dim, (p) => facetKey(p, field) === o.value, state) }))
      .filter((x) => x.count > 0 || selected.indexOf(x.o.value) !== -1)
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
    MULTI_DIMS.forEach((k) => { if (s[k] && s[k].length) n++; });
    return n;
  }

  // "You" rail picker — sets the per-viewer self-anchor (the personal lens that
  // gold-rings your node and labels every relative's kin term to you). A
  // HeritageSelect person picker with a "— No one —" clear row, plus a one-line
  // hint that the gold ring is what marks you on the tree. Local-only (see
  // SelfAnchor); available to viewers too since it edits no tree data. Kept in
  // sync with the right-click "This is me" fast-path via SelfAnchor.onChange.
  // Re-rendered on data change (names/people), language change, and self change.
  function renderSelfPicker() {
    const host = document.getElementById("rail-you-panel");
    const block = document.getElementById("rail-you-block");
    if (!host) return;
    while (host.firstChild) host.removeChild(host.firstChild);

    // No SelfAnchor (smoke shim) or an empty tree → nothing to pin; hide the
    // whole block so an empty picker never sits in the rail.
    const people = (window.SelfAnchor && window.FamilyStore) ? FamilyStore.getPeople() : [];
    const pinnable = people.filter((p) => !p.isPet);
    if (block) block.hidden = pinnable.length === 0;
    if (!pinnable.length) return;

    const current = SelfAnchor.get() || "";
    const opts = [{ value: "", label: railT("youNone") }].concat(
      pinnable
        .slice()
        .sort((a, b) => {
          const an = (FamilyStore.getField(a, "name") || a.name || "").toLowerCase();
          const bn = (FamilyStore.getField(b, "name") || b.name || "").toLowerCase();
          return an < bn ? -1 : an > bn ? 1 : 0;
        })
        .map((p) => {
          const label = (FamilyStore.getField(p, "name") || p.name)
            + (p.birthDate ? "  · " + (FamilyStore.getYear(p.birthDate) || "") : "");
          return { value: p.id, label };
        })
    );

    const onPick = (v) => {
      // Empty value = the "— No one —" row = clear. Otherwise pin. Guard the
      // no-op (picking the already-pinned person) so we don't toast on reselect.
      if (!v) {
        if (SelfAnchor.get()) {
          SelfAnchor.clear();
          UI.toast(I18n.t("tree.selfCleared") || "Cleared — no longer marked as you", "success");
        }
        return;
      }
      if (SelfAnchor.isSelf(v)) return;
      const p = FamilyStore.getPerson(v);
      const nm = p ? (FamilyStore.getField(p, "name") || p.name) : "";
      SelfAnchor.set(v);
      UI.toast(I18n.t("tree.selfSet", { name: nm }) || (nm + " is now marked as you"), "success");
    };

    if (window.HeritageSelect && HeritageSelect.create) {
      const sel = HeritageSelect.create({
        options: opts, value: current, onChange: onPick,
        placeholder: railT("youPick"), ariaLabel: railT("youAria")
      });
      host.appendChild(sel.el);
    } else {
      // Defensive fallback — native select if HeritageSelect hasn't loaded.
      const sel = document.createElement("select");
      sel.className = "input";
      sel.setAttribute("aria-label", railT("youAria"));
      opts.forEach((o) => {
        const opt = document.createElement("option");
        opt.value = o.value; opt.textContent = o.label;
        sel.appendChild(opt);
      });
      sel.value = current;
      sel.addEventListener("change", () => onPick(sel.value));
      host.appendChild(sel);
    }
  }

  // The "You" info icon sits beside the rail heading: hover shows the hint via
  // the native title (never clipped by the rail's overflow), and a tap toasts
  // it on touch, where title never fires. Wired once at boot.
  function wireSelfInfo() {
    const info = document.getElementById("rail-you-info");
    if (!info || info.dataset.wired) return;
    info.dataset.wired = "1";
    info.addEventListener("click", (e) => {
      e.preventDefault();
      UI.toast(railT("youHint"), "success");
    });
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
      clr.addEventListener("click", () => { filterExpanded.place = false; filterExpanded.occupation = false; applyFilter(freshFilter()); });
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
        return (count > 0 || draft.gender.indexOf(code) !== -1)
          ? filterRow("gender", code, gv(code), count, { icon: icons[code], chip: true, state: draft, dispatch: applyDraft })
          : null;
      }), { chip: true }));
    }

    // Era (birth decade) — drop zero-count decades unless one is the active pick.
    if (idx.decades.length) {
      addGroup(filterGroup(railT("era"), idx.decades
        .map((d) => ({ d, count: filterCountFor(people, "era", (p) => personDecade(p) === d, draft) }))
        .filter((x) => x.count > 0 || draft.era.indexOf(x.d) !== -1)
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
      return (count > 0 || draft.missing.indexOf(field) !== -1)
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
    filterDraft = cloneFilter(filterState);
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
        MULTI_DIMS.forEach((k) => { filterDraft[k] = []; });
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

  // Hamburger is dual-purpose. On phone (≤768px) it opens the rail as a
  // slide-in drawer over a scrim. On desktop (≥769px) the rail is a docked
  // column, so instead it collapses/expands that column to reclaim the left
  // third for the canvas (P3.9) — persisted so the choice survives a reload.
  const RAIL_COLLAPSE_KEY = "virasat.railCollapsed";
  const appBody = document.querySelector(".app-body");
  function isDesktopRail() { return window.matchMedia("(min-width: 769px)").matches; }
  function applyRailCollapsed(collapsed) {
    if (!appBody) return;
    appBody.classList.toggle("rail-collapsed", collapsed);
    document.getElementById("hamburger-btn")?.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }
  // Restore the desktop preference on boot (default expanded). Reflect the
  // resolved state on desktop unconditionally so aria-expanded is accurate even
  // when the rail is expanded; on phone the HTML default (collapsed drawer,
  // aria-expanded=false) is already right.
  let railCollapsedPref = false;
  try { railCollapsedPref = localStorage.getItem(RAIL_COLLAPSE_KEY) === "1"; } catch (_) {}
  if (isDesktopRail()) applyRailCollapsed(railCollapsedPref);

  document.getElementById("hamburger-btn")?.addEventListener("click", (ev) => {
    const btn = /** @type {HTMLElement} */ (ev.currentTarget);
    if (isDesktopRail()) {
      const collapsed = !appBody?.classList.contains("rail-collapsed");
      applyRailCollapsed(collapsed);
      try { localStorage.setItem(RAIL_COLLAPSE_KEY, collapsed ? "1" : "0"); } catch (_) {}
      return;
    }
    const rail = document.getElementById("rail");
    if (!rail) return;
    const opening = !rail.classList.contains("is-open");
    rail.classList.toggle("is-open", opening);
    overlay?.classList.toggle("is-on", opening);
    btn.setAttribute("aria-expanded", opening ? "true" : "false");
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
    // The "You" picker options track the people list (names, additions,
    // deletions) — rebuild it on every data change too.
    renderSelfPicker();
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
      migrateAndBackfillPhotos();
      UI.toast(I18n.t("welcome.loaded"), "success");
    }
  }

  // The sample tree inlines its photos as base64. Fold them into IDB (so they
  // don't ride inside every cloud push as ~450 KB of JSONB) and, in cloud mode,
  // backfill the resulting blobs to the bucket so they sync to other devices —
  // exactly what the import paths do. Fire-and-forget: never blocks the swap.
  function migrateAndBackfillPhotos() {
    if (window.PhotoStore && PhotoStore.migrateLegacy) {
      PhotoStore.migrateLegacy()
        .then(() => PhotoStore.backfillToCloud && PhotoStore.backfillToCloud())
        .catch((e) => console.warn("Photo migration/backfill:", e));
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
    // Ensure the header menu exists in EVERY mode. The cloud path already calls
    // setupAccountMenu() before boot (to paint the avatar the moment a session
    // loads); this covers the local-only path, which never runs bootWithCloud.
    // Idempotent — the account-btn guard makes a second call a no-op.
    setupAccountMenu();
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

    // Keep the rail "You" picker in sync when self is set/cleared from anywhere
    // else — the tree's right-click "This is me" fast-path, or a self-heal after
    // the pinned person is deleted. Just repaints the picker (the tree draws its
    // own gold ring off the same SelfAnchor). Cheap: one small dropdown rebuild.
    if (window.SelfAnchor && SelfAnchor.onChange) {
      SelfAnchor.onChange(() => renderSelfPicker());
    }
    wireSelfInfo();

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

    // Initial view from the hash, then keep it in sync. Normalize the URL up
    // front with replaceState (no history entry) so an empty or junk hash lands
    // on the default without leaving a back-trap to the hashless URL, and so the
    // first activate() sees a matching hash and doesn't push a spurious entry.
    // An overlay route (#help / #about) is NOT a view: activate the default
    // view underneath it — via activate("tree") WITHOUT letting it rewrite the
    // hash — then open the overlay on top so a shared/bookmarked link lands on
    // the right modal and closing it reveals a real view.
    const initial = (location.hash || "").replace(/^#/, "");
    if (isOverlayRoute(initial)) {
      activate("tree", { silent: true });        // paint a view under the overlay
      openOverlayRoute(initial, true);           // fromHash: don't push another entry
    } else {
      const start = views[initial] ? initial : "tree";
      if (location.hash !== "#" + start) history.replaceState(null, "", "#" + start);
      activate(start);
    }
    window.addEventListener("hashchange", () => {
      const n = (location.hash || "").replace(/^#/, "");
      // Overlay route in the URL → open it (if not already), leaving the view
      // beneath untouched. Any other hash → an open overlay must close, then
      // the view router runs.
      if (isOverlayRoute(n)) { openOverlayRoute(n, true); return; }
      if (overlayHandle) closeOverlayForHashChange();
      // Skip when it's already the active view — the push activate() makes when
      // reflecting a click would otherwise bounce back here and re-render.
      if (views[n] && n !== activeView) activate(n);
    });

    // If the user has already opted into anniversary reminders, refresh the
    // year-ahead schedule for the now-loaded tree. No-op otherwise (and never
    // prompts — opting in is an explicit tap in the Insights "Coming up" panel).
    if (window.Anniversaries && typeof Anniversaries.syncReminders === "function") {
      try { Anniversaries.syncReminders(); } catch (_) {}
    }
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

  // Cross-view cue for an active sticky lineage focus. The Tree view has its own
  // in-stage "Viewing as X · Clear focus" banner, but that dim/highlight — and
  // the whole "I'm tracing X's line" mental model — silently vanishes the moment
  // you switch to People or Timeline. This surfaces the same state at the top of
  // .app-main on every non-Tree view: it names the focused person, offers a jump
  // back to the tree (where the highlight lives), and a Clear focus that mirrors
  // the in-stage banner's reset. Driven by the `virasat:lineage-focus` event
  // TreeView fires on every focus change, and re-evaluated on view switch.
  function renderLineageFocusCue() {
    const main = document.querySelector(".app-main");
    if (!main) return;
    const focus = (window.TreeView && TreeView.getLineageFocus) ? TreeView.getLineageFocus() : null;
    const existing = document.getElementById("lineage-cue");
    // Only shown OFF the tree — on the tree the in-stage banner already says it.
    const show = !!focus && activeView !== "tree";
    if (!show) { if (existing) existing.remove(); return; }
    const person = FamilyStore.getPerson(focus.id);
    if (!person) { if (existing) existing.remove(); return; }
    const name = (FamilyStore.getField && FamilyStore.getField(person, "name")) || person.name || "";

    // Rebuild in place so a focus-person rename or mode change repaints cleanly.
    if (existing) existing.remove();
    const cue = document.createElement("div");
    cue.id = "lineage-cue";
    cue.className = "lineage-cue";
    cue.setAttribute("role", "status");
    cue.setAttribute("aria-live", "polite");

    const ico = document.createElement("i");
    ico.className = "fa-solid " + (focus.mode === "bloodline" ? "fa-code-branch" : "fa-route") + " lineage-cue__icon";
    ico.setAttribute("aria-hidden", "true");

    const msg = document.createElement("span");
    msg.className = "lineage-cue__msg";
    // "Focusing <name>'s lineage" — {name} bolded via a nested strong.
    const label = document.createElement("span");
    label.textContent = I18n.t("tree.focusCueLabel");
    const strong = document.createElement("strong");
    strong.className = "lineage-cue__name";
    strong.textContent = name;
    msg.appendChild(label);
    msg.appendChild(document.createTextNode(" "));
    msg.appendChild(strong);

    const viewBtn = document.createElement("button");
    viewBtn.className = "btn btn--sm btn--ghost";
    viewBtn.type = "button";
    viewBtn.textContent = I18n.t("tree.focusCueView");
    viewBtn.addEventListener("click", () => {
      activate("tree");
      if (window.TreeView && TreeView.revealPerson) TreeView.revealPerson(focus.id);
    });

    const clearBtn = document.createElement("button");
    clearBtn.className = "btn btn--sm btn--ghost lineage-cue__clear";
    clearBtn.type = "button";
    clearBtn.textContent = I18n.t("tree.clearFocus");
    clearBtn.addEventListener("click", () => {
      if (window.TreeView && TreeView.clearLineageFocus) TreeView.clearLineageFocus();
      renderLineageFocusCue(); // repaint immediately (the event also fires)
    });

    cue.appendChild(ico);
    cue.appendChild(msg);
    cue.appendChild(viewBtn);
    cue.appendChild(clearBtn);
    // Sit below the viewer banner if present (the viewer note is the more
    // fundamental "you can't edit" state; the focus cue is a transient lens).
    // insertBefore(cue, null) appends, so this handles a last-child banner too.
    const viewerBanner = document.getElementById("viewer-banner");
    if (viewerBanner) main.insertBefore(cue, viewerBanner.nextSibling);
    else main.insertBefore(cue, main.firstChild);
  }
  window.addEventListener("virasat:lineage-focus", renderLineageFocusCue);
  // Keep the banner + Share button + shell title in sync when the role/tree
  // changes (tree switch) without a full reboot — cloud-store toggles
  // body.is-viewer and repoints activeTreeId, so re-evaluate all on store change.
  if (window.FamilyStore && FamilyStore.subscribe) FamilyStore.subscribe(() => {
    renderViewerBanner();
    refreshShareButton();
    refreshShellTitle();
    refreshTreesRail();
    refreshDestructiveTools();
    refreshLegacyCta();
    refreshSyncPip();
    // A rename of the focused person should repaint the cue's name; a delete
    // clears the focus in TreeView.render (which fires the event), but repaint
    // here too so the cue never outlives its person on the current view.
    renderLineageFocusCue();
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
      .then(() => { setupAccountMenu(); renderViewerBanner(); refreshShareButton(); refreshShellTitle(); refreshTreesRail(); refreshDestructiveTools(); refreshLegacyCta(); refreshSyncPip(); bootApp(); });
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
