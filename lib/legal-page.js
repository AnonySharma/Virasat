// @ts-check
/**
 * Standalone legal-page bootstrap — powers privacy.html and terms.html.
 *
 * These are the two canonical, PUBLIC, no-login pages Virasat needs real URLs
 * for: Google's OAuth consent screen (and app-store style listings) require a
 * privacy policy and terms link that resolve to a plain web page, not an
 * in-app modal behind a sign-in gate. So Privacy + Terms live at
 * /privacy.html and /terms.html, while Help + About — which only make sense
 * inside a running tree — stay in-app (#help / #about).
 *
 * Content is NOT duplicated here. The same i18n arrays that feed the in-app
 * About/legal modals (landing.privacyBody / landing.termsBody) are rendered
 * through the shared UI.legalProse, so there is exactly one source of truth per
 * language and the standalone page and the modal never drift apart.
 *
 * The host page declares which page it is via <body data-legal-page="privacy">.
 * Depends only on I18n + UI (dom.js) — no app.js, no cloud SDK, no session — so
 * it boots instantly and works for a signed-out visitor arriving straight from
 * an OAuth consent screen.
 */
(function (global) {
  "use strict";

  // page-key → i18n keys for the <title>/<h1> and the body array, plus English
  // fallbacks used only if I18n failed to load entirely (t() returns arrays
  // verbatim, so the real content is always the translated array).
  const PAGES = {
    privacy: {
      titleKey: "landing.privacyPageTitle", titleFb: "Privacy Policy",
      bodyKey: "landing.privacyBody",
      bodyFb: ["Your family's data is yours and is never sold. A tree is visible only to the people you invite; photo location metadata is stripped before saving."]
    },
    terms: {
      titleKey: "landing.termsTitle", titleFb: "Terms of Service",
      bodyKey: "landing.termsBody",
      bodyFb: ["By creating an account you agree to use Virasat lawfully. Your content stays yours; the service is provided “as is.”"]
    }
  };

  function whichPage() {
    const attr = document.body && document.body.getAttribute("data-legal-page");
    return (attr && PAGES[attr]) ? attr : "privacy";
  }

  // Translate with an English fallback for the impossible no-I18n case.
  function t(key, fb) {
    if (global.I18n && typeof I18n.t === "function") { const v = I18n.t(key); if (v && v !== key) return v; }
    return fb;
  }

  function bodyLines(page) {
    const fromI18n = (global.I18n && typeof I18n.t === "function") ? I18n.t(page.bodyKey) : null;
    return Array.isArray(fromI18n) ? fromI18n : page.bodyFb;
  }

  // Prefer the shared DOM builder; fall back so a partial load still renders.
  function el(tag, attrs, kids) {
    if (global.UI && typeof UI.el === "function") return UI.el(tag, attrs, kids);
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) { if (k === "class") n.className = attrs[k]; else n.setAttribute(k, attrs[k]); }
    (Array.isArray(kids) ? kids : [kids]).forEach((k) => { if (k != null) n.appendChild(k.nodeType ? k : document.createTextNode(String(k))); });
    return n;
  }

  function prose(lines) {
    if (global.UI && typeof UI.legalProse === "function") return UI.legalProse(lines);
    return (lines || []).map((line) => el("p", { class: "legal__p" }, line));
  }

  function render() {
    const mount = document.getElementById("legal-root");
    if (!mount) return;
    const pageKey = whichPage();
    const page = PAGES[pageKey];

    // <title> tracks the language so a shared/bookmarked link reads right.
    document.title = t(page.titleKey, page.titleFb) + " — " + t("app.title", "Virasat");

    while (mount.firstChild) mount.removeChild(mount.firstChild);

    // Bar: home link (logo + wordmark) on the left; the same lang/theme chrome
    // the app uses on the right, so language + theme choices carry across.
    const home = el("a", { class: "legal-page__home", href: "./", "aria-label": t("app.title", "Virasat") }, [
      el("img", { class: "legal-page__logo", src: "assets/icon.svg", alt: "", width: "32", height: "32" }),
      el("span", { class: "legal-page__brand" }, t("app.title", "Virasat"))
    ]);
    const chrome = (global.UI && UI.onboardChrome) ? UI.onboardChrome() : null;
    mount.appendChild(el("header", { class: "legal-page__bar" }, [home, chrome]));

    // The prose itself, under an <h1> — reuses the .legal styles the modals use.
    mount.appendChild(el("article", { class: "legal legal-page__body" },
      [el("h1", { class: "legal-page__title" }, t(page.titleKey, page.titleFb))].concat(prose(bodyLines(page)))));

    // Footer: back to the app + a cross-link to the sibling legal page.
    const otherKey = pageKey === "privacy" ? "terms" : "privacy";
    mount.appendChild(el("footer", { class: "legal-page__foot" }, [
      el("nav", { class: "landing__foot-nav", "aria-label": t("landing.footNavLabel", "About and legal") }, [
        el("a", { class: "landing__foot-link", href: "./" }, t("landing.legalBack", "Back to Virasat")),
        el("span", { class: "landing__foot-dot", "aria-hidden": "true" }, "·"),
        // Sibling legal page opens in a new tab (matches how the app links out
        // to these pages); "Back to Virasat" above stays same-tab on purpose.
        el("a", { class: "landing__foot-link", href: otherKey + ".html", target: "_blank", rel: "noopener" }, t(PAGES[otherKey].titleKey, PAGES[otherKey].titleFb))
      ])
    ]));
  }

  // Re-render on language change — the onboard chrome's EN/HI pills fire this,
  // so the whole page (title, heading, body, links) swaps language live.
  if (global.I18n && typeof I18n.onChange === "function") I18n.onChange(render);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();

  global.LegalPage = { render };
})(window);
