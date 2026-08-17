// @ts-nocheck
/**
 * TEMPORARY — Hindi (Devanagari) font lab.
 *
 * A throwaway dev tool for choosing which Devanagari face suits the product.
 * It is dormant for normal users: it does nothing on a plain load unless it's
 * activated. Activate it by adding `?fontlab` (or `#fontlab`) to the URL, or by
 * calling `HindiFontLab.open()` from the console.
 *
 * How it works
 *   • The shipped Hindi face is driven by the `--font-hi` CSS variable
 *     (tokens.css). This lab just overrides that variable on :root, live.
 *   • Candidate webfonts are fetched from Google Fonts ONLY when the lab opens
 *     (so inactive users never pay for them), except a persisted pick, which is
 *     re-applied — and its one font loaded — on every page load so the choice
 *     follows you around the whole app while you decide.
 *   • Your pick is saved to localStorage ("virasat.devHindiFont"); "Reset"
 *     clears it and returns to the default Noto Serif Devanagari.
 *
 * To remove this experiment later: delete this file and its one <script> tag
 * in index.html. Nothing else depends on it — `--font-hi` stays and simply
 * keeps its tokens.css default.
 */
(function (global) {
  "use strict";

  var STORE_KEY = "virasat.devHindiFont";
  var SESSION_KEY = "virasat.devFontLabActive";

  // Candidate faces. `stack` is what we assign to --font-hi; `family` + `axis`
  // build the Google Fonts request. `id` "default" is the shipped face (already
  // loaded by the page, so no `family` request needed).
  var FONTS = [
    { id: "default", label: "Noto Serif Devanagari", note: "Current default · serif",
      stack: '"Noto Serif Devanagari", var(--font-display)' },
    { id: "tiro", label: "Tiro Devanagari Hindi", note: "Traditional editorial serif",
      family: "Tiro Devanagari Hindi", stack: '"Tiro Devanagari Hindi", var(--font-display)' },
    { id: "martel", label: "Martel", note: "Warm book serif",
      family: "Martel", axis: ":wght@400;700", stack: '"Martel", var(--font-display)' },
    { id: "rozha", label: "Rozha One", note: "High-contrast display serif",
      family: "Rozha One", stack: '"Rozha One", var(--font-display)' },
    { id: "notosans", label: "Noto Sans Devanagari", note: "Neutral, highly legible sans",
      family: "Noto Sans Devanagari", axis: ":wght@400;500;700", stack: '"Noto Sans Devanagari", var(--font-sans)' },
    { id: "mukta", label: "Mukta", note: "Humanist sans (Indian Type Foundry)",
      family: "Mukta", axis: ":wght@400;500;700", stack: '"Mukta", var(--font-sans)' },
    { id: "hind", label: "Hind", note: "Clean UI sans",
      family: "Hind", axis: ":wght@400;500;700", stack: '"Hind", var(--font-sans)' },
    { id: "baloo", label: "Baloo 2", note: "Rounded, friendly",
      family: "Baloo 2", axis: ":wght@400;500;700", stack: '"Baloo 2", var(--font-sans)' }
  ];

  // A representative sample so the preview shows real product text: an honorific
  // name, a kin term, Devanagari digits, and a short line with conjuncts.
  var SAMPLE_NAME = "श्री रामप्रसाद शर्मा";
  var SAMPLE_KIN = "दादाजी · १९४७";
  var SAMPLE_LINE = "हमारी विरासत, हमारी कहानी — परिवार की जड़ें और शाखाएँ।";

  function byId(id) {
    for (var i = 0; i < FONTS.length; i++) if (FONTS[i].id === id) return FONTS[i];
    return FONTS[0];
  }
  function store(key, val) { try { if (val == null) localStorage.removeItem(key); else localStorage.setItem(key, val); } catch (e) {} }
  function read(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }

  // Inject a Google Fonts <link> for one family, once. Keyed by id so repeat
  // calls are no-ops.
  function loadFont(font) {
    if (!font || !font.family) return; // default face is already on the page
    var id = "hfl-font-" + font.id;
    if (document.getElementById(id)) return;
    var href = "https://fonts.googleapis.com/css2?family=" +
      encodeURIComponent(font.family).replace(/%20/g, "+") + (font.axis || "") + "&display=swap";
    var link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  // Apply a face live by overriding --font-hi on :root.
  function apply(id) {
    var font = byId(id);
    loadFont(font);
    if (id === "default") document.documentElement.style.removeProperty("--font-hi");
    else document.documentElement.style.setProperty("--font-hi", font.stack);
  }

  var panel = null;

  function markActiveRow() {
    if (!panel) return;
    var current = read(STORE_KEY) || "default";
    var rows = panel.querySelectorAll(".hfl-row");
    for (var i = 0; i < rows.length; i++) {
      rows[i].setAttribute("aria-pressed", rows[i].getAttribute("data-font") === current ? "true" : "false");
    }
  }

  function choose(id) {
    store(STORE_KEY, id === "default" ? null : id);
    apply(id);
    markActiveRow();
  }

  function ensureStyles() {
    if (document.getElementById("hfl-style")) return;
    var css = [
      ".hfl-fab{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:48px;height:48px;border-radius:50%;",
      "border:1px solid #B89A5A;background:#5E7D63;color:#FFFCF5;font-size:20px;cursor:pointer;box-shadow:0 8px 20px rgba(0,0,0,.25);}",
      ".hfl-fab:hover{background:#3F5944;}",
      ".hfl-panel{position:fixed;right:16px;bottom:76px;z-index:2147483000;width:340px;max-width:calc(100vw - 32px);",
      "max-height:calc(100vh - 120px);overflow:auto;background:#FFFCF5;color:#221F1A;border:1px solid #E9E2D3;",
      "border-radius:16px;box-shadow:0 30px 60px rgba(34,31,26,.24);font-family:Inter,system-ui,sans-serif;}",
      ".hfl-hd{position:sticky;top:0;background:#FFFCF5;display:flex;align-items:center;justify-content:space-between;",
      "gap:8px;padding:12px 14px;border-bottom:1px solid #E9E2D3;}",
      ".hfl-hd b{font-size:13px;font-weight:700;letter-spacing:.02em;}",
      ".hfl-hd .hfl-sub{font-size:11px;color:#807A6E;font-weight:500;}",
      ".hfl-x{border:0;background:transparent;font-size:18px;cursor:pointer;color:#807A6E;line-height:1;padding:2px 6px;}",
      ".hfl-list{padding:8px;}",
      ".hfl-row{display:block;width:100%;text-align:left;border:1px solid #E9E2D3;background:#fff;border-radius:12px;",
      "padding:10px 12px;margin:6px 0;cursor:pointer;transition:border-color .15s,background .15s;}",
      ".hfl-row:hover{border-color:#B89A5A;background:#F4EFE3;}",
      '.hfl-row[aria-pressed="true"]{border-color:#5E7D63;background:#DAE2D5;box-shadow:inset 0 0 0 1px #5E7D63;}',
      ".hfl-meta{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:6px;}",
      ".hfl-label{font-size:12px;font-weight:700;color:#3F5944;}",
      ".hfl-note{font-size:10.5px;color:#807A6E;}",
      ".hfl-name{font-size:22px;line-height:1.25;color:#221F1A;}",
      ".hfl-kin{font-size:13px;color:#856B33;margin-top:2px;}",
      ".hfl-line{font-size:14px;color:#4A463E;margin-top:4px;line-height:1.5;}",
      ".hfl-ft{padding:10px 14px;border-top:1px solid #E9E2D3;display:flex;justify-content:space-between;align-items:center;gap:8px;}",
      ".hfl-reset{border:1px solid #E9E2D3;background:#fff;border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;color:#221F1A;}",
      ".hfl-reset:hover{border-color:#A6553A;color:#A6553A;}",
      ".hfl-tag{font-size:10px;color:#807A6E;}"
    ].join("");
    var s = document.createElement("style");
    s.id = "hfl-style";
    s.textContent = css;
    document.head.appendChild(s);
  }

  function buildPanel() {
    ensureStyles();
    var wrap = document.createElement("div");
    wrap.className = "hfl-panel";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-label", "Hindi font lab (temporary)");

    var hd = document.createElement("div");
    hd.className = "hfl-hd";
    hd.innerHTML = '<span><b>Hindi font lab</b> <span class="hfl-sub">temporary · tap to try</span></span>';
    var x = document.createElement("button");
    x.className = "hfl-x";
    x.type = "button";
    x.setAttribute("aria-label", "Close");
    x.textContent = "×";
    x.onclick = close;
    hd.appendChild(x);
    wrap.appendChild(hd);

    var list = document.createElement("div");
    list.className = "hfl-list";
    FONTS.forEach(function (font) {
      loadFont(font); // fetch every candidate so its preview renders
      var row = document.createElement("button");
      row.className = "hfl-row";
      row.type = "button";
      row.setAttribute("data-font", font.id);
      row.setAttribute("aria-pressed", "false");
      var stack = font.id === "default"
        ? '"Noto Serif Devanagari", serif'
        : font.stack.replace(/var\(--font-display\)/, "serif").replace(/var\(--font-sans\)/, "sans-serif");
      row.innerHTML =
        '<div class="hfl-meta"><span class="hfl-label">' + font.label + '</span>' +
        '<span class="hfl-note">' + font.note + '</span></div>' +
        '<div style="font-family:' + stack + '">' +
        '<div class="hfl-name" lang="hi">' + SAMPLE_NAME + '</div>' +
        '<div class="hfl-kin" lang="hi">' + SAMPLE_KIN + '</div>' +
        '<div class="hfl-line" lang="hi">' + SAMPLE_LINE + '</div></div>';
      row.onclick = function () { choose(font.id); };
      list.appendChild(row);
    });
    wrap.appendChild(list);

    var ft = document.createElement("div");
    ft.className = "hfl-ft";
    var tag = document.createElement("span");
    tag.className = "hfl-tag";
    tag.textContent = "Saved on this device only";
    var reset = document.createElement("button");
    reset.className = "hfl-reset";
    reset.type = "button";
    reset.textContent = "Reset to default";
    reset.onclick = function () { choose("default"); };
    ft.appendChild(tag);
    ft.appendChild(reset);
    wrap.appendChild(ft);

    return wrap;
  }

  function ensureFab() {
    if (document.getElementById("hfl-fab")) return;
    ensureStyles();
    var b = document.createElement("button");
    b.id = "hfl-fab";
    b.className = "hfl-fab";
    b.type = "button";
    b.title = "Hindi font lab (temporary)";
    b.setAttribute("aria-label", "Open Hindi font lab");
    b.textContent = "अ"; // Devanagari letter A (अ)
    b.onclick = function () { if (panel) close(); else open(); };
    document.body.appendChild(b);
  }

  function open() {
    try { sessionStorage.setItem(SESSION_KEY, "1"); } catch (e) {}
    ensureFab();
    if (panel) return;
    panel = buildPanel();
    document.body.appendChild(panel);
    markActiveRow();
  }
  function close() {
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null;
  }

  // Re-apply a persisted pick on every load, so the chosen face follows the
  // whole app around while you decide.
  var saved = read(STORE_KEY);
  if (saved && saved !== "default") apply(saved);

  function boot() {
    var url = (global.location && (global.location.search + " " + global.location.hash)) || "";
    var activated = /(?:[?&#])fontlab\b/.test(url);
    var sticky = false;
    try { sticky = sessionStorage.getItem(SESSION_KEY) === "1"; } catch (e) {}
    if (activated || sticky) {
      ensureFab();
      if (activated) open();
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  global.HindiFontLab = { open: open, close: close, apply: apply, choose: choose, fonts: FONTS };
})(window);
