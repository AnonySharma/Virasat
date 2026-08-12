// @ts-check
/**
 * HeritageSelect — accessible custom <select> replacement that matches the
 * heritage palette. Native pickers on macOS use a blue iOS highlight that
 * clashes with our olive/gold; this component renders a calm popover with
 * olive-soft selection rows.
 *
 * Usage:
 *   const sel = HeritageSelect.create({
 *     options: [{ value: "", label: "—" }, { value: "m", label: "Male" }, …],
 *     value: "m",
 *     onChange: (v) => …,
 *     placeholder: "Choose…"
 *   });
 *   parent.appendChild(sel.el);
 *   sel.getValue();
 *   sel.setValue("f");
 *   sel.setOptions([…]);
 *
 * Keyboard: Space/Enter opens; ↑/↓ navigates; Enter selects; Esc closes;
 * typing focuses matching option (single-letter typeahead).
 */
(function (global) {
  "use strict";

  function create(opts) {
    const state = {
      options: (opts.options || []).slice(),
      value: opts.value || "",
      onChange: opts.onChange || (() => {}),
      placeholder: opts.placeholder || "",
      open: false,
      hover: -1
    };

    // Stable per-instance id prefix so each rendered <li> gets a unique id
    // for `aria-activedescendant` to point at. Without per-instance unique
    // ids, two HeritageSelects on the same page would announce each other's
    // hovered options.
    const _c = /** @type {any} */ (create);
    _c._n = (_c._n || 0) + 1;
    const idPrefix = "hsel-" + _c._n + "-opt-";

    const el = document.createElement("div");
    el.className = "hsel";
    el.setAttribute("tabindex", "0");
    el.setAttribute("role", "combobox");
    el.setAttribute("aria-haspopup", "listbox");
    el.setAttribute("aria-expanded", "false");

    const display = document.createElement("span");
    display.className = "hsel__value";
    el.appendChild(display);

    const chev = document.createElement("i");
    chev.className = "hsel__chev fa-solid fa-chevron-down";
    chev.setAttribute("aria-hidden", "true");
    el.appendChild(chev);

    const menu = document.createElement("ul");
    menu.className = "hsel__menu";
    menu.setAttribute("role", "listbox");
    menu.hidden = true;
    el.appendChild(menu);

    // Strategy: commit selection on pointerup (or click as fallback) inside
    // the menu, via event delegation. We mark `pickPending` on pointerdown
    // so the wrapper's click handler — which fires AFTER pointerup —
    // recognises that it was a "pick" gesture and skips its open/close
    // toggle. This avoids the menu re-opening immediately after a pick.
    let justPicked = false;

    function findOptAt(e) {
      // First try the event target's nearest .hsel__opt ancestor.
      let li = e.target && e.target.closest && e.target.closest(".hsel__opt");
      if (li && menu.contains(li)) return li;
      // Fallback: hit-test from the click coordinates. Some hosts dispatch
      // pointer events with target=UL even when the visual hit is an LI
      // child (e.g. when the click lands on a flex gap).
      if (typeof e.clientX === "number") {
        const hit = document.elementFromPoint(e.clientX, e.clientY);
        if (hit) {
          li = hit.closest && hit.closest(".hsel__opt");
          if (li && menu.contains(li)) return li;
        }
      }
      return null;
    }

    function commitFromEvent(e) {
      const li = findOptAt(e);
      if (!li) return false;
      const i = +li.dataset.index;
      if (Number.isFinite(i)) { pick(i); justPicked = true; return true; }
      return false;
    }

    // Commit on mousedown (most reliable across browsers and CDP). Then
    // swallow the trailing click so the wrapper's toggle doesn't reopen.
    menu.addEventListener("mousedown", (e) => {
      e.preventDefault();   // keep .hsel focused; don't blur mid-pick
      if (commitFromEvent(e)) e.stopPropagation();
    });
    menu.addEventListener("click", (e) => e.stopPropagation());

    function refreshDisplay() {
      const opt = state.options.find((o) => String(o.value) === String(state.value));
      if (opt) {
        display.textContent = opt.label;
        display.classList.remove("hsel__value--placeholder");
      } else {
        display.textContent = state.placeholder || "";
        display.classList.add("hsel__value--placeholder");
      }
    }

    function refreshMenu() {
      menu.innerHTML = "";
      state.options.forEach((o, i) => {
        const li = document.createElement("li");
        li.id = idPrefix + i;
        li.className = "hsel__opt"
          + (String(o.value) === String(state.value) ? " is-selected" : "")
          + (i === state.hover ? " is-hover" : "");
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(o.value) === String(state.value) ? "true" : "false");
        li.dataset.index = String(i);
        const tick = document.createElement("i");
        tick.className = "hsel__tick fa-solid fa-check";
        tick.setAttribute("aria-hidden", "true");
        li.appendChild(tick);
        const label = document.createElement("span");
        label.textContent = o.label;
        li.appendChild(label);
        li.addEventListener("mouseenter", () => { state.hover = i; refreshMenu(); });
        menu.appendChild(li);
      });
      // Tell screen readers which option is currently the keyboard focus,
      // so arrow-key navigation gets announced (the visual .is-hover class
      // alone is silent to assistive tech).
      if (state.open && state.hover >= 0) {
        el.setAttribute("aria-activedescendant", idPrefix + state.hover);
        // Keep the hovered option visible — Arrow nav and (now) typeahead can
        // move hover well past the scroll fold in a long people list.
        const hov = /** @type {HTMLElement|null} */ (menu.children[state.hover] || null);
        if (hov && hov.scrollIntoView) { try { hov.scrollIntoView({ block: "nearest" }); } catch (_) {} }
      } else {
        el.removeAttribute("aria-activedescendant");
      }
    }

    function open() {
      if (state.open) return;
      state.open = true;
      menu.hidden = false;
      el.classList.add("is-open");
      el.setAttribute("aria-expanded", "true");
      const idx = state.options.findIndex((o) => String(o.value) === String(state.value));
      state.hover = idx >= 0 ? idx : 0;
      refreshMenu();
      // Use the bubbling phase (default) so children's stopPropagation
      // can prevent dismissal cleanly. Capture phase would fire before
      // the option's own click handler under some browsers and close
      // the menu before pick() runs.
      document.addEventListener("mousedown", onDocDown);
      document.addEventListener("touchstart", onDocDown, { passive: true });
    }

    function close() {
      if (!state.open) return;
      state.open = false;
      menu.hidden = true;
      el.classList.remove("is-open");
      el.setAttribute("aria-expanded", "false");
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("touchstart", onDocDown);
    }

    function onDocDown(e) {
      if (!el.contains(e.target)) close();
    }

    function pick(i) {
      const o = state.options[i];
      if (!o) return;
      const changed = String(o.value) !== String(state.value);
      state.value = o.value;
      refreshDisplay();
      close();
      el.focus();
      if (changed) state.onChange(state.value);
    }

    el.addEventListener("click", (e) => {
      // Ignore clicks that originated inside the menu — those are handled
      // by its own click handler.
      if (menu.contains(/** @type {Node} */ (e.target))) return;
      // If we just picked a value (mousedown flagged it), don't toggle.
      if (justPicked) { justPicked = false; return; }
      if (state.open) close(); else open();
    });

    el.addEventListener("keydown", (e) => {
      const max = state.options.length - 1;
      if (e.key === "Escape") {
        if (state.open) { e.preventDefault(); close(); }
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (!state.open) open();
        else if (state.hover >= 0) pick(state.hover);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!state.open) { open(); return; }
        state.hover = Math.min(max, state.hover + 1);
        refreshMenu();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (!state.open) { open(); return; }
        state.hover = Math.max(0, state.hover - 1);
        refreshMenu();
      } else if (e.key === "Home") {
        e.preventDefault(); state.hover = 0; refreshMenu();
      } else if (e.key === "End") {
        e.preventDefault(); state.hover = max; refreshMenu();
      } else if (e.key.length === 1 && /[\p{L}\p{N} ]/u.test(e.key)) {
        typeahead(e.key);
      }
    });

    // Buffered typeahead. Successive keystrokes within TYPEAHEAD_WINDOW ms
    // accumulate into a query, so a dozen S-names no longer mean pressing "s"
    // repeatedly to cycle — typing "sun" jumps straight to "Sunita". Matching
    // prefers a prefix match (native-<select> feel, and keeps single-key
    // cycling when the same letter is pressed repeatedly), then falls back to a
    // substring match so mid-label queries work. Benefits every HeritageSelect:
    // parent / spouse / PathFinder pickers.
    let taBuf = "";
    let taTimer = null;
    const TYPEAHEAD_WINDOW = 800;
    function typeahead(ch) {
      // A repeat of the SAME single char cycles (buffer stays one char); any
      // other char extends the query.
      if (taBuf.length === 1 && ch.toLowerCase() === taBuf) {
        // keep buffer as the single char → cycle to the next prefix match
      } else {
        taBuf += ch.toLowerCase();
      }
      if (taTimer) clearTimeout(taTimer);
      taTimer = setTimeout(() => { taBuf = ""; taTimer = null; }, TYPEAHEAD_WINDOW);

      const q = taBuf;
      const N = state.options.length;
      if (!N) return;
      // When cycling on a single-char buffer, start the search AFTER the current
      // hover; for a multi-char query, search from the current hover so an
      // already-correct match isn't skipped.
      const cycling = q.length === 1;
      const start = cycling ? (state.hover < 0 ? 0 : state.hover + 1) : (state.hover < 0 ? 0 : state.hover);

      // Pass 1: prefix match. Pass 2: substring match. Both wrap around.
      const findBy = (test) => {
        for (let n = 0; n < N; n++) {
          const i = (start + n) % N;
          if (test(state.options[i].label.toLowerCase())) return i;
        }
        return -1;
      };
      let hit = findBy((lbl) => lbl.startsWith(q));
      if (hit < 0) hit = findBy((lbl) => lbl.includes(q));
      if (hit >= 0) {
        state.hover = hit;
        if (!state.open) open();
        else refreshMenu();
      }
    }

    refreshDisplay();
    refreshMenu();

    return {
      el,
      getValue: () => state.value,
      setValue: (v) => { state.value = v; refreshDisplay(); refreshMenu(); },
      setOptions: (next) => {
        state.options = next.slice();
        refreshDisplay();
        refreshMenu();
      },
      focus: () => el.focus()
    };
  }

  global.HeritageSelect = { create };
})(window);
