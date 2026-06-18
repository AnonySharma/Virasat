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
  // transform: scale, draggable to update the focal point.
  function buildFrame({ shape, ratio, label, photoUrl, value, onChange }) {
    const frame = el("div", { class: "crop-frame crop-frame--" + shape });
    const inner = el("div", { class: "crop-frame__inner" });
    const img = el("img", { class: "crop-frame__img", src: photoUrl, alt: "", draggable: false });
    const hint = el("div", { class: "crop-frame__hint" }, "Drag to reframe");
    inner.appendChild(img);
    inner.appendChild(hint);
    frame.appendChild(el("div", { class: "crop-frame__label" }, label));
    frame.appendChild(inner);

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

      // Shared zoom slider — applies to whichever frame the user last touched.
      // Simpler than two sliders; the user usually wants the same zoom for both.
      const zoomLabel = el("span", { class: "crop-zoom__label" }, "Zoom");
      const zoomValue = el("span", { class: "crop-zoom__value" }, "1.00×");
      const zoom = el("input", {
        type: "range", min: "100", max: "400", step: "5", value: "100",
        class: "crop-zoom__input", "aria-label": "Zoom"
      });
      zoom.addEventListener("input", () => {
        const s = parseInt(zoom.value, 10) / 100;
        avatarFrame.setScale(s);
        heroFrame.setScale(s);
        zoomValue.textContent = s.toFixed(2) + "×";
      });

      const resetBtn = el("button", {
        class: "btn btn--ghost btn--sm", type: "button",
        onclick: () => {
          zoom.value = "100";
          avatarFrame.setScale(1);
          heroFrame.setScale(1);
          zoomValue.textContent = "1.00×";
          // Re-center both frames.
          ["avatar", "hero"].forEach((k) => {
            const v = { x: 50, y: 50, scale: 1 };
            result[k] = v;
          });
          // Force re-render by closing & reopening would be too aggressive;
          // instead re-create both frames in place.
          rebuildFrames();
        }
      }, "Reset to center");

      const framesRow = el("div", { class: "crop-frames" }, [avatarFrame.node, heroFrame.node]);

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
      }

      const body = el("div", { class: "crop-editor" }, [
        el("p", { class: "crop-editor__hint" },
          "Two frames, one photo. Drag inside each to choose what's centered. The round frame is what shows in the tree and avatars; the wide frame is the hero on the profile page."
        ),
        framesRow,
        el("div", { class: "crop-zoom" }, [zoomLabel, zoom, zoomValue, resetBtn])
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
