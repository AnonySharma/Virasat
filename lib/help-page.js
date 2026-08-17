// @ts-check
/**
 * Standalone help-page bootstrap — powers help.html.
 *
 * This is the detailed, shareable "How Virasat works" guide. It used to be a
 * cramped in-app modal (lib/features/help-guide.js, now retired); a real page
 * gives it room for per-feature descriptions and screenshots, its own URL to
 * bookmark or send to a relative, and — like privacy.html / terms.html — it
 * boots with no app.js and no cloud session, so it opens instantly in a new
 * tab from the account menu's Help row.
 *
 * Content is NOT duplicated here. Every string comes from the same `help.*`
 * i18n namespace that fed the old modal, so English and हिन्दी stay in lockstep
 * (the i18n-parity CI check guards that) and there is one source of truth.
 *
 * Screenshots are placeholders for now: each feature card renders a captioned
 * placeholder box. When a real screenshot lands at the card's `img` path, set
 * that field and the box is replaced by the image — no other change needed.
 *
 * Depends only on I18n + UI (dom.js). Re-renders on language change so the EN/HI
 * pills in the shared onboard chrome swap the whole page live.
 */
(function (global) {
  "use strict";

  // Feature map: one entry per help.* term/How pair, grouped under the same
  // section headings the modal used. `icon` is a Font Awesome glyph; `img` is
  // the eventual screenshot path (null → render the placeholder box for now).
  const SECTIONS = [
    { head: "secViews", items: [
      { icon: "fa-sitemap",        term: "tree",      how: "treeHow",      steps: "treeSteps",      img: null },
      { icon: "fa-id-card-clip",   term: "people",    how: "peopleHow",    steps: "peopleSteps",    img: null },
      { icon: "fa-timeline",       term: "timeline",  how: "timelineHow",  steps: "timelineSteps",  img: null },
      { icon: "fa-chart-simple",   term: "insights",  how: "insightsHow",  steps: "insightsSteps",  img: null },
      { icon: "fa-address-card",   term: "inspector", how: "inspectorHow", steps: "inspectorSteps", img: null },
      { icon: "fa-user-check",     term: "selfAnchor", how: "selfAnchorHow", steps: "selfAnchorSteps", img: null }
    ] },
    { head: "secBuild", items: [
      { icon: "fa-user-plus",      term: "add",     how: "addHow",     steps: "addSteps",     img: null },
      { icon: "fa-bars-staggered", term: "menu",    how: "menuHow",    steps: "menuSteps",    img: null },
      { icon: "fa-users-gear",     term: "manage",  how: "manageHow",  steps: "manageSteps",  img: null },
      { icon: "fa-link",           term: "link",    how: "linkHow",    steps: "linkSteps",    img: null },
      { icon: "fa-ring",           term: "wedding", how: "weddingHow", steps: "weddingSteps", img: null },
      { icon: "fa-image",          term: "photos",  how: "photosHow",  steps: "photosSteps",  img: null },
      { icon: "fa-book-open",      term: "stories", how: "storiesHow", steps: "storiesSteps", img: null },
      { icon: "fa-paw",            term: "pets",    how: "petsHow",    steps: "petsSteps",    img: null }
    ] },
    { head: "secFind", items: [
      { icon: "fa-magnifying-glass", term: "search",     how: "searchHow",     steps: "searchSteps",     img: null },
      { icon: "fa-filter",           term: "filter",     how: "filterHow",     steps: "filterSteps",     img: null },
      { icon: "fa-diagram-project",  term: "relation",   how: "relationHow",   steps: "relationSteps",   img: null },
      { icon: "fa-code-compare",     term: "compare",    how: "compareHow",    steps: "compareSteps",    img: null },
      { icon: "fa-bullseye",         term: "focus",      how: "focusHow",      steps: "focusSteps",      img: null },
      { icon: "fa-sliders",          term: "viewOptions", how: "viewOptionsHow", steps: "viewOptionsSteps", img: null }
    ] },
    { head: "secShare", items: [
      { icon: "fa-book",            term: "print",    how: "printHow",    steps: "printSteps",    img: null },
      { icon: "fa-file-arrow-down", term: "backup",   how: "backupHow",   steps: "backupSteps",   img: null },
      { icon: "fa-clipboard-list",  term: "collect",  how: "collectHow",  steps: "collectSteps",  img: null },
      { icon: "fa-lock",            term: "privacy",  how: "privacyHow",  steps: "privacySteps",  img: null },
      { icon: "fa-calendar-check",  term: "calendar", how: "calendarHow", steps: "calendarSteps", img: null }
    ] },
    { head: "secAccount", items: [
      { icon: "fa-code-branch",     term: "trees",  how: "treesHow",  steps: "treesSteps",  img: null },
      { icon: "fa-user-group",      term: "invite", how: "inviteHow", steps: "inviteSteps", img: null },
      { icon: "fa-cloud-arrow-up",  term: "sync",   how: "syncHow",   steps: "syncSteps",   img: null }
    ] },
    { head: "secTips", items: [
      { icon: "fa-language",             term: "language", how: "languageHow", steps: "languageSteps", img: null },
      { icon: "fa-keyboard",             term: "shortcuts", how: "shortcutsHow", steps: "shortcutsSteps", img: null },
      { icon: "fa-pen-nib",              term: "bilingual", how: "bilingualHow", steps: "bilingualSteps", img: null },
      { icon: "fa-volume-high",          term: "readAloud", how: "readAloudHow", steps: "readAloudSteps", img: null },
      { icon: "fa-ribbon",               term: "memorial", how: "memorialHow", steps: "memorialSteps", img: null },
      { icon: "fa-circle-half-stroke",   term: "theme",    how: "themeHow",    steps: "themeSteps",    img: null },
      { icon: "fa-wifi",                 term: "offline",  how: "offlineHow",  steps: "offlineSteps",  img: null },
      { icon: "fa-arrow-right-arrow-left", term: "navigate", how: "navigateHow", steps: "navigateSteps", img: null }
    ] }
  ];

  // Quick-start steps shown up top — new i18n keys, present in EN + HI.
  const STEPS = ["step1", "step2", "step3"];

  // Translate a help.* key with an English fallback for the impossible
  // no-I18n case (t() returns the key verbatim when missing).
  function h(key, fb) {
    if (global.I18n && typeof I18n.t === "function") {
      const v = I18n.t("help." + key);
      if (v && v !== "help." + key) return v;
    }
    return fb != null ? fb : key;
  }
  // Array-valued help.* lookup (the *Steps keys) — I18n.t returns arrays
  // verbatim; return [] if the key is missing so a card just skips its steps.
  function hArr(key) {
    if (global.I18n && typeof I18n.t === "function") {
      const v = I18n.t("help." + key);
      if (Array.isArray(v)) return v;
    }
    return [];
  }
  function t(key, fb) {
    if (global.I18n && typeof I18n.t === "function") { const v = I18n.t(key); if (v && v !== key) return v; }
    return fb;
  }

  // Prefer the shared DOM builder; fall back so a partial load still renders.
  function el(tag, attrs, kids) {
    if (global.UI && typeof UI.el === "function") return UI.el(tag, attrs, kids);
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) { if (k === "class") n.className = attrs[k]; else n.setAttribute(k, attrs[k]); }
    (Array.isArray(kids) ? kids : [kids]).forEach((k) => { if (k != null) n.appendChild(k.nodeType ? k : document.createTextNode(String(k))); });
    return n;
  }

  // Stable per-tile slug for deep-linking: help.html#tree, #this-is-me, …
  // Derived from the feature's `term` key (the DOM id must be one token).
  function tileId(item) { return "help-tile-" + item.term; }

  // A feature tile — a full-width horizontal row. Left: a media panel (a real
  // screenshot when the item has `img`, otherwise a branded illustration so the
  // "picture goes here" slot is always visible). Right: title, description, and
  // a numbered stepper. One tile per row keeps every tile as tall as its own
  // content — no ragged gaps.
  function card(item) {
    const steps = item.steps ? hArr(item.steps) : [];
    const media = item.img
      ? el("img", { class: "help-card__shot", src: item.img, alt: h(item.term), loading: "lazy" })
      : el("div", { class: "help-card__illus", role: "img", "aria-label": h(item.term) },
          el("span", { class: "help-card__illus-icon", "aria-hidden": "true" },
            el("i", { class: "fa-solid " + item.icon })));
    // The title is a copy-link: clicking it copies this tile's deep link and
    // toasts. A link glyph fades in on hover/focus to advertise it.
    const titleBtn = el("button", {
      type: "button",
      class: "help-card__titlebtn",
      title: h("copyHint", "Copy a link to this section"),
      "aria-label": h(item.term) + " — " + h("copyHint", "Copy a link to this section")
    }, [
      el("span", { class: "help-card__icon", "aria-hidden": "true" },
        el("i", { class: "fa-solid " + item.icon })),
      el("span", { class: "help-card__titletext" }, h(item.term)),
      el("i", { class: "fa-solid fa-link help-card__linkicon", "aria-hidden": "true" })
    ]);
    titleBtn.addEventListener("click", () => copyTileLink(item));
    const body = [
      el("h3", { class: "help-card__title" }, titleBtn),
      el("p", { class: "help-card__desc" }, h(item.how))
    ];
    if (steps.length) {
      body.push(el("p", { class: "help-card__steps-label" }, h("stepsLabel", "Step by step")));
      body.push(el("ol", { class: "help-card__steps" },
        steps.map((s) => el("li", { class: "help-card__step" }, s))));
    }
    return el("article", { class: "help-card", id: tileId(item) }, [
      el("div", { class: "help-card__media" }, media),
      el("div", { class: "help-card__body" }, body)
    ]);
  }

  // Stable DOM id for a section so the jump-nav can anchor to it.
  function secId(sec) { return "help-" + sec.head; }

  // Absolute deep link to a tile: strips any existing #hash/query so the copied
  // URL is clean (…/help.html#help-tile-tree).
  function tileLink(item) {
    const loc = global.location || {};
    const base = (loc.origin || "") + (loc.pathname || "help.html");
    return base + "#" + tileId(item);
  }

  // A tiny self-contained toast — help.html doesn't load app.js, so there's no
  // #toast-root and UI.toast would no-op. Creates its own root + node.
  function helpToast(msg) {
    let root = document.getElementById("help-toast-root");
    if (!root) {
      root = el("div", { id: "help-toast-root", class: "help-toast-root", "aria-live": "polite" });
      (document.body || document.getElementById("help-root")).appendChild(root);
    }
    const node = el("div", { class: "help-toast" }, [
      el("i", { class: "fa-solid fa-circle-check", "aria-hidden": "true" }),
      el("span", null, msg)
    ]);
    root.appendChild(node);
    // Enter on next frame so the transition runs; auto-dismiss after a beat.
    if (global.requestAnimationFrame) global.requestAnimationFrame(() => node.classList.add("is-in"));
    else node.classList.add("is-in");
    if (global.setTimeout) {
      global.setTimeout(() => node.classList.remove("is-in"), 2400);
      global.setTimeout(() => { if (node.parentNode) node.parentNode.removeChild(node); }, 2700);
    }
  }

  // Copy a tile's deep link to the clipboard, then toast. Falls back to a
  // temporary textarea + execCommand where the async Clipboard API is blocked
  // (older browsers, or a non-secure context).
  function copyTileLink(item) {
    const url = tileLink(item);
    const done = () => helpToast(h("copied", "Link copied") + " · " + h(item.term));
    const fail = () => { try { window.prompt(h("copyManual", "Copy this link:"), url); } catch (_) {} };
    // Reflect the target in the address bar first, so the page itself is now at
    // that anchor (nice when the user pastes vs. just navigates) — regardless of
    // which copy path below actually runs.
    try { if (global.history && history.replaceState) history.replaceState(null, "", "#" + tileId(item)); } catch (_) {}
    try {
      if (global.navigator && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, () => { if (!legacyCopy(url)) fail(); else done(); });
        return;
      }
    } catch (_) {}
    if (legacyCopy(url)) done(); else fail();
  }
  function legacyCopy(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      (document.body || document.documentElement).appendChild(ta);
      ta.select();
      const ok = document.execCommand && document.execCommand("copy");
      ta.remove();
      return !!ok;
    } catch (_) { return false; }
  }

  function section(sec) {
    return el("section", { class: "help-section", id: secId(sec) }, [
      el("h2", { class: "help-section__title" }, h(sec.head)),
      el("div", { class: "help-grid" }, sec.items.map(card))
    ]);
  }

  // ── Section FAB — the floating "menu" button food-delivery apps use ────────
  // A fixed pill at the bottom that always shows the section you're currently
  // reading; tap it to pop the full section list and jump anywhere. A scroll
  // spy keeps the label + the highlighted row in sync with what's on screen.
  let currentFab = null;       // latest FAB, for the shared document handlers
  let fabScrollHandler = null; // detached + reattached on each render
  let fabDocWired = false;     // document close-handlers attached once

  function buildFab() {
    const menu = el("ul", {
      class: "help-fab__menu", role: "menu",
      "aria-label": h("jumpLabel", "Jump to a section")
    }, SECTIONS.map((sec) => el("li", { role: "none" },
      el("button", {
        class: "help-fab__item", type: "button", role: "menuitem",
        "data-target": secId(sec)
      }, [
        el("i", { class: "fa-solid " + (sec.items[0] ? sec.items[0].icon : "fa-circle"), "aria-hidden": "true" }),
        el("span", null, h(sec.head))
      ]))));
    const current = el("span", { class: "help-fab__current" },
      SECTIONS.length ? h(SECTIONS[0].head) : "");
    const toggle = el("button", {
      class: "help-fab__toggle", type: "button",
      "aria-haspopup": "true", "aria-expanded": "false",
      "aria-label": h("jumpLabel", "Jump to a section")
    }, [
      el("i", { class: "fa-solid fa-layer-group help-fab__glyph", "aria-hidden": "true" }),
      current,
      el("i", { class: "fa-solid fa-chevron-up help-fab__caret", "aria-hidden": "true" })
    ]);
    const fab = el("div", { class: "help-fab", "data-open": "false" }, [menu, toggle]);
    fab._toggle = toggle; fab._menu = menu; fab._current = current;
    return fab;
  }

  function fabSetOpen(fab, open) {
    if (!fab) return;
    fab.setAttribute("data-open", open ? "true" : "false");
    if (fab._toggle) fab._toggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function wireFab(fab) {
    if (!fab) return;
    currentFab = fab;
    const toggle = fab._toggle, current = fab._current;
    const items = (fab._menu && fab._menu.querySelectorAll)
      ? fab._menu.querySelectorAll(".help-fab__item") : [];

    if (toggle && toggle.addEventListener) {
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        fabSetOpen(fab, fab.getAttribute("data-open") !== "true");
      });
    }
    (items.forEach ? items : []).forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-target");
        const target = id && document.getElementById(id);
        if (target && target.scrollIntoView) target.scrollIntoView({ behavior: "smooth", block: "start" });
        fabSetOpen(fab, false);
      });
    });

    // Highlight the given section id in the menu + mirror its name on the pill.
    function markActive(id) {
      (items.forEach ? items : []).forEach((btn) => {
        const on = btn.getAttribute("data-target") === id;
        if (btn.classList) btn.classList[on ? "add" : "remove"]("is-active");
      });
      const sec = SECTIONS.find((s) => secId(s) === id);
      if (sec && current) current.textContent = h(sec.head);
    }

    // Scroll-spy: the active section is the last one whose heading has scrolled
    // above a line ~30% down the viewport — the same feel as an app's sticky
    // category chip. rAF-throttled so scrolling stays smooth.
    let ticking = false;
    function computeActive() {
      ticking = false;
      const line = (global.innerHeight || 800) * 0.3;
      let activeId = SECTIONS.length ? secId(SECTIONS[0]) : null;
      for (const sec of SECTIONS) {
        const node = document.getElementById(secId(sec));
        if (!node || !node.getBoundingClientRect) continue;
        if (node.getBoundingClientRect().top <= line) activeId = secId(sec);
      }
      if (activeId) markActive(activeId);
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      (global.requestAnimationFrame || ((f) => f()))(computeActive);
    }
    if (typeof global.removeEventListener === "function" && fabScrollHandler) {
      global.removeEventListener("scroll", fabScrollHandler);
    }
    fabScrollHandler = onScroll;
    if (typeof global.addEventListener === "function") {
      global.addEventListener("scroll", onScroll, { passive: true });
    }
    computeActive();

    // Close on outside-click / Escape — one shared listener set, always acting
    // on the newest FAB (currentFab), so language re-renders don't stack them.
    if (!fabDocWired && typeof document.addEventListener === "function") {
      fabDocWired = true;
      document.addEventListener("click", (e) => {
        if (!currentFab || currentFab.getAttribute("data-open") !== "true") return;
        if (e.target && currentFab.contains && currentFab.contains(e.target)) return;
        fabSetOpen(currentFab, false);
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && currentFab && currentFab.getAttribute("data-open") === "true") {
          fabSetOpen(currentFab, false);
        }
      });
    }
  }

  function render() {
    const mount = document.getElementById("help-root");
    if (!mount) return;

    // <title> tracks the language so a shared/bookmarked link reads right.
    document.title = h("title", "How Virasat works") + " — " + t("app.title", "Virasat");

    while (mount.firstChild) mount.removeChild(mount.firstChild);

    // Bar: home link (logo + wordmark) on the left; the same lang/theme chrome
    // the app + legal pages use on the right, so choices carry across.
    const home = el("a", { class: "legal-page__home", href: "./", "aria-label": t("app.title", "Virasat") }, [
      el("img", { class: "legal-page__logo", src: "assets/icon.svg", alt: "", width: "32", height: "32" }),
      el("span", { class: "legal-page__brand" }, t("app.title", "Virasat"))
    ]);
    const chrome = (global.UI && UI.onboardChrome) ? UI.onboardChrome() : null;
    mount.appendChild(el("header", { class: "legal-page__bar help-page__bar" }, [home, chrome]));

    // Hero: eyebrow + title + lede (the modal's intro copy).
    mount.appendChild(el("header", { class: "help-hero" }, [
      el("p", { class: "help-hero__eyebrow" }, h("eyebrow", "Complete guide")),
      el("h1", { class: "legal-page__title help-hero__title" }, h("title", "How Virasat works")),
      el("p", { class: "help-hero__lede" }, h("intro"))
    ]));

    // Quick start — three numbered steps.
    mount.appendChild(el("section", { class: "help-start" }, [
      el("h2", { class: "help-section__title" }, h("start", "Get started in three steps")),
      el("ol", { class: "help-steps" }, STEPS.map((s) => el("li", { class: "help-steps__item" }, h(s))))
    ]));

    // The feature sections.
    SECTIONS.forEach((sec) => mount.appendChild(section(sec)));

    // Footer: back to the app.
    mount.appendChild(el("footer", { class: "legal-page__foot help-page__foot" }, [
      el("nav", { class: "landing__foot-nav", "aria-label": t("landing.footNavLabel", "About and legal") }, [
        el("a", { class: "landing__foot-link", href: "./" }, t("landing.legalBack", "Back to Virasat"))
      ])
    ]));

    // Floating section switcher (food-delivery-style menu FAB). Appended last
    // and wired after the sections exist, so the scroll-spy can find them.
    const fab = buildFab();
    mount.appendChild(fab);
    wireFab(fab);

    // Honour a deep link (help.html#tree, #this-is-me, …) once the DOM exists.
    flashFromHash();
  }

  // Deep-link + highlight: scroll to the element named by location.hash and
  // pulse it. Works for both a section id (help-secViews) and a tile id
  // (help-tile-tree). A short delay lets layout settle after a (re)render.
  let flashTimer = null;
  function flashTarget(id) {
    if (!id) return;
    const node = document.getElementById(id);
    if (!node) return;
    if (node.scrollIntoView) node.scrollIntoView({ behavior: "smooth", block: "start" });
    // Only tiles carry the flash treatment; a section just scrolls into view.
    if (node.classList && /(^|\s)help-card(\s|$)/.test(node.className || "")) {
      node.classList.remove("is-flash");
      // Force reflow so re-adding the class restarts the animation on repeat
      // clicks of the same link. Guarded for the headless shim.
      void (node.offsetWidth || 0);
      node.classList.add("is-flash");
      if (flashTimer && global.clearTimeout) global.clearTimeout(flashTimer);
      if (global.setTimeout) {
        flashTimer = global.setTimeout(() => {
          if (node.classList) node.classList.remove("is-flash");
        }, 2600);
      }
    }
  }
  function flashFromHash() {
    const hash = (global.location && global.location.hash || "").replace(/^#/, "");
    if (!hash) return;
    // Defer so the freshly-rendered nodes are laid out before we scroll.
    if (global.setTimeout) global.setTimeout(() => flashTarget(hash), 60);
    else flashTarget(hash);
  }

  // Re-render on language change — the onboard chrome's EN/HI pills fire this.
  if (global.I18n && typeof I18n.onChange === "function") I18n.onChange(render);

  // React to hash changes while the page is open (clicking an in-page anchor,
  // pasting a #slug, or Back/Forward between tiles).
  if (typeof global.addEventListener === "function") {
    global.addEventListener("hashchange", flashFromHash);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();

  global.HelpPage = { render, flashTarget };
})(window);
