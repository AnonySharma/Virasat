// @ts-check
/**
 * First-run screen — shown when a signed-in user has no tree yet (a brand-new
 * account, or one that just deleted its last tree). CloudStore.start() resolves
 * the active tree to null in that case; app.js shows this before booting.
 *
 * Contract with app.js:
 *   FirstRun.show() → Promise, resolves once a real cloud tree exists and is
 *                     active (created by name, imported from a backup, or a
 *                     sample loaded). The screen removes itself first, then
 *                     app.js boots into the populated tree.
 *
 * Three paths, all ending in a live tree owned by the user:
 *   • Create — name it → CloudStore.createTree (insert + switch + arm push).
 *   • Import — pick a Virasat JSON export → create an empty tree, then
 *              replaceAll() the parsed data, which markDirty→pushes it up.
 *   • Sample — same as import but with SampleData.build().
 *
 * Load-time safe: defines FirstRun and returns. Renders nothing until show().
 */
(function (global) {
  "use strict";

  function t(key, vars) {
    if (global.I18n && typeof I18n.t === "function") {
      const v = I18n.t(key, vars);
      if (v && v !== key) return v;
    }
    return null;
  }
  // t() with an explicit fallback for the few strings we want to guarantee.
  function tf(key, fallback, vars) { return t(key, vars) || fallback; }

  const el = () => (global.UI && UI.el);

  // A translatable text node: seeds initial copy AND tags it with data-i18n so
  // I18n.setLang → applyToDOM re-translates it live when the language toggle in
  // the onboarding chrome is used (this screen renders before app.js wires the
  // global applyToDOM listener). For static strings only.
  function ti(make, tag, cls, key, fallback) {
    const a = { "data-i18n": key };
    if (cls) a.class = cls;
    return make(tag, a, tf(key, fallback));
  }
  let root = null;

  /** @returns {Promise<void>} */
  function show() {
    return new Promise((resolve) => {
      if (root) return;               // already showing — swallow duplicate
      const make = el();
      if (!make) { resolve(); return; }

      let busy = false;

      // — Header: brand + greeting + sign-out (an escape hatch so a user who
      //   signed into the wrong account isn't trapped on this screen). —
      // Address the user by first name when we have one (captured at sign-up
      // or from an OAuth profile); fall back to the email, else nothing.
      const user = (global.Auth && Auth.getUser && Auth.getUser()) || null;
      const firstName = (global.Auth && Auth.getFirstName && Auth.getFirstName()) || null;
      const who = firstName || (user && user.email) || null;
      const signOutBtn = make("button", { class: "firstrun__signout", type: "button" }, [
        make("i", { class: "fa-solid fa-arrow-right-from-bracket", "aria-hidden": "true" }),
        ti(make, "span", null, "firstRun.signOut", "Sign out")
      ]);
      signOutBtn.addEventListener("click", () => {
        if (busy) return;
        if (global.Auth && Auth.signOut) Auth.signOut();   // triggers reload via onAuthChange
      });

      const errorBox = make("div", { class: "signin__error", role: "alert", hidden: true });
      function setError(msg) {
        errorBox.hidden = !msg;
        errorBox.textContent = msg || "";
      }

      // — Primary path: name + create —
      const nameInput = make("input", {
        class: "input", type: "text", maxlength: "80",
        "data-i18n-placeholder": "firstRun.namePlaceholder",
        placeholder: tf("firstRun.namePlaceholder", "e.g. Sharma family tree"),
        autocomplete: "off"
      });
      // The Create label is owned by setBusyLabel (it flips to "Creating…"), so
      // it's not a static data-i18n node; a lang-change listener re-syncs it.
      const createBtn = make("button", { class: "btn btn--primary btn--block", type: "submit" }, [
        make("i", { class: "fa-solid fa-seedling", "aria-hidden": "true" }),
        make("span", null, tf("firstRun.create", "Create tree"))
      ]);
      const createForm = make("form", { class: "firstrun__form" }, [
        make("label", { class: "field" }, [
          ti(make, "span", "field__label", "firstRun.nameLabel", "Tree name"),
          nameInput
        ]),
        createBtn
      ]);

      // Shared "commit a new tree" helper. `seed` (optional) is a parsed state
      // to load into the fresh tree (import / sample); omit it for an empty one.
      // `origin` is the button that kicked this off (create | import | sample)
      // so the busy state lands on THAT control, not always on Create.
      async function commit(name, seed, origin) {
        if (busy) return;
        busy = true;
        setError("");
        setBusyLabel(true, origin);
        try {
          const family = String(name || "").trim().split(/\s+/)[0] || "Family";
          await CloudStore.createTree(name, family);
          if (seed) {
            // createTree switched us onto the new (empty) tree and armed the
            // pusher; replaceAll marks dirty → the seed data pushes up.
            FamilyStore.replaceAll(seed);
            if (global.PhotoStore && PhotoStore.migrateLegacy) {
              PhotoStore.migrateLegacy().catch((e) => console.warn("Photo migration:", e));
            }
            if (CloudStore.flush) { try { await CloudStore.flush(); } catch (_) {} }
          }
          done();
        } catch (e) {
          console.error("first-run create failed:", e);
          setError(tf("firstRun.createError", "Couldn't create the tree. Check your connection and try again."));
          busy = false;
          setBusyLabel(false);
        }
      }

      // Toggle the busy state. All three entry points are disabled together
      // (they all lead to the same create) so a second tap can't race; the
      // spinner/label lands on `origin` — the button the user actually pressed
      // (defaults to Create for the form submit). Previously this only ever
      // touched createBtn, so importing/sampling gave feedback on the wrong
      // button and the pressed one looked dead.
      //
      // Turning busy OFF (the error path) always clears BOTH alt spinners and
      // resets the Create label regardless of origin — the catch calls this
      // with no origin, so a targeted-only reset would strand the spinner on a
      // failed Import/Sample.
      function setBusyLabel(on, origin) {
        [createBtn, importBtn, sampleBtn].forEach((b) => { b.disabled = on; });
        if (!on) {
          importBtn.classList.remove("is-busy");
          sampleBtn.classList.remove("is-busy");
          createBtn.querySelector("span").textContent = tf("firstRun.create", "Create tree");
          return;
        }
        const target = origin || createBtn;
        if (target === createBtn) {
          createBtn.querySelector("span").textContent = tf("firstRun.creating", "Creating…");
        } else {
          target.classList.add("is-busy");
        }
      }

      createForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return; }
        commit(name, null, createBtn);
      });

      // — Secondary path: import a backup —
      const importBtn = make("button", { class: "firstrun__alt", type: "button" }, [
        make("i", { class: "fa-solid fa-file-import firstrun__alt-icon", "aria-hidden": "true" }),
        make("i", { class: "fa-solid fa-circle-notch fa-spin firstrun__alt-spinner", "aria-hidden": "true" }),
        make("span", { class: "firstrun__alt-text" }, [
          ti(make, "span", "firstrun__alt-title", "firstRun.importTitle", "Import a backup"),
          ti(make, "span", "firstrun__alt-body", "firstRun.importBody", "Already have a Virasat export? Bring it in as your first tree.")
        ])
      ]);
      importBtn.addEventListener("click", () => {
        if (busy) return;
        pickBackup().then((parsed) => {
          if (!parsed) return;
          const title = (parsed.meta && parsed.meta.familyTitle)
            || (parsed.meta && parsed.meta.familyName)
            || tf("firstRun.namePlaceholder", "Family tree");
          commit(title, parsed, importBtn);
        }).catch(() => setError(tf("firstRun.createError", "Couldn't read that file.")));
      });

      // — Secondary path: try a sample —
      const sampleBtn = make("button", { class: "firstrun__alt", type: "button" }, [
        make("i", { class: "fa-solid fa-wand-magic-sparkles firstrun__alt-icon", "aria-hidden": "true" }),
        make("i", { class: "fa-solid fa-circle-notch fa-spin firstrun__alt-spinner", "aria-hidden": "true" }),
        make("span", { class: "firstrun__alt-text" }, [
          ti(make, "span", "firstrun__alt-title", "firstRun.sampleTitle", "Try a sample family"),
          ti(make, "span", "firstrun__alt-body", "firstRun.sampleBody", "Explore a small ready-made tree to see how everything works.")
        ])
      ]);
      sampleBtn.addEventListener("click", () => {
        if (busy) return;
        if (!global.SampleData || !SampleData.build) {
          setError("Sample data isn't loaded — refresh and try again.");
          return;
        }
        const sample = SampleData.build();
        const title = (sample.meta && sample.meta.familyTitle)
          || tf("firstRun.sampleName", "Sample family tree");
        commit(title, sample, sampleBtn);
      });

      const alts = make("div", { class: "firstrun__alts" }, [importBtn, sampleBtn]);
      const divider = make("div", { class: "signin__divider" }, [ti(make, "span", null, "firstRun.or", "or")]);

      const card = make("div", { class: "firstrun__card" }, [
        make("div", { class: "firstrun__brand" }, [
          make("img", { class: "signin__logo", src: "assets/icon.svg", alt: "", width: "44", height: "44" }),
          ti(make, "h1", "firstrun__title", "firstRun.title", "Create your first family tree"),
          ti(make, "p", "firstrun__subtitle", "firstRun.subtitle", "Give it a name to begin. You can rename it, add relatives, and share it any time.")
        ]),
        errorBox,
        createForm,
        divider,
        alts
      ]);

      // Greeting interpolates the user's name, so it can't be a static
      // data-i18n node; re-derive it on a language switch. Empty when we have
      // no name/email to show.
      const greetingEl = who ? make("span", { class: "firstrun__greeting" }, tf("firstRun.greeting", "Welcome, {name}", { name: who })) : make("span");
      const topbar = make("div", { class: "firstrun__topbar" }, [
        greetingEl,
        global.UI && UI.onboardChrome ? UI.onboardChrome() : make("span"),
        signOutBtn
      ]);

      root = make("div", { class: "signin firstrun", role: "dialog", "aria-modal": "true",
        "aria-label": tf("firstRun.title", "Create your first family tree") }, [topbar, card]);
      document.body.appendChild(root);
      setTimeout(() => nameInput.focus(), 0);

      // Live re-translation of the two interpolated/stateful labels on a
      // language switch (applyToDOM handles every static [data-i18n] node).
      const offLang = (global.I18n && I18n.onChange) ? I18n.onChange(() => {
        if (who) greetingEl.textContent = tf("firstRun.greeting", "Welcome, {name}", { name: who });
        if (!busy) createBtn.querySelector("span").textContent = tf("firstRun.create", "Create tree");
      }) : null;

      function done() { if (offLang) offLang(); hide(); resolve(); }
    });
  }

  // Open the shared file picker and resolve to a validated Virasat export
  // object (or null if cancelled / invalid). Reuses the same hidden input the
  // header Import button uses so there's one file-input in the DOM.
  function pickBackup() {
    return new Promise((resolve) => {
      const input = /** @type {HTMLInputElement} */ (document.getElementById("import-file-input"));
      if (!input) { resolve(null); return; }
      const onChange = async () => {
        input.removeEventListener("change", onChange);
        const file = input.files && input.files[0];
        const reset = () => { try { input.value = ""; } catch (_) {} };
        if (!file) { reset(); resolve(null); return; }
        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.people)) {
            if (global.UI && UI.toast) UI.toast(I18n.t("imp.invalid"), "danger");
            reset(); resolve(null); return;
          }
          reset(); resolve(parsed);
        } catch (_) {
          if (global.UI && UI.toast) UI.toast(I18n.t("imp.invalid"), "danger");
          reset(); resolve(null);
        }
      };
      input.addEventListener("change", onChange);
      input.click();
    });
  }

  function hide() {
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
  }

  global.FirstRun = { show, hide };
})(window);
