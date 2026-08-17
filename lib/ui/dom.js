// @ts-check
/* Tiny DOM/UI helpers shared across views. */
(function (global) {
  "use strict";

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === "class") node.className = attrs[k];
        else if (k === "style" && typeof attrs[k] === "object") Object.assign(node.style, attrs[k]);
        else if (k === "dataset") Object.assign(node.dataset, attrs[k]);
        else if (k.startsWith("on") && typeof attrs[k] === "function") node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        // The previous `html` attribute set node.innerHTML — unused but a
        // quiet XSS trap if a future contributor reached for it. Removed.
        // For text content, pass children; for actual HTML construction,
        // build child nodes via UI.el and append.
        else if (attrs[k] === true) node.setAttribute(k, "");
        else if (attrs[k] !== false && attrs[k] != null) node.setAttribute(k, attrs[k]);
      }
    }
    if (children != null) {
      const arr = Array.isArray(children) ? children : [children];
      arr.forEach((c) => {
        if (c == null || c === false) return;
        node.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
      });
    }
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  // Generic numeric clamp. Three modules used to define this privately
  // (crop-editor, heritage-datepicker, timeline-view); centralised here
  // so a future tweak (e.g. clamp(NaN) handling) lands in one place.
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // Stable pastel class based on the person's name — same person always gets
  // the same colour so the visual identity is consistent across views.
  const PASTEL_CLASSES = ["peach","sage","lavender","sky","rose","butter","clay","mist"];
  function pastelFor(person) {
    if (!person) return "mist";
    const s = String(person.name || person.id || "?");
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return PASTEL_CLASSES[Math.abs(h) % PASTEL_CLASSES.length];
  }

  function avatar(person, size = "md") {
    const sizeCls = size === "xl" ? " avatar--xl"
      : size === "lg" ? " avatar--lg"
      : size === "sm" ? " avatar--sm"
      : size === "xs" ? " avatar--xs" : " avatar--md";
    const tone = " avatar--" + pastelFor(person);
    const cls = "avatar" + sizeCls + tone
      + (person && person.deathDate ? " avatar--deceased" : "");
    const wrap = el("span", { class: cls, "aria-hidden": "true" });
    const url = window.PhotoStore ? PhotoStore.getUrlSync(person) : (person && person.photo);
    const displayName = person ? (FamilyStore.getField(person, "name") || person.name) : "?";
    const cropAv = person && person.photoCropAvatar;
    function applyAvatarCrop(img) {
      if (!cropAv) return;
      img.style.objectPosition = (cropAv.x ?? 50) + "% " + (cropAv.y ?? 50) + "%";
      const s = Math.max(1, cropAv.scale || 1);
      if (s > 1.001) img.style.transform = "scale(" + s + ")";
    }
    if (url) {
      const img = el("img", { src: url, alt: "" });
      applyAvatarCrop(img);
      wrap.appendChild(img);
    } else if (person && (person.photoId || person.photo) && window.PhotoStore) {
      // Resolve async, swap in
      const img = el("img", { src: "", alt: "" });
      applyAvatarCrop(img);
      wrap.appendChild(img);
      PhotoStore.getUrl(person).then((u) => {
        if (u) img.src = u;
        else { wrap.removeChild(img); wrap.textContent = FamilyStore.initials(displayName); }
      }).catch(() => { if (wrap.contains(img)) wrap.removeChild(img); wrap.textContent = FamilyStore.initials(displayName); });
    } else {
      wrap.textContent = FamilyStore.initials(displayName);
    }
    return wrap;
  }

  function toast(msg, kind) {
    const root = document.getElementById("toast-root");
    if (!root) return;
    const t = el("div", { class: "toast" + (kind ? " toast--" + kind : "") }, msg);
    root.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity 200ms"; }, 2400);
    setTimeout(() => t.remove(), 2700);
  }

  // Selector for elements considered focusable inside a modal. Used to wrap
  // Tab / Shift+Tab so focus stays inside the dialog while it's open.
  const FOCUSABLE_SELECTOR = [
    "a[href]", "button:not([disabled])", "input:not([disabled])",
    "select:not([disabled])", "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])"
  ].join(",");

  /**
   * @param {object} opts
   * @param {string} [opts.title]
   * @param {Node|null} [opts.body]
   * @param {Array<Node|null>} [opts.footer]
   * @param {() => void} [opts.onClose]
   * @param {() => boolean} [opts.beforeClose] Return false to VETO a close
   *   (Escape / backdrop / X / caller close()). Used for unsaved-changes guards:
   *   the veto can kick off an async confirm and re-invoke close() once resolved.
   * @param {() => void} [opts.onEnter] Enter-to-submit. When set, pressing Enter
   *   while focus is in a single-line text input inside the modal calls this
   *   (typically `() => saveBtn.click()`). Never fires from a textarea, a
   *   button/checkbox/radio, a portaled popover, or the date picker's own input
   *   (which commits on Enter itself) — so it's safe on forms with those fields.
   */
  function openModal({ title, body, footer, onClose, beforeClose, onEnter }) {
    const root = document.getElementById("modal-root");
    // #modal-root is a static element in index.html, so this is defensive
    // only — but returning a no-op handle beats throwing a raw null deref if
    // the shell ever loads without it (e.g. a partial/embedded mount).
    if (!root) return { close() {}, modal: null };
    // NB: we do NOT clear(root) here. Modals stack — opening a second modal
    // (e.g. the Reframe crop editor from inside the person form) must not
    // destroy the one beneath it. Each backdrop is position:fixed inset:0
    // with the same z-index, so a later DOM sibling paints on top; closing
    // one removes only its own backdrop and reveals whatever was below.
    root.setAttribute("aria-hidden", "false");

    // Save the element that was focused before the modal opened so we can
    // restore focus to it on close — keyboard / screen-reader users land
    // back where they were instead of at the document root. When stacking,
    // this is naturally the element in the modal below, so closing the top
    // modal returns focus into its parent.
    const previousFocus = /** @type {HTMLElement | null} */ (document.activeElement);

    let closed = false;
    const close = (force) => {
      if (closed) return;          // idempotent: backdrop-click, X, Esc, and
      // Unsaved-changes guard: beforeClose() returning false vetoes this close.
      // The guard typically opens an async confirm and, if the user agrees,
      // re-calls close(true) to bypass itself. force===true skips the check.
      if (force !== true && typeof beforeClose === "function" && beforeClose() === false) return;
      closed = true;               // caller-invoked close() can all race here.
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      // Only tear down the page-level modal state once the LAST modal closes;
      // otherwise dismissing an inner modal would un-scroll-lock the body and
      // un-hide the root while an outer modal is still open.
      if (!root.firstElementChild) {
        root.setAttribute("aria-hidden", "true");
        document.body.style.overflow = "";
      }
      if (typeof onClose === "function") onClose();
      if (previousFocus && typeof previousFocus.focus === "function") {
        try { previousFocus.focus(); } catch (_) { /* element may be gone */ }
      }
    };

    const onKey = (e) => {
      // Only the topmost modal responds to keys — the last backdrop in the
      // root is the one on top. Without this guard a stacked-under modal
      // would also fire Escape (closing two at once) and run a competing
      // focus-trap on Tab.
      if (root.lastElementChild !== backdrop) return;
      if (e.key === "Escape") { close(); return; }
      // Enter-to-submit (opt-in via onEnter). Fire only from a single-line text
      // input inside the modal — never a textarea (multi-line), a button/select
      // (their own Enter semantics), a portaled popover, or the date picker's
      // input (it commits the typed date on Enter itself). IME composition
      // (isComposing) must pass through so Hindi/CJK entry isn't cut off.
      if (e.key === "Enter" && typeof onEnter === "function" && !e.isComposing) {
        const a = /** @type {HTMLElement|null} */ (document.activeElement);
        if (a && modal.contains(a) && a.tagName === "INPUT") {
          const type = (a.getAttribute("type") || "text").toLowerCase();
          const singleLine = type !== "checkbox" && type !== "radio" && type !== "button" && type !== "submit";
          const inPopover = a.closest && a.closest(".hdp, .hsel__menu, .modal-portal-exempt");
          if (singleLine && !inPopover) { e.preventDefault(); onEnter(); return; }
        }
      }
      if (e.key !== "Tab") return;
      // Skip the trap when focus has landed inside a portaled popover —
      // heritage date picker / heritage select dropdowns mount to body for
      // z-index stacking and are technically outside the modal subtree.
      // Forcing focus back to the modal would break their keyboard nav.
      const active = document.activeElement;
      if (active && active.closest && active.closest(".hdp__popover, .hsel__menu, .modal-portal-exempt")) {
        return;
      }
      // Trap Tab inside the modal so focus can't escape to the (now-hidden)
      // background.
      const focusables = Array.from(modal.querySelectorAll(FOCUSABLE_SELECTOR))
        .filter((el) => el.offsetParent !== null || el === active);
      if (focusables.length === 0) { e.preventDefault(); return; }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && (active === first || !modal.contains(active))) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && (active === last || !modal.contains(active))) {
        e.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";

    const modal = el("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title || "Dialog", tabindex: "-1" }, [
      el("div", { class: "modal__header" }, [
        el("h2", { class: "modal__title" }, title || ""),
        el("button", { class: "modal__close", "aria-label": (window.I18n ? I18n.t("actions.close") : "Close"), type: "button", onclick: close }, [
          el("i", { class: "fa-solid fa-xmark", "aria-hidden": "true" })
        ])
      ]),
      el("div", { class: "modal__body" }, [body]),
      footer ? el("div", { class: "modal__footer" }, footer) : null
    ]);

    const backdrop = el("div", { class: "modal-backdrop", onclick: (e) => { if (e.target === backdrop) close(); } }, [modal]);
    root.appendChild(backdrop);

    // Move focus into the modal: prefer the first focusable in the body
    // (text input, save button), fall back to the modal container itself.
    setTimeout(() => {
      const first = modal.querySelector(".modal__body " + FOCUSABLE_SELECTOR)
        || modal.querySelector(FOCUSABLE_SELECTOR);
      if (first && typeof first.focus === "function") first.focus();
      else modal.focus();
    }, 0);

    return { close, modal };
  }

  /**
   * @param {object} opts
   * @param {string} [opts.title]
   * @param {string} [opts.message]
   * @param {string} [opts.confirmLabel]
   * @param {string} [opts.cancelLabel]
   * @param {boolean} [opts.danger]
   */
  function confirm({ title, message, confirmLabel = "Confirm", cancelLabel, danger = false }) {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (v) => { if (!settled) { settled = true; resolve(v); } };
      const dlg = openModal({
        title: title || "Are you sure?",
        body: el("p", { style: { color: "var(--ink-2)", margin: 0 } }, message || ""),
        footer: [
          el("button", { class: "btn btn--ghost", type: "button", onclick: () => { settle(false); dlg.close(); } }, [
            el("span", null, cancelLabel || (window.I18n ? I18n.t("actions.cancel") : "Cancel"))
          ]),
          el("button", { class: "btn " + (danger ? "btn--danger" : "btn--primary"), type: "button", onclick: () => { settle(true); dlg.close(); } }, [
            el("i", { class: danger ? "fa-solid fa-trash-can" : "fa-solid fa-check", "aria-hidden": "true" }),
            el("span", null, confirmLabel)
          ])
        ],
        onClose: () => settle(false)
      });
    });
  }

  // Six views need a "nothing here" panel — same icon-title-text-cta shape
  // every time. Centralise so the visual identity stays uniform when we
  // iterate on the empty-state design.
  //   icon:   FA class string, e.g. "fa-solid fa-seedling"
  //   title:  string (optional)
  //   text:   string (optional)
  //   cta:    { label, onClick, icon?, kind? "primary" | "ghost", style? }
  //   style:  inline overrides on the .empty wrapper (used by tree overlay)
  /**
   * @param {object} opts
   * @param {string} [opts.icon]
   * @param {string} [opts.title]
   * @param {string} [opts.text]
   * @param {{ label: string, onClick?: Function, icon?: string, kind?: string, style?: object }} [opts.cta]
   * @param {object} [opts.style]
   */
  function emptyState({ icon, title, text, cta, style }) {
    const attrs = { class: "empty" };
    if (style) attrs.style = style;
    const children = [
      icon ? el("div", { class: "empty__icon", "aria-hidden": "true" }, [
        el("i", { class: icon })
      ]) : null,
      title ? el("div", { class: "empty__title" }, title) : null,
      text ? el("div", { class: "empty__text" }, text) : null
    ];
    if (cta) {
      const kind = cta.kind === "ghost" ? "btn--ghost" : "btn--primary";
      const btnAttrs = { class: "btn " + kind, type: "button", onclick: cta.onClick };
      if (cta.style) btnAttrs.style = cta.style;
      const btnChildren = [];
      if (cta.icon) btnChildren.push(el("i", { class: cta.icon, "aria-hidden": "true" }));
      btnChildren.push(el("span", null, cta.label));
      children.push(el("button", btnAttrs, btnChildren));
    }
    return el("div", attrs, children);
  }

  // Modal-footer button factories. Every modal in the app builds a Cancel
  // + Save pair the same way. Centralise so the affordance set is uniform.
  // Callers attach .addEventListener("click", ...) themselves so the button
  // is owned by the close-and-validate flow specific to each modal.
  //
  // No icon on Cancel — the modal already shows a visible × close button
  // in the header, and a duplicate × glyph on the footer reads as
  // redundant. This is the one bare-text dialog button in the codebase
  // by design (caught and called out 2026-06-19); the rest still follow
  // the "every button has an icon" rule.
  function cancelBtn(label) {
    return el("button", { class: "btn btn--ghost", type: "button" }, [
      el("span", null, label || (window.I18n ? I18n.t("actions.cancel") : "Cancel"))
    ]);
  }
  function saveBtn(label, opts) {
    const o = opts || {};
    const icon = o.icon || "fa-solid fa-floppy-disk";
    const kind = o.danger ? "btn--danger" : "btn--primary";
    return el("button", { class: "btn " + kind, type: "button" }, [
      el("i", { class: icon, "aria-hidden": "true" }),
      el("span", null, label || (window.I18n ? I18n.t("actions.save") : "Save"))
    ]);
  }

  function field(label, control, hint) {
    return el("label", { class: "field" }, [
      el("span", { class: "field__label" }, label),
      control,
      hint ? el("span", { class: "field__hint" }, hint) : null
    ]);
  }

  // Onboarding chrome — the small lang + theme cluster shown on the sign-in,
  // landing, and first-run screens (all of which render BEFORE app.js reveals
  // the header, so the header's own toggles are unreachable behind the overlay).
  // Both screens need the identical affordance, so it lives here once.
  //
  // Theme parity note: mirrors app.js's applyTheme — same "virasat.theme" key
  // and same data-theme attribute — and also syncs the (hidden) header toggle
  // so the app shell is already correct the instant it's revealed. Lang uses
  // I18n.setLang directly (which persists + applyToDOM re-translates every
  // [data-i18n] node on these screens, so the copy updates live).
  const ONBOARD_THEME_KEY = "virasat.theme";
  const ONBOARD_CONTRAST_KEY = "virasat.contrast";
  function onboardChrome() {
    const tt = (k, f) => {
      if (window.I18n && typeof I18n.t === "function") { const v = I18n.t(k); if (v && v !== k) return v; }
      return f;
    };

    // Theme toggle — mirrors app.js's applyTheme (same "virasat.theme" key +
    // data-theme attribute). paint() sweeps EVERY .theme-toggle in the document
    // (any sibling chrome instance — the sign-in screen mounts one on the
    // landing AND one on the card — plus the hidden header toggle) so they never
    // diverge and the shell is already correct when revealed. themeBtn is swept
    // explicitly too since it isn't in the document yet at creation time.
    const themeBtn = el("button", {
      class: "theme-toggle btn--icon", type: "button",
      "aria-label": tt("actions.theme", "Theme"), title: tt("actions.theme", "Theme")
    }, [
      el("i", { class: "fa-solid fa-moon theme-toggle__moon", "aria-hidden": "true" }),
      el("i", { class: "fa-solid fa-sun theme-toggle__sun", "aria-hidden": "true" })
    ]);
    function paintTheme() {
      const dark = document.documentElement.getAttribute("data-theme") === "dark";
      const mark = (b) => {
        b.classList.toggle("is-dark", dark);
        b.setAttribute("aria-pressed", dark ? "true" : "false");
      };
      document.querySelectorAll(".theme-toggle").forEach(mark);
      mark(themeBtn);
    }
    themeBtn.addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      if (next === "dark") document.documentElement.setAttribute("data-theme", "dark");
      else document.documentElement.removeAttribute("data-theme");
      try { localStorage.setItem(ONBOARD_THEME_KEY, next); } catch (_) {}
      paintTheme();
    });
    paintTheme();

    // Contrast toggle — a low-vision visitor needs this on the sign-in / landing
    // screens too, before the header exists. Mirrors app.js's applyContrast
    // (same "virasat.contrast" key + data-contrast attribute) and sweeps every
    // .contrast-toggle (the sibling chrome instance + the hidden header one).
    const contrastBtn = el("button", {
      class: "theme-toggle contrast-toggle btn--icon", type: "button",
      "aria-pressed": "false",
      "aria-label": tt("actions.contrast", "High contrast"), title: tt("actions.contrast", "High contrast")
    }, [
      el("i", { class: "fa-solid fa-circle-half-stroke", "aria-hidden": "true" })
    ]);
    function paintContrast() {
      const on = document.documentElement.getAttribute("data-contrast") === "high";
      const mark = (b) => {
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      };
      document.querySelectorAll(".contrast-toggle").forEach(mark);
      mark(contrastBtn);
    }
    contrastBtn.addEventListener("click", () => {
      const on = document.documentElement.getAttribute("data-contrast") !== "high";
      if (on) document.documentElement.setAttribute("data-contrast", "high");
      else document.documentElement.removeAttribute("data-contrast");
      try { localStorage.setItem(ONBOARD_CONTRAST_KEY, on ? "high" : "normal"); } catch (_) {}
      paintContrast();
    });
    paintContrast();

    // Lang switch — pills that call I18n.setLang (which persists + applyToDOM
    // re-translates every [data-i18n] node on these screens live). Same
    // document-wide sweep so all instances + the header pills stay in sync.
    const langWrap = el("div", { class: "lang-switch", role: "group", "aria-label": tt("actions.language", "Language") });
    function paintLang() {
      const cur = window.I18n ? I18n.getLang() : "en";
      const mark = (b) => {
        const active = /** @type {HTMLElement} */ (b).dataset.lang === cur;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-pressed", active ? "true" : "false");
      };
      document.querySelectorAll(".lang-switch__btn").forEach(mark);
      langWrap.querySelectorAll(".lang-switch__btn").forEach(mark);
    }
    [["en", "EN", "English"], ["hi", "HI", "हिन्दी"]].forEach(([code, label, aria]) => {
      const b = el("button", { class: "lang-switch__btn", type: "button", "aria-label": aria, dataset: { lang: code } }, label);
      b.addEventListener("click", () => { if (window.I18n) I18n.setLang(code); paintLang(); });
      langWrap.appendChild(b);
    });
    paintLang();

    return el("div", { class: "onboard-chrome" }, [themeBtn, contrastBtn, langWrap]);
  }

  // Trigger a browser download of `content` as `filename`. `content` may be a
  // string (wrapped in a Blob using `mime`) or an already-built Blob, which is
  // used as-is — image-export passes a canvas Blob straight through, text
  // exporters pass a JSON/CSV string. The object URL is revoked after the click.
  function downloadFile(filename, content, mime = "application/json") {
    const blob = (typeof Blob !== "undefined" && content instanceof Blob)
      ? content
      : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
  }

  // Copy text to the clipboard, resolving true on success / false on failure.
  // Prefers the async Clipboard API, then a hidden-textarea + execCommand path
  // for older browsers or non-secure contexts (where clipboard is undefined or
  // rejects). Callers own their own feedback (toast, button flash, manual-copy
  // prompt) — this only does the copy and reports whether it worked. Replaces
  // three near-identical copy+fallback reimplementations (help-page copyTileLink,
  // sharing copyLink, collect-form copyJson).
  function legacyCopyText(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.opacity = "0";
      (document.body || document.documentElement).appendChild(ta);
      ta.select();
      const ok = !!(document.execCommand && document.execCommand("copy"));
      ta.remove();
      return ok;
    } catch (_) { return false; }
  }
  function copyText(text) {
    const str = String(text == null ? "" : text);
    try {
      if (window.navigator && navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(str).then(
          () => true,
          () => legacyCopyText(str)
        );
      }
    } catch (_) { /* fall through to the sync path */ }
    return Promise.resolve(legacyCopyText(str));
  }

  // Render an array of already-translated paragraph strings into legal/about
  // prose nodes. Authoring convention (kept flat so the copy lives as one i18n
  // array): a line starting "• " becomes a bullet in a shared <ul>; a line
  // ending ":" reads as a small heading; anything else is a paragraph. Shared
  // by the landing footer's Privacy/Terms/About modals, the in-app About route,
  // and the standalone privacy.html / terms.html pages so all four render the
  // exact same source identically. Returns an array of nodes.
  function legalProse(paragraphs) {
    const out = [];
    let ul = null;
    (paragraphs || []).forEach((line) => {
      if (typeof line !== "string") return;
      if (line.indexOf("• ") === 0) {
        if (!ul) { ul = el("ul", { class: "legal__list" }, []); out.push(ul); }
        ul.appendChild(el("li", null, line.slice(2)));
      } else {
        ul = null;
        if (/:$/.test(line)) out.push(el("h3", { class: "legal__h" }, line));
        else out.push(el("p", { class: "legal__p" }, line));
      }
    });
    return out;
  }

  global.UI = { el, clear, clamp, avatar, toast, openModal, confirm, emptyState, cancelBtn, saveBtn, field, onboardChrome, downloadFile, copyText, legalProse, pastelFor };
})(window);
