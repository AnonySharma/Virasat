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
      { icon: "fa-sitemap",        term: "tree",      how: "treeHow",      img: null },
      { icon: "fa-id-card-clip",   term: "people",    how: "peopleHow",    img: null },
      { icon: "fa-timeline",       term: "timeline",  how: "timelineHow",  img: null },
      { icon: "fa-chart-simple",   term: "insights",  how: "insightsHow",  img: null },
      { icon: "fa-address-card",   term: "inspector", how: "inspectorHow", img: null }
    ] },
    { head: "secBuild", items: [
      { icon: "fa-user-plus",      term: "add",     how: "addHow",     img: null },
      { icon: "fa-users-gear",     term: "manage",  how: "manageHow",  img: null },
      { icon: "fa-link",           term: "link",    how: "linkHow",    img: null },
      { icon: "fa-image",          term: "photos",  how: "photosHow",  img: null },
      { icon: "fa-book-open",      term: "stories", how: "storiesHow", img: null }
    ] },
    { head: "secFind", items: [
      { icon: "fa-magnifying-glass", term: "search",   how: "searchHow",   img: null },
      { icon: "fa-filter",           term: "filter",   how: "filterHow",   img: null },
      { icon: "fa-diagram-project",  term: "relation", how: "relationHow", img: null }
    ] },
    { head: "secShare", items: [
      { icon: "fa-book",            term: "print",   how: "printHow",   img: null },
      { icon: "fa-file-arrow-down", term: "backup",  how: "backupHow",  img: null },
      { icon: "fa-clipboard-list",  term: "collect", how: "collectHow", img: null }
    ] },
    { head: "secAccount", items: [
      { icon: "fa-code-branch",     term: "trees",  how: "treesHow",  img: null },
      { icon: "fa-user-group",      term: "invite", how: "inviteHow", img: null },
      { icon: "fa-cloud-arrow-up",  term: "sync",   how: "syncHow",   img: null }
    ] },
    { head: "secTips", items: [
      { icon: "fa-language",             term: "language", how: "languageHow", img: null },
      { icon: "fa-circle-half-stroke",   term: "theme",    how: "themeHow",    img: null },
      { icon: "fa-wifi",                 term: "offline",  how: "offlineHow",  img: null },
      { icon: "fa-arrow-right-arrow-left", term: "navigate", how: "navigateHow", img: null }
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

  // A feature card: screenshot (or placeholder) + icon, title, description.
  function card(item) {
    const media = item.img
      ? el("img", { class: "help-card__shot", src: item.img, alt: h(item.term), loading: "lazy" })
      : el("div", { class: "help-card__ph", role: "img", "aria-label": h("imgSoon", "Screenshot coming soon") }, [
          el("i", { class: "fa-solid fa-image help-card__ph-icon", "aria-hidden": "true" }),
          el("span", { class: "help-card__ph-cap" }, h("imgSoon", "Screenshot coming soon"))
        ]);
    return el("article", { class: "help-card" }, [
      el("div", { class: "help-card__media" }, media),
      el("div", { class: "help-card__body" }, [
        el("h3", { class: "help-card__title" }, [
          el("i", { class: "fa-solid " + item.icon + " help-card__icon", "aria-hidden": "true" }),
          el("span", null, h(item.term))
        ]),
        el("p", { class: "help-card__desc" }, h(item.how))
      ])
    ]);
  }

  function section(sec) {
    return el("section", { class: "help-section" }, [
      el("h2", { class: "help-section__title" }, h(sec.head)),
      el("div", { class: "help-grid" }, sec.items.map(card))
    ]);
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
  }

  // Re-render on language change — the onboard chrome's EN/HI pills fire this.
  if (global.I18n && typeof I18n.onChange === "function") I18n.onChange(render);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();

  global.HelpPage = { render };
})(window);
