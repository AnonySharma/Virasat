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
      if (menu.contains(e.target)) return;
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
      } else if (e.key.length === 1 && /[\p{L}\p{N}]/u.test(e.key)) {
        // Typeahead — match the next option whose label starts with the key
        const k = e.key.toLowerCase();
        const start = state.hover < 0 ? 0 : state.hover + 1;
        const N = state.options.length;
        for (let n = 0; n < N; n++) {
          const i = (start + n) % N;
          if (state.options[i].label.toLowerCase().startsWith(k)) {
            state.hover = i;
            if (!state.open) open();
            else refreshMenu();
            return;
          }
        }
      }
    });

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
