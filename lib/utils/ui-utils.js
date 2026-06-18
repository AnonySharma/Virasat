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
        else if (k === "html") node.innerHTML = attrs[k];
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

  function openModal({ title, body, footer, onClose }) {
    const root = document.getElementById("modal-root");
    clear(root);
    root.setAttribute("aria-hidden", "false");

    // Save the element that was focused before the modal opened so we can
    // restore focus to it on close — keyboard / screen-reader users land
    // back where they were instead of at the document root.
    const previousFocus = document.activeElement;

    const close = () => {
      root.setAttribute("aria-hidden", "true");
      clear(root);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      if (typeof onClose === "function") onClose();
      if (previousFocus && typeof previousFocus.focus === "function") {
        try { previousFocus.focus(); } catch (_) { /* element may be gone */ }
      }
    };

    const onKey = (e) => {
      if (e.key === "Escape") { close(); return; }
      if (e.key !== "Tab") return;
      // Trap Tab inside the modal so focus can't escape to the (now-hidden)
      // background.
      const focusables = Array.from(modal.querySelectorAll(FOCUSABLE_SELECTOR))
        .filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusables.length === 0) { e.preventDefault(); return; }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
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
        el("button", { class: "modal__close", "aria-label": "Close", type: "button", onclick: close }, "✕")
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

  function confirm({ title, message, confirmLabel = "Confirm", danger = false }) {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (v) => { if (!settled) { settled = true; resolve(v); } };
      const dlg = openModal({
        title: title || "Are you sure?",
        body: el("p", { style: { color: "var(--ink-2)", margin: 0 } }, message || ""),
        footer: [
          el("button", { class: "btn btn--ghost", type: "button", onclick: () => { settle(false); dlg.close(); } }, "Cancel"),
          el("button", { class: "btn " + (danger ? "btn--danger" : "btn--primary"), type: "button", onclick: () => { settle(true); dlg.close(); } }, confirmLabel)
        ],
        onClose: () => settle(false)
      });
    });
  }

  function field(label, control, hint) {
    return el("label", { class: "field" }, [
      el("span", { class: "field__label" }, label),
      control,
      hint ? el("span", { class: "field__hint" }, hint) : null
    ]);
  }

  function downloadFile(filename, content, mime = "application/json") {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
  }

  global.UI = { el, clear, avatar, toast, openModal, confirm, field, downloadFile, pastelFor };
})(window);
