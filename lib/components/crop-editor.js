/**
 * CropEditor — pick a focal point for two photo frames at once:
 *   1. Avatar (round, used for tree node + small lists)
 *   2. Hero   (wide 16:9, used for the profile page banner & poster share)
 *
 * Each frame previews the same source photo and lets the user drag the photo
 * around (focal point) plus zoom in/out. The output is two records:
 *   { x, y, scale } per frame, where x/y ∈ [0,100] are object-position % and
 *   scale ≥ 1 is a CSS transform: scale() factor.
 *
 * Public:
 *   CropEditor.open(photoUrl, { initialAvatar, initialHero })
 *     -> Promise<{ avatar, hero } | null>   // null = user cancelled
 */
(function (global) {
  "use strict";

  const { el, openModal } = UI;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // Build one preview frame: shows the source photo with object-position +
  // transform: scale, draggable to update the focal point. Each frame
  // also owns its own zoom slider so avatars and the wide hero can be
  // tuned independently — a tight headshot for the round node, a wider
  // group framing for the hero band.
  function buildFrame({ shape, ratio, label, photoUrl, value, onChange }) {
    const frame = el("div", { class: "crop-frame crop-frame--" + shape });
    const inner = el("div", { class: "crop-frame__inner" });
    const img = el("img", { class: "crop-frame__img", src: photoUrl, alt: "", draggable: false });
    const hint = el("div", { class: "crop-frame__hint" }, "Drag to reframe");
    inner.appendChild(img);
    inner.appendChild(hint);

    const state = {
      x: value && value.x != null ? value.x : 50,
      y: value && value.y != null ? value.y : 50,
      scale: value && value.scale ? Math.max(1, value.scale) : 1
    };

    function apply() {
      img.style.objectPosition = state.x + "% " + state.y + "%";
      img.style.transform = state.scale > 1.001 ? "scale(" + state.scale + ")" : "";
    }
    apply();

    // Per-frame zoom slider, sitting below the preview. Avatar and hero
    // crops have different framing needs, so each owns its own range.
    const zoomValueEl = el("span", { class: "crop-frame__zoom-value" }, state.scale.toFixed(2) + "×");
    const zoomInput = el("input", {
      type: "range", min: "100", max: "400", step: "5",
      value: String(Math.round(state.scale * 100)),
      class: "crop-frame__zoom-input",
      "aria-label": "Zoom — " + label
    });
    zoomInput.addEventListener("input", () => {
      const s = parseInt(zoomInput.value, 10) / 100;
      setScale(s);
      zoomValueEl.textContent = s.toFixed(2) + "×";
    });
    const zoomRow = el("div", { class: "crop-frame__zoom" }, [
      el("i", { class: "fa-solid fa-magnifying-glass-minus", "aria-hidden": "true" }),
      zoomInput,
      el("i", { class: "fa-solid fa-magnifying-glass-plus", "aria-hidden": "true" }),
      zoomValueEl
    ]);

    frame.appendChild(el("div", { class: "crop-frame__label" }, label));
    frame.appendChild(inner);
    frame.appendChild(zoomRow);

    // Drag-to-pan: convert pointer movement into focal-point % shift. We move
    // the focal point opposite to the drag direction, so dragging right shows
    // more of the right side of the photo (matches Photoshop / Instagram).
    let dragStart = null;
    function onPointerDown(e) {
      dragStart = { x: e.clientX, y: e.clientY, sx: state.x, sy: state.y };
      inner.setPointerCapture(e.pointerId);
      inner.classList.add("is-dragging");
    }
    function onPointerMove(e) {
      if (!dragStart) return;
      const r = inner.getBoundingClientRect();
      // Map pointer movement straight to focal-point %. The image is rendered
      // already-scaled, so the visible-pixel travel of a drag matches the
      // viewport pixels directly — dividing by state.scale would make a 10 px
      // drag at 3× shift the focal point by ~1 %, which feels unresponsive.
      const dxPct = ((e.clientX - dragStart.x) / r.width) * 100;
      const dyPct = ((e.clientY - dragStart.y) / r.height) * 100;
      state.x = clamp(dragStart.sx - dxPct, 0, 100);
      state.y = clamp(dragStart.sy - dyPct, 0, 100);
      apply();
      onChange(snapshot());
    }
    function onPointerUp(e) {
      dragStart = null;
      try { inner.releasePointerCapture(e.pointerId); } catch (_) {}
      inner.classList.remove("is-dragging");
    }
    inner.addEventListener("pointerdown", onPointerDown);
    inner.addEventListener("pointermove", onPointerMove);
    inner.addEventListener("pointerup", onPointerUp);
    inner.addEventListener("pointercancel", onPointerUp);

    function snapshot() {
      return { x: Math.round(state.x), y: Math.round(state.y), scale: Math.round(state.scale * 100) / 100 };
    }

    function setScale(s) {
      state.scale = clamp(s, 1, 4);
      apply();
      onChange(snapshot());
    }

    return { node: frame, getValue: snapshot, setScale, getScale: () => state.scale };
  }

  function open(photoUrl, opts = {}) {
    return new Promise((resolve) => {
      let result = { avatar: null, hero: null };
      let dlgRef = null;

      const avatarFrame = buildFrame({
        shape: "round",
        ratio: 1,
        label: "Avatar (round)",
        photoUrl,
        value: opts.initialAvatar,
        onChange: (v) => { result.avatar = v; }
      });
      const heroFrame = buildFrame({
        shape: "wide",
        ratio: 16 / 9,
        label: "Hero (wide)",
        photoUrl,
        value: opts.initialHero,
        onChange: (v) => { result.hero = v; }
      });
      // Seed initial values.
      result.avatar = avatarFrame.getValue();
      result.hero = heroFrame.getValue();

      const framesRow = el("div", { class: "crop-frames" }, [avatarFrame.node, heroFrame.node]);

      const resetBtn = el("button", {
        class: "btn btn--ghost btn--sm", type: "button",
        onclick: () => {
          ["avatar", "hero"].forEach((k) => { result[k] = { x: 50, y: 50, scale: 1 }; });
          rebuildFrames();
        }
      }, [
        el("i", { class: "fa-solid fa-rotate-left", "aria-hidden": "true" }),
        el("span", null, "Reset both")
      ]);

      function rebuildFrames() {
        // Replace the frames entirely so the focal point renders the reset.
        const fresh1 = buildFrame({
          shape: "round", ratio: 1, label: "Avatar (round)",
          photoUrl, value: { x: 50, y: 50, scale: 1 },
          onChange: (v) => { result.avatar = v; }
        });
        const fresh2 = buildFrame({
          shape: "wide", ratio: 16 / 9, label: "Hero (wide)",
          photoUrl, value: { x: 50, y: 50, scale: 1 },
          onChange: (v) => { result.hero = v; }
        });
        while (framesRow.firstChild) framesRow.removeChild(framesRow.firstChild);
        framesRow.appendChild(fresh1.node);
        framesRow.appendChild(fresh2.node);
        // Track the new frame instances so Save reads from them, not the
        // originals captured at first build.
        avatarFrame.node = fresh1.node;
        avatarFrame.getValue = fresh1.getValue;
        heroFrame.node = fresh2.node;
        heroFrame.getValue = fresh2.getValue;
      }

      const body = el("div", { class: "crop-editor" }, [
        el("p", { class: "crop-editor__hint" },
          "Two frames, one photo. Drag inside each to choose what's centered, and zoom each independently — a tight headshot for the round avatar, a wider group framing for the hero band."
        ),
        framesRow,
        el("div", { class: "crop-editor__footer-row" }, [resetBtn])
      ]);

      const cancelBtn = el("button", { class: "btn btn--ghost", type: "button" }, "Cancel");
      const saveBtn = el("button", { class: "btn btn--primary", type: "button" }, [
        el("i", { class: "fa-solid fa-check" }),
        el("span", null, "Save crops")
      ]);

      dlgRef = openModal({
        title: "Reframe photo",
        body,
        footer: [cancelBtn, saveBtn],
        onClose: () => { /* cancel via close-X */ if (dlgRef && !dlgRef.__resolved) { dlgRef.__resolved = true; resolve(null); } }
      });
      cancelBtn.addEventListener("click", () => { dlgRef.__resolved = true; resolve(null); dlgRef.close(); });
      saveBtn.addEventListener("click", () => {
        result.avatar = avatarFrame.getValue();
        result.hero = heroFrame.getValue();
        dlgRef.__resolved = true;
        resolve(result);
        dlgRef.close();
      });
    });
  }

  global.CropEditor = { open };
})(window);
