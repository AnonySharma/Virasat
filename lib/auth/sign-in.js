// @ts-check
/**
 * Sign-in gate — the full-viewport screen shown when cloud is enabled but
 * nobody is signed in. Offers all three methods: email+password (with a
 * sign-up toggle), Google OAuth, and magic-link.
 *
 * Contract with app.js:
 *   SignIn.show() → Promise<session>, resolves once a session is established
 *                   (password sign-in, magic-link in this tab, or the app
 *                   reloading after an OAuth redirect). The gate removes
 *                   itself before the promise resolves, then app.js boots.
 *
 * OAuth/magic-link note: signInWithGoogle navigates away and returns to this
 * page with `?code=` (PKCE). On return the app boots fresh, Auth.ready() sees
 * the session, and SignIn.show() is never called — so the redirect path needs
 * no handling here. This screen only resolves for in-tab sign-ins.
 *
 * Load-time safe: defines SignIn and returns. Renders nothing until show().
 */
(function (global) {
  "use strict";

  function t(key, fallback) {
    if (global.I18n && typeof I18n.t === "function") {
      const v = I18n.t(key);
      if (v && v !== key) return v;
    }
    return fallback;
  }

  const el = () => (global.UI && UI.el);

  // A translatable text node: seeds initial copy AND tags it with data-i18n so
  // I18n.setLang → applyToDOM re-translates it live when the language toggle in
  // the onboarding chrome is used (these screens render before app.js's global
  // applyToDOM wiring covers them). Used for every static string on the screen.
  function ti(make, tag, cls, key, fallback) {
    const a = { "data-i18n": key };
    if (cls) a.class = cls;
    return make(tag, a, t(key, fallback));
  }

  let root = null;         // the mounted .signin element, if any
  let mode = "signin";     // "signin" | "signup"

  function show() {
    return new Promise((resolve) => {
      if (root) { return; } // already showing — swallow the duplicate call
      const make = el();
      if (!make) { resolve(global.Auth && Auth.getSession && Auth.getSession()); return; }

      // Elements we mutate across handlers.
      const errorBox = make("div", { class: "signin__error", role: "alert", hidden: true });
      const firstNameInput = make("input", {
        class: "input", type: "text", autocomplete: "given-name",
        "data-i18n-placeholder": "auth.firstNamePlaceholder",
        placeholder: t("auth.firstNamePlaceholder", "e.g. Aanya")
      });
      // The first-name field only applies to sign-up; its wrapping <label> is
      // hidden in sign-in mode (applyMode toggles it). The label carries an
      // "optional" tag (sign-up works without it) and a hint explaining why we
      // ask; the placeholder is an example name (not a second "First name") so
      // label + placeholder don't say the same thing twice.
      const firstNameField = make("label", { class: "field signin__firstname" }, [
        make("span", { class: "field__label field__label--hi" }, [
          ti(make, "span", null, "auth.firstName", "First name"),
          ti(make, "span", "field__label-tag", "form.optional", "optional")
        ]),
        firstNameInput,
        ti(make, "span", "field__hint", "auth.firstNameHint", "So we can greet you — you can change it later.")
      ]);
      const emailInput = make("input", {
        class: "input", type: "email", autocomplete: "email",
        "data-i18n-placeholder": "auth.emailPlaceholder",
        placeholder: t("auth.emailPlaceholder", "you@example.com"), required: true
      });
      const passwordInput = make("input", {
        class: "input", type: "password", autocomplete: "current-password",
        "data-i18n-placeholder": "auth.passwordPlaceholder",
        placeholder: t("auth.passwordPlaceholder", "Your password"), required: true
      });

      const submitBtn = make("button", { class: "btn btn--primary btn--block", type: "submit" }, [
        make("span", null, t("auth.signIn", "Sign in"))
      ]);

      const toggleLink = make("button", { class: "signin__link", type: "button" }, [
        make("span", null, t("auth.toSignUp", "New here? Create an account"))
      ]);

      const googleBtn = make("button", { class: "btn btn--block signin__provider", type: "button" }, [
        make("i", { class: "fa-brands fa-google", "aria-hidden": "true" }),
        ti(make, "span", null, "auth.google", "Continue with Google")
      ]);

      const magicBtn = make("button", { class: "btn btn--block signin__provider", type: "button" }, [
        make("i", { class: "fa-regular fa-envelope", "aria-hidden": "true" }),
        ti(make, "span", null, "auth.magic", "Email me a sign-in link")
      ]);

      function setError(msg) {
        if (!msg) { errorBox.hidden = true; errorBox.textContent = ""; return; }
        errorBox.hidden = false;
        errorBox.textContent = msg;
      }
      function setNote(msg) {
        // Reuse the box for success/info; tint via a class.
        errorBox.hidden = false;
        errorBox.className = "signin__error signin__error--note";
        errorBox.textContent = msg;
      }
      function busy(on) {
        [submitBtn, googleBtn, magicBtn, toggleLink].forEach((b) => { b.disabled = on; });
      }
      // The two mode-dependent labels can't be static data-i18n (their key flips
      // with sign-in/sign-up), so re-derive them here — called by applyMode AND
      // by the lang-change listener so a language switch on the card updates
      // them too. Kept separate from applyMode so a lang switch doesn't also
      // wipe the error/note box.
      function syncModeLabels() {
        submitBtn.querySelector("span").textContent =
          mode === "signup" ? t("auth.createAccount", "Create account") : t("auth.signIn", "Sign in");
        toggleLink.querySelector("span").textContent = mode === "signup"
          ? t("auth.toSignIn", "Have an account? Sign in")
          : t("auth.toSignUp", "New here? Create an account");
      }
      function applyMode() {
        syncModeLabels();
        passwordInput.setAttribute("autocomplete", mode === "signup" ? "new-password" : "current-password");
        // First name is only collected on sign-up.
        firstNameField.hidden = mode !== "signup";
        errorBox.className = "signin__error";
        setError("");
      }

      // — Handlers —
      const form = make("form", { class: "signin__form" }, [
        firstNameField,
        make("label", { class: "field" }, [
          ti(make, "span", "field__label", "auth.email", "Email"), emailInput
        ]),
        make("label", { class: "field" }, [
          ti(make, "span", "field__label", "auth.password", "Password"), passwordInput
        ]),
        submitBtn
      ]);

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        if (!email || !password) { setError(t("auth.errFields", "Enter your email and password.")); return; }
        errorBox.className = "signin__error"; setError("");
        busy(true);
        try {
          if (mode === "signup") {
            const data = await Auth.signUpWithPassword(email, password, firstNameInput.value);
            // If email confirmation is required, no session comes back yet.
            if (!data || !data.session) {
              // Switch to sign-in mode FIRST — applyMode() resets errorBox and
              // clears any message, so setting the note after it is essential;
              // otherwise the "check your email" note is wiped the instant it
              // appears and the user is left with a silent mode-flip.
              mode = "signin"; applyMode();
              setNote(t("auth.checkEmailConfirm", "Almost there — check your email to confirm your account, then sign in."));
              busy(false);
              return;
            }
          } else {
            await Auth.signInWithPassword(email, password);
          }
          // onAuthChange resolves the flow (below).
        } catch (err) {
          setError(friendly(err));
          busy(false);
        }
      });

      toggleLink.addEventListener("click", () => {
        mode = mode === "signup" ? "signin" : "signup";
        applyMode();
      });

      googleBtn.addEventListener("click", async () => {
        errorBox.className = "signin__error"; setError("");
        busy(true);
        try { await Auth.signInWithGoogle(); }         // navigates away on success
        catch (err) { setError(friendly(err)); busy(false); }
      });

      magicBtn.addEventListener("click", async () => {
        const email = emailInput.value.trim();
        if (!email) { setError(t("auth.errEmail", "Enter your email first.")); emailInput.focus(); return; }
        errorBox.className = "signin__error"; setError("");
        busy(true);
        try {
          await Auth.signInWithMagicLink(email);
          setNote(t("auth.checkEmailLink", "Check your email for a sign-in link."));
        } catch (err) { setError(friendly(err)); }
        finally { busy(false); }
      });

      // "Back" returns from the auth card to the landing intro (re-adds the
      // signin--landing class). Only meaningful once the user has stepped in
      // from the landing, so it lives at the top of the card as a quiet link.
      const backLink = make("button", { class: "signin__back", type: "button" }, [
        make("i", { class: "fa-solid fa-arrow-left", "aria-hidden": "true" }),
        ti(make, "span", null, "auth.backToIntro", "Back")
      ]);

      const card = make("div", { class: "signin__card" }, [
        backLink,
        make("div", { class: "signin__brand" }, [
          make("img", { class: "signin__logo", src: "assets/icon.svg", alt: "", width: "48", height: "48" }),
          make("h1", { class: "signin__title" }, t("app.title", "Virasat")),
          ti(make, "p", "signin__tagline", "auth.subtitle", "Sign in to keep your family tree safe and in sync across your devices.")
        ]),
        errorBox,
        form,
        toggleLink,
        make("div", { class: "signin__divider" }, [ti(make, "span", null, "auth.or", "or")]),
        googleBtn,
        magicBtn
      ]);

      // — Landing screen: a full-page intro to what Virasat is, shown BEFORE
      //   the sign-in form so a first-time visitor understands the product
      //   before being asked to log in. Deliberately NOT a card — it fills the
      //   viewport (hero + a row of feature tiles) so it reads as a distinct
      //   page from the compact sign-in card. "Get started" / "Sign in" swap
      //   to the auth card via a class toggle (no re-render). —
      function feature(icon, titleKey, bodyKey, titleFb, bodyFb) {
        return make("div", { class: "landing__feature" }, [
          make("div", { class: "landing__feature-icon" }, [make("i", { class: icon, "aria-hidden": "true" })]),
          ti(make, "h3", "landing__feature-title", titleKey, titleFb),
          ti(make, "p", "landing__feature-body", bodyKey, bodyFb)
        ]);
      }
      const startBtn = make("button", { class: "btn btn--primary landing__cta", type: "button" }, [
        ti(make, "span", null, "landing.getStarted", "Get started")
      ]);
      const signInLink = make("button", { class: "signin__link", type: "button" }, [
        ti(make, "span", null, "landing.haveAccount", "Already have an account? Sign in")
      ]);
      // The landing carries its own onboarding chrome (lang + theme), pinned
      // top-right, so a first-time visitor can read the pitch in their language
      // and set light/dark before ever touching the auth form.
      const landing = make("div", { class: "landing" }, [
        global.UI && UI.onboardChrome ? make("div", { class: "onboard-chrome-slot onboard-chrome-slot--landing" }, [UI.onboardChrome()]) : null,
        make("div", { class: "landing__inner" }, [
          make("header", { class: "landing__hero" }, [
            make("img", { class: "landing__logo", src: "assets/icon.svg", alt: "", width: "72", height: "72" }),
            make("h1", { class: "landing__title" }, t("app.title", "Virasat")),
            ti(make, "p", "landing__pitch", "landing.pitch", "A calm, private home for your family's names, photos, and stories — one living tree that grows across generations."),
            make("div", { class: "landing__actions" }, [startBtn, signInLink])
          ]),
          make("div", { class: "landing__features" }, [
            feature("fa-solid fa-lock", "landing.feature1Title", "landing.feature1Body", "Private & yours", "Only people you invite can see a tree."),
            feature("fa-solid fa-cloud", "landing.feature2Title", "landing.feature2Body", "On every device", "Sign in once and your tree follows you."),
            feature("fa-solid fa-user-group", "landing.feature3Title", "landing.feature3Body", "Share with family", "Invite relatives by email to view or edit.")
          ]),
          ti(make, "p", "landing__footer", "landing.footer", "Your data stays private — visible only to you and the family you invite.")
        ])
      ]);

      // The auth card gets its own chrome too, pinned to its top-right, so lang
      // + theme stay reachable after stepping in from the landing.
      if (global.UI && UI.onboardChrome) {
        card.insertBefore(make("div", { class: "onboard-chrome-slot onboard-chrome-slot--card" }, [UI.onboardChrome()]), card.firstChild);
      }

      root = make("div", { class: "signin signin--landing", role: "dialog", "aria-modal": "true", "aria-label": t("app.title", "Virasat") }, [landing, card]);
      document.body.appendChild(root);
      applyMode();

      // Swap landing → auth form. `signup` opens the form in create-account mode.
      function revealAuth(signup) {
        mode = signup ? "signup" : "signin";
        applyMode();
        root.classList.remove("signin--landing");
        setTimeout(() => (signup ? firstNameInput : emailInput).focus(), 0);
      }
      // Auth card → landing intro. Restores the class so "Get started" works again.
      function backToLanding() {
        errorBox.className = "signin__error"; setError("");
        root.classList.add("signin--landing");
      }
      startBtn.addEventListener("click", () => revealAuth(true));
      signInLink.addEventListener("click", () => revealAuth(false));
      backLink.addEventListener("click", backToLanding);

      // Live re-translation: applyToDOM (fired by I18n.setLang) handles every
      // static [data-i18n] node, but the two mode-dependent labels are set
      // imperatively, so refresh them here on a language switch.
      const offLang = (global.I18n && I18n.onChange) ? I18n.onChange(() => syncModeLabels()) : null;

      // Resolve the moment a session appears (covers password sign-in and
      // magic-link opened in this same tab). Unsubscribe + tear down first.
      const off = Auth.onAuthChange((session) => {
        if (session) { off(); if (offLang) offLang(); hide(); resolve(session); }
      });
    });
  }

  function hide() {
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
  }

  // Map Supabase auth errors to something a family member can read.
  function friendly(err) {
    const msg = (err && (err.message || err.error_description || err.error)) || "";
    const low = String(msg).toLowerCase();
    if (low.includes("invalid login")) return t("auth.errInvalid", "That email or password doesn't match. Try again.");
    if (low.includes("already registered") || low.includes("already exists")) return t("auth.errExists", "An account with this email already exists — try signing in.");
    if (low.includes("rate limit") || low.includes("too many")) return t("auth.errRate", "Too many attempts — wait a minute and try again.");
    if (low.includes("network") || low.includes("failed to fetch")) return t("auth.errNetwork", "Can't reach the server. Check your connection.");
    return msg || t("auth.errGeneric", "Something went wrong. Please try again.");
  }

  global.SignIn = { show, hide };
})(window);
