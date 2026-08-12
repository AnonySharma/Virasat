// @ts-check
/**
 * Heritage date picker — small, accessible date-input that matches the
 * project's warm-ivory / olive / gold aesthetic.
 *
 * window.HeritagePicker.create({ value, placeholder, onChange, allowYearOnly })
 *   returns { el, getValue, setValue, focus }
 *
 * Accepts and emits "YYYY", "YYYY-MM", or "YYYY-MM-DD" (the same shapes
 * FamilyStore.parseDate accepts). Empty string clears the value.
 */
(function (global) {
  "use strict";

  const MONTHS = ["January","February","March","April","May","June",
                  "July","August","September","October","November","December"];
  const WEEKDAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const DATE_RE = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/;

  // UI.el is preferred but we keep a tiny fallback so this module is testable
  // outside the app harness.
  const el = (global.UI && global.UI.el) ? global.UI.el : function (tag, attrs, kids) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === "class") n.className = attrs[k];
      else if (k.startsWith("on") && typeof attrs[k] === "function") n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else if (attrs[k] === true) n.setAttribute(k, "");
      else if (attrs[k] != null && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    }
    if (kids != null) (Array.isArray(kids) ? kids : [kids]).forEach(c => {
      if (c == null || c === false) return;
      n.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    });
    return n;
  };

  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  const clamp = UI.clamp;

  function parse(value) {
    if (!value) return null;
    const m = String(value).trim().match(DATE_RE);
    if (!m) return null;
    const y = +m[1];
    const mo = m[2] ? clamp(+m[2], 1, 12) : null;
    const da = m[3] ? clamp(+m[3], 1, 31) : null;
    return { y, m: mo, d: da, precision: m[3] ? "ymd" : (m[2] ? "ym" : "y") };
  }

  function format(parts) {
    if (!parts) return "";
    if (parts.precision === "y") return String(parts.y);
    if (parts.precision === "ym") return parts.y + "-" + pad2(parts.m);
    return parts.y + "-" + pad2(parts.m) + "-" + pad2(parts.d);
  }

  function isSameYMD(a, b) { return a && b && a.y === b.y && a.m === b.m && a.d === b.d; }

  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }

  function create(opts) {
    opts = opts || {};
    const onChange = typeof opts.onChange === "function" ? opts.onChange : function () {};
    const allowYearOnly = opts.allowYearOnly !== false;

    let current = parse(opts.value) || null;
    let yearOnly = !!(current && current.precision === "y");
    // The month/year shown by the calendar (independent of the selected value
    // so you can browse without changing things).
    const today = new Date();
    let viewY = current ? current.y : today.getFullYear();
    let viewM = (current && current.m) ? current.m : (today.getMonth() + 1);
    let focusD = (current && current.d) ? current.d : today.getDate();
    let popOpen = false;

    const input = el("input", {
      type: "text",
      class: "hdp__input",
      placeholder: opts.placeholder || "YYYY-MM-DD",
      value: format(current),
      "aria-label": "Date",
      autocomplete: "off",
      spellcheck: "false"
    });

    const trigger = el("button", {
      type: "button",
      class: "hdp__trigger",
      "aria-label": "Open calendar"
    }, [el("i", { class: "fa-regular fa-calendar" })]);

    const popover = el("div", { class: "hdp__popover", role: "dialog", "aria-label": "Choose date", hidden: true });
    const wrap = el("div", { class: "hdp" }, [input, trigger, popover]);

    // ----- popover internals -----
    const titleEl = el("div", { class: "hdp__title" });
    const prevBtn = el("button", { type: "button", class: "hdp__nav", "aria-label": "Previous month" }, [el("i", { class: "fa-solid fa-chevron-left" })]);
    const nextBtn = el("button", { type: "button", class: "hdp__nav", "aria-label": "Next month" }, [el("i", { class: "fa-solid fa-chevron-right" })]);
    const headEl = el("div", { class: "hdp__head" }, [prevBtn, titleEl, nextBtn]);

    const yearStrip = el("div", { class: "hdp__year-strip", role: "listbox", "aria-label": "Year" });
    const weekdaysEl = el("div", { class: "hdp__weekdays" }, WEEKDAYS.map(w => el("span", null, w)));
    const gridEl = el("div", { class: "hdp__grid", role: "grid" });

    const yearOnlyToggle = el("button", {
      type: "button",
      class: "hdp__year-only-toggle",
      "aria-pressed": "false"
    }, "Year only");

    const todayBtn = el("button", { type: "button", class: "hdp__foot-btn" }, [
      el("i", { class: "fa-solid fa-calendar-day", "aria-hidden": "true" }),
      el("span", null, "Today")
    ]);
    const clearBtn = el("button", { type: "button", class: "hdp__foot-btn" }, [
      el("i", { class: "fa-regular fa-circle-xmark", "aria-hidden": "true" }),
      el("span", null, "Clear")
    ]);
    const footerEl = el("div", { class: "hdp__footer" }, [
      allowYearOnly ? yearOnlyToggle : null,
      el("span", { class: "hdp__foot-spacer" }),
      todayBtn, clearBtn
    ]);

    popover.appendChild(headEl);
    popover.appendChild(yearStrip);
    popover.appendChild(weekdaysEl);
    popover.appendChild(gridEl);
    popover.appendChild(footerEl);

    // ----- rendering -----
    function renderTitle() {
      titleEl.textContent = MONTHS[viewM - 1] + " " + viewY;
    }

    function renderYearStrip() {
      while (yearStrip.firstChild) yearStrip.removeChild(yearStrip.firstChild);
      const now = today.getFullYear();
      const start = now - 150, end = now + 5;
      let activeBtn = null;
      for (let y = end; y >= start; y--) {
        const isActive = y === viewY;
        const b = el("button", {
          type: "button",
          class: "hdp__year" + (isActive ? " is-active" : "") + (current && current.y === y ? " is-selected" : ""),
          "data-year": y,
          role: "option",
          "aria-selected": isActive ? "true" : "false"
        }, String(y));
        b.addEventListener("click", () => {
          viewY = y;
          if (yearOnly) {
            commit({ y, precision: "y" });
          } else {
            renderAll();
          }
        });
        yearStrip.appendChild(b);
        if (isActive) activeBtn = b;
      }
      // Scroll the active year into view (centered horizontally).
      if (activeBtn) {
        requestAnimationFrame(() => {
          const stripRect = yearStrip.getBoundingClientRect();
          const btnRect = activeBtn.getBoundingClientRect();
          yearStrip.scrollLeft += (btnRect.left - stripRect.left) - (stripRect.width / 2) + (btnRect.width / 2);
        });
      }
    }

    function renderGrid() {
      while (gridEl.firstChild) gridEl.removeChild(gridEl.firstChild);
      const firstDow = new Date(viewY, viewM - 1, 1).getDay();
      const dim = daysInMonth(viewY, viewM);
      const prevDim = daysInMonth(viewY, viewM - 1);
      const cells = 42; // 6 rows
      const todayParts = { y: today.getFullYear(), m: today.getMonth() + 1, d: today.getDate() };

      for (let i = 0; i < cells; i++) {
        let dY = viewY, dM = viewM, dD, muted = false;
        if (i < firstDow) {
          dD = prevDim - (firstDow - 1 - i);
          dM = viewM - 1; if (dM < 1) { dM = 12; dY--; }
          muted = true;
        } else if (i >= firstDow + dim) {
          dD = i - firstDow - dim + 1;
          dM = viewM + 1; if (dM > 12) { dM = 1; dY++; }
          muted = true;
        } else {
          dD = i - firstDow + 1;
        }
        const parts = { y: dY, m: dM, d: dD, precision: "ymd" };
        const isToday = isSameYMD(parts, todayParts);
        const isSelected = current && current.precision !== "y" && isSameYMD(parts, current);
        const isFocus = !muted && dD === focusD;
        const cls = "hdp__day"
          + (muted ? " hdp__day--muted" : "")
          + (isToday ? " hdp__day--today" : "")
          + (isSelected ? " hdp__day--selected" : "");
        const btn = el("button", {
          type: "button",
          class: cls,
          role: "gridcell",
          tabindex: isFocus ? "0" : "-1",
          "aria-label": MONTHS[dM - 1] + " " + dD + ", " + dY,
          "aria-selected": isSelected ? "true" : "false"
        }, String(dD));
        btn.addEventListener("click", () => {
          if (muted) { viewY = dY; viewM = dM; }
          focusD = dD;
          commit({ y: dY, m: dM, d: dD, precision: "ymd" });
        });
        gridEl.appendChild(btn);
      }
    }

    function renderYearOnlyMode() {
      const on = yearOnly;
      yearOnlyToggle.setAttribute("aria-pressed", on ? "true" : "false");
      yearOnlyToggle.classList.toggle("is-on", on);
      weekdaysEl.hidden = on;
      gridEl.hidden = on;
      headEl.hidden = on;
    }

    function renderAll() {
      renderTitle();
      renderYearStrip();
      renderGrid();
      renderYearOnlyMode();
    }

    // ----- state changes -----
    function commit(parts) {
      current = parts;
      yearOnly = parts && parts.precision === "y";
      input.value = format(current);
      input.classList.remove("is-invalid");
      onChange(format(current));
      if (parts) { viewY = parts.y; if (parts.m) viewM = parts.m; if (parts.d) focusD = parts.d; }
      renderAll();
    }

    function clearValue() {
      current = null;
      input.value = "";
      input.classList.remove("is-invalid");
      onChange("");
      renderAll();
    }

    function open() {
      if (popOpen) return;
      popOpen = true;
      popover.hidden = false;
      wrap.classList.add("is-open");
      renderAll();
      flipIfNeeded();
      document.addEventListener("mousedown", onDocDown, true);
      document.addEventListener("keydown", onDocKey, true);
    }
    // Open upward when the popover would be clipped at the bottom of the
    // viewport (e.g. inside the person form's bottom-sheet on a phone). Measure
    // the rendered height against the space below the input; flip if it doesn't
    // fit below but does fit above.
    function flipIfNeeded() {
      wrap.classList.remove("hdp--up");
      const inputRect = input.getBoundingClientRect();
      const popH = popover.offsetHeight;
      const spaceBelow = window.innerHeight - inputRect.bottom - 8;
      const spaceAbove = inputRect.top - 8;
      if (popH > spaceBelow && spaceAbove > spaceBelow) wrap.classList.add("hdp--up");
    }
    function close() {
      if (!popOpen) return;
      popOpen = false;
      popover.hidden = true;
      wrap.classList.remove("is-open");
      wrap.classList.remove("hdp--up");
      document.removeEventListener("mousedown", onDocDown, true);
      document.removeEventListener("keydown", onDocKey, true);
    }
    function onDocDown(e) { if (!wrap.contains(e.target)) close(); }
    function onDocKey(e) {
      if (e.key === "Escape") { close(); input.focus(); return; }
      if (yearOnly || !popOpen) return;
      if (!gridEl.contains(document.activeElement)) return;
      const step = e.key === "ArrowLeft" ? -1
                : e.key === "ArrowRight" ? 1
                : e.key === "ArrowUp" ? -7
                : e.key === "ArrowDown" ? 7 : 0;
      if (!step) return;
      e.preventDefault();
      let nd = focusD + step;
      const dim = daysInMonth(viewY, viewM);
      if (nd < 1) {
        viewM--; if (viewM < 1) { viewM = 12; viewY--; }
        nd = daysInMonth(viewY, viewM) + nd;
      } else if (nd > dim) {
        nd = nd - dim;
        viewM++; if (viewM > 12) { viewM = 1; viewY++; }
      }
      focusD = nd;
      renderAll();
      const focused = gridEl.querySelector('[tabindex="0"]');
      if (focused) focused.focus();
    }

    // ----- input wiring -----
    input.addEventListener("focus", open);
    input.addEventListener("click", open);
    trigger.addEventListener("click", (e) => { e.preventDefault(); open(); input.focus(); });

    input.addEventListener("input", () => {
      const v = input.value.trim();
      if (!v) { input.classList.remove("is-invalid"); return; }
      input.classList.toggle("is-invalid", !DATE_RE.test(v));
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const v = input.value.trim();
        if (!v) { clearValue(); return; }
        const parts = parse(v);
        if (parts) commit(parts); else input.classList.add("is-invalid");
      }
    });

    // Commit on blur too. Plain typing only updates the input text + the
    // is-invalid flag (the "input" listener above) — it never calls onChange.
    // So a user who types "1948" and clicks Save (instead of pressing Enter)
    // would silently lose the date, because the form reads the committed value
    // via onChange, not input.value. This makes typing-then-clicking-away
    // behave like typing-then-Enter, fixing every HeritagePicker at once.
    input.addEventListener("blur", (e) => {
      // Ignore blurs where focus merely moves inside our own widget (the
      // trigger button or the calendar popover) — the user is still editing.
      const to = /** @type {Node|null} */ (/** @type {FocusEvent} */ (e).relatedTarget);
      const finish = () => {
        if (document.activeElement && wrap.contains(document.activeElement)) return;
        const v = input.value.trim();
        if (!v) { if (current) clearValue(); return; }
        const parts = parse(v);
        if (parts) { if (format(parts) !== format(current)) commit(parts); }
        else input.classList.add("is-invalid");
      };
      // Safari can report a null relatedTarget; defer and re-check the active
      // element so a click into the popover doesn't trigger a premature commit.
      if (to == null) setTimeout(finish, 0);
      else if (!wrap.contains(to)) finish();
    });

    prevBtn.addEventListener("click", () => { viewM--; if (viewM < 1) { viewM = 12; viewY--; } renderAll(); });
    nextBtn.addEventListener("click", () => { viewM++; if (viewM > 12) { viewM = 1; viewY++; } renderAll(); });
    todayBtn.addEventListener("click", () => {
      const t = new Date();
      commit({ y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate(), precision: yearOnly ? "y" : "ymd" });
    });
    clearBtn.addEventListener("click", clearValue);
    yearOnlyToggle.addEventListener("click", () => {
      yearOnly = !yearOnly;
      if (yearOnly && current) current = /** @type {any} */ ({ y: current.y, precision: "y" });
      input.value = format(current);
      onChange(format(current));
      renderAll();
    });

    // Synchronously commit whatever is typed in the input. Callers invoke this
    // right before reading the value on Save, because a blur→commit can be
    // deferred (Safari/Firefox on Mac don't focus buttons on click, so the
    // blur handler falls back to setTimeout and runs AFTER the Save handler).
    // Returns the committed ISO string (or "" if empty / left unchanged-invalid).
    function flush() {
      const v = input.value.trim();
      if (!v) { if (current) clearValue(); return ""; }
      const parts = parse(v);
      if (parts) { if (format(parts) !== format(current)) commit(parts); }
      else input.classList.add("is-invalid");
      return format(current);
    }

    return {
      el: wrap,
      flush,
      getValue: () => format(current),
      setValue: (v) => {
        const p = parse(v);
        current = p;
        yearOnly = !!(p && p.precision === "y");
        input.value = format(current);
        if (p) { viewY = p.y; if (p.m) viewM = p.m; if (p.d) focusD = p.d; }
        if (popOpen) renderAll();
      },
      focus: () => input.focus()
    };
  }

  global.HeritagePicker = { create };
})(window);
