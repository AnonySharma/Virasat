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
    // Manual positioning instead of CSS object-fit: gives us slack on
    // BOTH axes regardless of frame aspect, so a square photo in a 16:9
    // hero frame can still be dragged vertically (and zooming gives
    // horizontal range too). object-fit: cover only ever overflows on
    // one axis, which is why hero drag felt half-broken.
    const img = el("img", { class: "crop-frame__img", src: photoUrl, alt: "", draggable: false });
    inner.appendChild(img);

    // Minimum scale of 1.05 — at exactly 1× a photo whose aspect matches
    // the frame on one axis has zero slack on that axis (no drag possible
    // there). 1.05 gives ~5% slack on both axes from the start, so drag
    // is responsive in any direction without forcing the user to crank the
    // zoom slider before they can compose. The persisted value is the user-
    // facing scale, so the floor is invisible after they pick anything.
    const MIN_SCALE = 1.05;
    const state = {
      x: value && value.x != null ? value.x : 50,
      y: value && value.y != null ? value.y : 50,
      scale: value && value.scale ? Math.max(MIN_SCALE, value.scale) : MIN_SCALE
    };

    // Cache of the rendered base size (cover-fit at 1× zoom). Recomputed
    // when the image loads or the frame resizes.
    function computeBase() {
      const r = inner.getBoundingClientRect();
      const iw = img.naturalWidth || r.width;
      const ih = img.naturalHeight || r.height;
      const cover = Math.max(r.width / iw, r.height / ih);
      return { fw: r.width, fh: r.height, iw, ih, cover };
    }
    function apply() {
      const b = computeBase();
      // Rendered size at the current zoom.
      const w = b.iw * b.cover * state.scale;
      const h = b.ih * b.cover * state.scale;
      // Slack per axis (0 means the photo exactly fills that axis at 1×).
      const slackX = w - b.fw;
      const slackY = h - b.fh;
      // Map focal point % → translate. x=0 puts the left edge at frame
      // left; x=100 puts the right edge at frame right; x=50 centres.
      const tx = -slackX * (state.x / 100);
      const ty = -slackY * (state.y / 100);
      img.style.width = w + "px";
      img.style.height = h + "px";
      img.style.transform = "translate(" + tx + "px, " + ty + "px)";
    }
    img.addEventListener("load", apply);
    apply();

    // Per-frame zoom slider, sitting below the preview. Avatar and hero
    // crops have different framing needs, so each owns its own range.
    const zoomValueEl = el("span", { class: "crop-frame__zoom-value" }, state.scale.toFixed(2) + "×");
    const zoomInput = el("input", {
      type: "range", min: String(Math.round(MIN_SCALE * 100)), max: "400", step: "5",
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

    // Drag-to-pan: shift the focal point by however much SLACK there is
    // along each axis. The earlier "1 px drag → 1/frame.width %" mapping
    // looked correct on a square frame but did nothing on a 16:9 hero
    // frame whenever the image already covered the short axis (no slack
    // → drag had no visible effect, regardless of pointer speed).
    //
    // Real math: with object-fit: cover, the rendered image dimensions are
    //   covered = max(frame.w / img.w, frame.h / img.h) * { img.w, img.h }
    // The slack along an axis is `covered.axis - frame.axis`. transform:
    // scale(s) multiplies both, so total slack = covered * s - frame.
    // 100 % of object-position shifts the image by exactly that slack.
    // So pointer-px → object-position-% is `100 / slackPx` per axis.
    let dragStart = null;
    function slackPx() {
      const r = inner.getBoundingClientRect();
      // Until the image's natural dimensions are known, fall back to the
      // frame's own aspect — gives the drag a sensible feel rather than
      // freezing it on the first paint of the editor.
      const iw = img.naturalWidth || r.width;
      const ih = img.naturalHeight || r.height;
      const cover = Math.max(r.width / iw, r.height / ih);
      const renderedW = iw * cover * state.scale;
      const renderedH = ih * cover * state.scale;
      return {
        x: Math.max(0, renderedW - r.width),
        y: Math.max(0, renderedH - r.height)
      };
    }
    function onPointerDown(e) {
      dragStart = { x: e.clientX, y: e.clientY, sx: state.x, sy: state.y };
      inner.setPointerCapture(e.pointerId);
      inner.classList.add("is-dragging");
    }
    function onPointerMove(e) {
      if (!dragStart) return;
      const slack = slackPx();
      // 1 px of pointer movement = (100 / slackPx) % of focal shift. If
      // slack is 0 on this axis, the photo can't move there — no-op. We
      // invert the sign so dragging right reveals more of the right edge.
      const dxPct = slack.x ? -((e.clientX - dragStart.x) * 100 / slack.x) : 0;
      const dyPct = slack.y ? -((e.clientY - dragStart.y) * 100 / slack.y) : 0;
      state.x = clamp(dragStart.sx + dxPct, 0, 100);
      state.y = clamp(dragStart.sy + dyPct, 0, 100);
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
      state.scale = clamp(s, MIN_SCALE, 4);
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
