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
          // A wrong password has no "forgot password" flow — the magic-link
          // button IS the recovery path. The error text now names it; briefly
          // highlight it too so the eye lands on the way out. Only on a genuine
          // credential mismatch (not network/rate errors, where it won't help).
          const low = String((err && (err.message || err.error_description || err.error)) || "").toLowerCase();
          if (mode === "signin" && low.includes("invalid login")) {
            magicBtn.classList.add("signin__provider--hint");
            setTimeout(() => magicBtn.classList.remove("signin__provider--hint"), 2400);
          }
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
      // ── Decorative hero visual: a tiny family-tree diagram — a couple linked
      //    down to three children. Purely illustrative, so the whole thing is
      //    aria-hidden (the pitch above already carries the meaning). Built with
      //    createElementNS because UI.el is HTML-only; colours come from the
      //    avatar pastel tokens via CSS classes, so it themes light/dark. ──
      const SVG_NS = "http://www.w3.org/2000/svg";
      function svg(tag, attrs, kids) {
        const node = document.createElementNS(SVG_NS, tag);
        if (attrs) for (const k in attrs) {
          if (attrs[k] == null || attrs[k] === false) continue;
          node.setAttribute(k, attrs[k]);
        }
        (Array.isArray(kids) ? kids : kids ? [kids] : []).forEach((c) => c && node.appendChild(c));
        return node;
      }
      function link(x1, y1, x2, y2) {
        // stroke-dasharray + --len seed the draw-on animation (the line's own
        // length as one dash, offset by that length so it starts hidden and
        // "draws" to offset 0). With motion disabled, offset stays 0 → the full
        // dash shows, so the line is simply drawn.
        const len = Math.round(Math.hypot(x2 - x1, y2 - y1));
        return svg("line", {
          class: "landing__tree-link", x1: x1, y1: y1, x2: x2, y2: y2,
          "stroke-dasharray": len, style: "--len:" + len + "px"
        });
      }
      // One person: a pastel disc with a simple bust silhouette (head + rounded
      // shoulders), the same visual language as the app's initials-avatars.
      // `order` stages the pop-in (parents before children) via a --i CSS var.
      function treeNode(cx, cy, r, tone, order) {
        const bx = r * 0.46, by = cy + r * 0.64, bt = r * 0.52;
        const body = "M " + (cx - bx) + " " + by
          + " q 0 " + (-bt) + " " + bx + " " + (-bt)
          + " q " + bx + " 0 " + bx + " " + bt + " Z";
        // --i stages the pop-in; the scale-from-centre origin is handled in CSS
        // via transform-box:fill-box so each node grows from its own middle.
        return svg("g", {
          class: "landing__tree-node landing__tree-node--" + tone,
          style: "--i:" + order
        }, [
          svg("circle", { class: "landing__tree-disc", cx: cx, cy: cy, r: r }),
          svg("circle", { class: "landing__tree-fig", cx: cx, cy: cy - r * 0.16, r: r * 0.3 }),
          svg("path", { class: "landing__tree-fig", d: body })
        ]);
      }
      function treeMock() {
        const s = svg("svg", {
          class: "landing__tree-svg", viewBox: "0 0 300 188",
          preserveAspectRatio: "xMidYMid meet", focusable: "false"
        }, [
          // Links first so the nodes paint over their endpoints.
          link(130, 44, 170, 44),    // marriage line between the two parents
          link(150, 44, 150, 108),   // drop from marriage midpoint to sibling bar
          link(66, 108, 234, 108),   // sibling bar
          link(66, 108, 66, 132), link(150, 108, 150, 132), link(234, 108, 234, 132),
          // order 0–1: the couple appears first; 2–4: their children follow.
          treeNode(110, 44, 20, "sky", 0),
          treeNode(190, 44, 20, "rose", 1),
          treeNode(66, 150, 18, "sage", 2),
          treeNode(150, 150, 18, "peach", 3),
          treeNode(234, 150, 18, "lavender", 4)
        ]);
        return make("div", { class: "landing__mock", "aria-hidden": "true" }, [s]);
      }
      // One numbered step in the "How it works" band.
      function step(num, titleKey, bodyKey, titleFb, bodyFb) {
        return make("li", { class: "landing__step" }, [
          make("div", { class: "landing__step-num", "aria-hidden": "true" }, String(num)),
          ti(make, "h3", "landing__step-title", titleKey, titleFb),
          ti(make, "p", "landing__step-body", bodyKey, bodyFb)
        ]);
      }
      // One "what you can capture" chip: an icon + a short label.
      function chip(icon, key, fb) {
        return make("li", { class: "landing__chip" }, [
          make("i", { class: icon, "aria-hidden": "true" }),
          ti(make, "span", null, key, fb)
        ]);
      }
      // One deep-dive item in the "More than a family diagram" band: an icon
      // beside a title + body (a fuller version of the capture chips above).
      function deepItem(icon, titleKey, bodyKey, titleFb, bodyFb) {
        return make("li", { class: "landing__deep-item" }, [
          make("div", { class: "landing__deep-icon" }, [make("i", { class: icon, "aria-hidden": "true" })]),
          make("div", { class: "landing__deep-text" }, [
            ti(make, "h3", "landing__deep-title", titleKey, titleFb),
            ti(make, "p", "landing__deep-body", bodyKey, bodyFb)
          ])
        ]);
      }
      // One FAQ entry — a native <details> disclosure so the answers stay
      // collapsed by default (calm, skimmable) and each question is a large,
      // tappable target. The chevron rotates via CSS on [open].
      function faqItem(qKey, aKey, qFb, aFb) {
        return make("details", { class: "landing__faq-item" }, [
          make("summary", { class: "landing__faq-q" }, [
            ti(make, "span", null, qKey, qFb),
            make("i", { class: "fa-solid fa-chevron-down landing__faq-chevron", "aria-hidden": "true" })
          ]),
          ti(make, "p", "landing__faq-a", aKey, aFb)
        ]);
      }
      const startBtn = make("button", { class: "btn btn--primary landing__cta", type: "button" }, [
        ti(make, "span", null, "landing.getStarted", "Get started")
      ]);
      // Second "Get started" at the very bottom, so a visitor who has read all
      // the way down can act without scrolling back to the hero. Same handler.
      const bottomStartBtn = make("button", { class: "btn btn--primary landing__cta", type: "button" }, [
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
          // Hero: pitch/actions on one side, the decorative tree mock on the
          // other (they stack on phones). The mock gives a first-time visitor
          // an at-a-glance picture of what the app builds.
          make("header", { class: "landing__hero" }, [
            make("div", { class: "landing__hero-copy" }, [
              make("img", { class: "landing__logo", src: "assets/icon.svg", alt: "", width: "72", height: "72" }),
              ti(make, "p", "landing__eyebrow", "landing.eyebrow", "Your family's living archive"),
              make("h1", { class: "landing__title" }, t("app.title", "Virasat")),
              ti(make, "p", "landing__pitch", "landing.pitch", "A calm, private home for your family's names, photos, and stories — one living tree that grows across generations."),
              make("div", { class: "landing__actions" }, [startBtn, signInLink])
            ]),
            treeMock()
          ]),
          // How it works — three numbered steps.
          make("section", { class: "landing__how" }, [
            ti(make, "h2", "landing__section-title", "landing.howTitle", "How it works"),
            make("ol", { class: "landing__steps" }, [
              step(1, "landing.step1Title", "landing.step1Body", "Sign in", "Create your account in seconds — with email, Google, or a one-tap magic link."),
              step(2, "landing.step2Title", "landing.step2Body", "Add your family", "Add each person and link parents, spouses, and children into one growing tree."),
              step(3, "landing.step3Title", "landing.step3Body", "Grow it together", "Invite relatives so everyone can add their own photos, dates, and stories.")
            ])
          ]),
          // What you can capture — a row of labelled chips.
          make("section", { class: "landing__capture" }, [
            ti(make, "h2", "landing__section-title", "landing.captureTitle", "What you can capture"),
            make("ul", { class: "landing__chips" }, [
              chip("fa-solid fa-image", "landing.capturePhotos", "Photos"),
              chip("fa-solid fa-calendar-day", "landing.captureDates", "Dates & places"),
              chip("fa-solid fa-book-open", "landing.captureStories", "Stories"),
              chip("fa-solid fa-diagram-project", "landing.captureRelationships", "Relationships"),
              chip("fa-solid fa-trophy", "landing.captureAchievements", "Achievements")
            ])
          ]),
          // Feature deep-dive — a fuller look at what the app can do, beyond
          // the at-a-glance capture chips. Two-column list that stacks on phones.
          make("section", { class: "landing__deep" }, [
            ti(make, "h2", "landing__section-title", "landing.deepTitle", "More than a family diagram"),
            make("ul", { class: "landing__deep-list" }, [
              deepItem("fa-regular fa-image", "landing.deep1Title", "landing.deep1Body", "Photos, framed just right", "Add a photo for each person and crop it into a clean portrait."),
              deepItem("fa-solid fa-stream", "landing.deep2Title", "landing.deep2Body", "An interactive timeline", "See your family laid out across the years on one scrollable view."),
              deepItem("fa-solid fa-book", "landing.deep3Title", "landing.deep3Body", "A printable family book", "Turn your tree into a book you can print — a page for each relative."),
              deepItem("fa-solid fa-clipboard", "landing.deep4Title", "landing.deep4Body", "Gather details together", "Send relatives a simple form and import their answers.")
            ])
          ]),
          make("div", { class: "landing__features" }, [
            feature("fa-solid fa-lock", "landing.feature1Title", "landing.feature1Body", "Private & yours", "Only people you invite can see a tree."),
            feature("fa-solid fa-cloud", "landing.feature2Title", "landing.feature2Body", "On every device", "Sign in once and your tree follows you."),
            feature("fa-solid fa-user-group", "landing.feature3Title", "landing.feature3Body", "Share with family", "Invite relatives by email to view or edit.")
          ]),
          // Heritage / values — a warm, centred statement of the ethos. A quiet
          // band (no card) so it reads as a pause between the feature sections.
          make("section", { class: "landing__ethos" }, [
            make("i", { class: "fa-solid fa-seedling landing__ethos-icon", "aria-hidden": "true" }),
            ti(make, "h2", "landing__ethos-title", "landing.ethosTitle", "Built to last generations"),
            ti(make, "p", "landing__ethos-body", "landing.ethosBody", "Virasat means heritage — a quiet, private place for what matters, not another social feed. No ads, no algorithms, no selling your data.")
          ]),
          // FAQ — collapsible <details> so it's calm and skimmable by default.
          make("section", { class: "landing__faq" }, [
            ti(make, "h2", "landing__section-title", "landing.faqTitle", "Questions, answered"),
            make("div", { class: "landing__faq-list" }, [
              faqItem("landing.faq1Q", "landing.faq1A", "Is Virasat free?", "Yes — Virasat is free to use, with no ads and no fees."),
              faqItem("landing.faq2Q", "landing.faq2A", "Is my family's data private?", "A tree is visible only to you and the people you invite."),
              faqItem("landing.faq3Q", "landing.faq3A", "Can my parents and grandparents use it?", "It's designed to be calm and simple, in English or Hindi."),
              faqItem("landing.faq4Q", "landing.faq4A", "Do I need an account?", "Yes — it keeps your tree safe and in sync across your devices."),
              faqItem("landing.faq5Q", "landing.faq5A", "Does it work offline?", "Yes — you can view and edit offline, and it syncs on reconnect."),
              faqItem("landing.faq6Q", "landing.faq6A", "Can I get my data out?", "Any time — export your whole tree, photos included, as one file.")
            ])
          ]),
          // Closing CTA band — a final call to act for anyone who read this far.
          make("section", { class: "landing__cta-band" }, [
            ti(make, "h2", "landing__cta-title", "landing.ctaTitle", "Start your family's tree today"),
            ti(make, "p", "landing__cta-body", "landing.ctaBody", "It takes a couple of minutes to begin."),
            bottomStartBtn
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

      // Scroll-reveal: each landing section fades+rises as it scrolls into view.
      // Pure progressive enhancement — the reveal state lives in a class that
      // CSS only acts on when motion is allowed, so with JS disabled, an old
      // browser (no IntersectionObserver), or reduced-motion, everything is
      // simply visible. Observe once, unobserve after reveal (one-shot).
      (function setupReveal() {
        const targets = landing.querySelectorAll(".landing__how, .landing__capture, .landing__deep, .landing__features, .landing__ethos, .landing__faq, .landing__cta-band");
        if (!targets.length) return;
        if (typeof IntersectionObserver !== "function") {
          targets.forEach((elm) => elm.classList.add("is-revealed"));
          return;
        }
        targets.forEach((elm) => elm.classList.add("landing__reveal"));
        const io = new IntersectionObserver((entries, obs) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) { entry.target.classList.add("is-revealed"); obs.unobserve(entry.target); }
          });
        }, { rootMargin: "0px 0px -12% 0px", threshold: 0.06 });
        targets.forEach((elm) => io.observe(elm));
      })();

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
      bottomStartBtn.addEventListener("click", () => revealAuth(true));
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
    if (low.includes("not confirmed") || low.includes("confirm your email") || low.includes("email not confirmed")) return t("auth.errUnconfirmed", "Almost there — check your email and click the confirmation link, then sign in.");
    if (low.includes("rate limit") || low.includes("too many") || low.includes("for security purposes")) return t("auth.errRate", "Too many attempts — wait a minute and try again.");
    if (low.includes("network") || low.includes("failed to fetch")) return t("auth.errNetwork", "Can't reach the server. Check your connection.");
    // Fall through: NEVER surface Supabase's raw English string to a family
    // member (e.g. "Password should be at least 6 characters", or its verbose
    // security-purposes rate-limit phrasing). Prefer the friendly generic and
    // keep the raw text in the console for diagnosis.
    if (msg && typeof console !== "undefined") { try { console.warn("[Virasat] unmapped auth error:", msg); } catch (_) {} }
    return t("auth.errGeneric", "Something went wrong. Please try again.");
  }

  global.SignIn = { show, hide };
})(window);
