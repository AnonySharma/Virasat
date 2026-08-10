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
        placeholder: t("auth.firstNamePlaceholder", "First name")
      });
      // The first-name field only applies to sign-up; its wrapping <label> is
      // hidden in sign-in mode (applyMode toggles it).
      const firstNameField = make("label", { class: "field signin__firstname" }, [
        make("span", { class: "field__label" }, t("auth.firstName", "First name")), firstNameInput
      ]);
      const emailInput = make("input", {
        class: "input", type: "email", autocomplete: "email",
        placeholder: t("auth.emailPlaceholder", "you@example.com"), required: true
      });
      const passwordInput = make("input", {
        class: "input", type: "password", autocomplete: "current-password",
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
        make("span", null, t("auth.google", "Continue with Google"))
      ]);

      const magicBtn = make("button", { class: "btn btn--block signin__provider", type: "button" }, [
        make("i", { class: "fa-regular fa-envelope", "aria-hidden": "true" }),
        make("span", null, t("auth.magic", "Email me a sign-in link"))
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
      function applyMode() {
        submitBtn.querySelector("span").textContent =
          mode === "signup" ? t("auth.createAccount", "Create account") : t("auth.signIn", "Sign in");
        toggleLink.querySelector("span").textContent = mode === "signup"
          ? t("auth.toSignIn", "Have an account? Sign in")
          : t("auth.toSignUp", "New here? Create an account");
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
          make("span", { class: "field__label" }, t("auth.email", "Email")), emailInput
        ]),
        make("label", { class: "field" }, [
          make("span", { class: "field__label" }, t("auth.password", "Password")), passwordInput
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
              setNote(t("auth.checkEmailConfirm", "Almost there — check your email to confirm your account, then sign in."));
              mode = "signin"; applyMode();
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

      const card = make("div", { class: "signin__card" }, [
        make("div", { class: "signin__brand" }, [
          make("img", { class: "signin__logo", src: "assets/icon.svg", alt: "", width: "48", height: "48" }),
          make("h1", { class: "signin__title" }, t("app.title", "Virasat")),
          make("p", { class: "signin__tagline" }, t("auth.subtitle", "Sign in to keep your family tree safe and in sync across your devices."))
        ]),
        errorBox,
        form,
        toggleLink,
        make("div", { class: "signin__divider" }, [make("span", null, t("auth.or", "or"))]),
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
          make("h3", { class: "landing__feature-title" }, t(titleKey, titleFb)),
          make("p", { class: "landing__feature-body" }, t(bodyKey, bodyFb))
        ]);
      }
      const startBtn = make("button", { class: "btn btn--primary landing__cta", type: "button" }, [
        make("span", null, t("landing.getStarted", "Get started"))
      ]);
      const signInLink = make("button", { class: "signin__link", type: "button" }, [
        make("span", null, t("landing.haveAccount", "Already have an account? Sign in"))
      ]);
      const landing = make("div", { class: "landing" }, [
        make("div", { class: "landing__inner" }, [
          make("header", { class: "landing__hero" }, [
            make("img", { class: "landing__logo", src: "assets/icon.svg", alt: "", width: "72", height: "72" }),
            make("h1", { class: "landing__title" }, t("app.title", "Virasat")),
            make("p", { class: "landing__pitch" }, t("landing.pitch", "A calm, private home for your family's names, photos, and stories — one living tree that grows across generations.")),
            make("div", { class: "landing__actions" }, [startBtn, signInLink])
          ]),
          make("div", { class: "landing__features" }, [
            feature("fa-solid fa-lock", "landing.feature1Title", "landing.feature1Body", "Private & yours", "Only people you invite can see a tree."),
            feature("fa-solid fa-cloud", "landing.feature2Title", "landing.feature2Body", "On every device", "Sign in once and your tree follows you."),
            feature("fa-solid fa-user-group", "landing.feature3Title", "landing.feature3Body", "Share with family", "Invite relatives by email to view or edit.")
          ]),
          make("p", { class: "landing__footer" }, t("landing.footer", "Your data stays private — visible only to you and the family you invite."))
        ])
      ]);

      root = make("div", { class: "signin signin--landing", role: "dialog", "aria-modal": "true", "aria-label": t("app.title", "Virasat") }, [landing, card]);
      document.body.appendChild(root);
      applyMode();

      // Swap landing → auth form. `signup` opens the form in create-account mode.
      function revealAuth(signup) {
        mode = signup ? "signup" : "signin";
        applyMode();
        root.classList.remove("signin--landing");
        setTimeout(() => emailInput.focus(), 0);
      }
      startBtn.addEventListener("click", () => revealAuth(true));
      signInLink.addEventListener("click", () => revealAuth(false));

      // Resolve the moment a session appears (covers password sign-in and
      // magic-link opened in this same tab). Unsubscribe + tear down first.
      const off = Auth.onAuthChange((session) => {
        if (session) { off(); hide(); resolve(session); }
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
