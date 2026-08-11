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
  if (headerSearch) {
    headerSearch.addEventListener("input", (e) => {
      const q = /** @type {HTMLInputElement} */ (e.target).value || "";
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
      if (!window.SampleData) throw new Error("Sample data not loaded");
      FamilyStore.replaceAll(SampleData.build());
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

  // — Phone overflow menu —
  // The desktop header row holds theme / lang / Collect / Import / Export.
  // On phone (≤ 768 px) all of those collapse into a kebab-anchored
  // popover so the header can fit on a 360 px viewport without overflow.
  // The kebab button itself is hidden via CSS ≥ 769 px so this listener
  // is harmless on desktop.
  document.getElementById("kebab-btn")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const existing = document.querySelector(".kebab-menu");
    if (existing) { existing.remove(); return; }
    openKebabMenu(ev.currentTarget);
  });
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
      item.addEventListener("click", () => { menu.remove(); onClick(); });
      return item;
    }
    function divider() {
      const d = document.createElement("div");
      d.className = "kebab-menu__divider";
      return d;
    }
    // Theme — text label flips with current state so the user knows what
    // the tap will produce.
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    menu.appendChild(row(
      isDark ? "fa-solid fa-sun" : "fa-solid fa-moon",
      isDark ? "Light mode" : "Dark mode",
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
      menu.appendChild(row("fa-solid fa-clipboard", "Collect via form",
        () => window.CollectForm && CollectForm.open()));
      menu.appendChild(row("fa-solid fa-file-import", "Import",
        () => window.ExportImport && ExportImport.openImport()));
    }
    menu.appendChild(row("fa-solid fa-file-export", "Export",
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
    // Click-outside / Escape closes the menu.
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
      UI.toast("Sign-out failed: " + (e && e.message || "unknown"), "danger");
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
      x.classList.toggle("is-active", /** @type {HTMLElement} */ (x).dataset.filter === currentFilter));
    if (window.PeopleView && PeopleView.setFilter) PeopleView.setFilter(currentFilter);
    if (window.TreeView && TreeView.setFilter) TreeView.setFilter(currentFilter);
    if (window.TimelineView && TimelineView.setFilter) TimelineView.setFilter(currentFilter);
  }
  window.Filter = { get: () => currentFilter, set: applyFilter };
  document.querySelectorAll(".rail-item[data-filter]").forEach((b) => {
    b.addEventListener("click", () => applyFilter(/** @type {HTMLElement} */ (b).dataset.filter));
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
      /** @type {HTMLElement} */ (list).appendChild(li);
    }
    row("birth", s.missingBirth, "fa-regular fa-calendar-xmark", "Missing birth date");
    row("photo", s.missingPhoto, "fa-regular fa-image", "Missing photo");
    row("description", s.missingDescription, "fa-regular fa-pen-to-square", "Missing description");
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
        UI.toast("Sample data not loaded — refresh the page to retry.", "danger");
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
  // Keep the banner + Share button in sync when the role/tree changes (tree
  // switch) without a full reboot — cloud-store toggles body.is-viewer and
  // repoints activeTreeId, so re-evaluate both on store change.
  if (window.FamilyStore && FamilyStore.subscribe) FamilyStore.subscribe(() => {
    renderViewerBanner();
    refreshShareButton();
  });

  function bootWithCloud() {
    if (!window.CloudStore || typeof CloudStore.start !== "function") { bootApp(); return; }
    CloudStore.start()
      .catch((err) => {
        console.warn("Cloud load failed — using local cache:", err && err.message || err);
        if (window.UI && UI.toast) UI.toast("Couldn't reach the cloud — showing your last saved copy.", "warning");
      })
      .then(() => maybeFirstRun())
      .then(() => { setupAccountMenu(); renderViewerBanner(); refreshShareButton(); bootApp(); });
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
