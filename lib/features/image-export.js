/**
 * ImageExport — render the live family tree (or a single profile card) to a
 * shareable PNG. No external libraries; all DOM/SVG/Canvas.
 *
 * Two render paths:
 *   - exportTreePng   : clone the live SVG, inline photos & CSS-var-resolved
 *                       styles, rasterise via <img src="data:image/svg+xml…">.
 *   - exportProfileCard: build a 1200x630 OG-ratio canvas directly with
 *                       Canvas2D — sharper text than an SVG roundtrip.
 *
 * Public API:
 *   ImageExport.exportTreePng({ familyName, density = 2 })
 *     -> Promise<{ blob, filename }>
 *   ImageExport.exportProfileCard(personId, { density = 2 })
 *     -> Promise<{ blob, filename }>
 *   ImageExport.share(blob, filename, title) -> Promise<void>
 */
(function (global) {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const XLINK_NS = "http://www.w3.org/1999/xlink";

  // Cap the rasteriser so huge trees don't blow out memory.
  const MAX_PIXELS = 4000;

  // CSS custom properties that may be referenced by the cloned SVG. Resolved
  // once on the live svg via getComputedStyle and substituted into the inline
  // <style> block.
  const CSS_VARS = [
    "--paper", "--paper-line", "--paper-2", "--paper-3",
    "--ink", "--ink-2", "--ink-3", "--ink-line",
    "--gold", "--rust", "--sage",
    "--olive", "--olive-deep", "--olive-soft",
    "--accent", "--accent-ink", "--accent-soft",
    "--text", "--text-2", "--text-3", "--bg-elev",
    "--font-display", "--font-sans"
  ];

  // ===== Date / filename helpers =====
  function todayISO() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function todayPretty() {
    const d = new Date();
    return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  }

  function slugify(s) {
    return String(s || "person")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "person";
  }

  // ===== Photo data-URL resolution (parallel) =====
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(blob);
    });
  }

  // Fetch any same-origin URL (e.g. "photos/p_xxx.jpg") and return a data URL.
  async function urlToDataUrl(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("Fetch failed: " + url);
    const blob = await resp.blob();
    return blobToDataUrl(blob);
  }

  // Given any href the live tree may have set on an <image> — an Object URL,
  // a relative path, or already a data URL — return a data URL.
  async function hrefToDataUrl(href) {
    if (!href) return null;
    if (/^data:/.test(href)) return href;
    if (/^blob:/.test(href)) {
      const resp = await fetch(href);
      const blob = await resp.blob();
      return blobToDataUrl(blob);
    }
    return urlToDataUrl(href);
  }

  // Resolve every <image> in the cloned SVG to a data URL in parallel.
  async function inlineSvgImages(clonedSvg) {
    const images = Array.from(clonedSvg.querySelectorAll("image"));
    await Promise.all(images.map(async (img) => {
      const href = img.getAttribute("href")
        || img.getAttributeNS(XLINK_NS, "href")
        || "";
      if (!href) return;
      try {
        const dataUrl = await hrefToDataUrl(href);
        if (dataUrl) {
          img.setAttribute("href", dataUrl);
          img.setAttributeNS(XLINK_NS, "href", dataUrl);
        }
      } catch (e) {
        // If photo can't be inlined (e.g. revoked Object URL), drop the href
        // so the rasteriser doesn't choke. The ring + initials still render
        // for any node whose photo failed.
        img.removeAttribute("href");
        img.removeAttributeNS(XLINK_NS, "href");
      }
    }));
  }

  // Read CSS custom properties off the live svg and return a literal map.
  function resolveCssVars(liveSvg) {
    const cs = getComputedStyle(liveSvg);
    const out = {};
    CSS_VARS.forEach((name) => {
      const v = cs.getPropertyValue(name);
      if (v && v.trim()) out[name] = v.trim();
    });
    // Fallbacks if the document hasn't loaded styles for some reason.
    if (!out["--paper"]) out["--paper"] = "#F4EFE3";
    if (!out["--paper-line"]) out["--paper-line"] = "#C7BEA6";
    if (!out["--ink"]) out["--ink"] = "#0F1320";
    if (!out["--gold"] && !out["--accent"]) out["--gold"] = "#E2B23E";
    if (!out["--rust"]) out["--rust"] = "#B5471F";
    if (!out["--sage"]) out["--sage"] = "#8AA678";
    if (!out["--accent"]) out["--accent"] = out["--gold"];
    if (!out["--font-display"]) out["--font-display"] = '"Fraunces", Georgia, serif';
    return out;
  }

  // Build an inline <style> block with explicit literals so the SVG renders
  // correctly when detached from the document.
  function buildInlineStyle(vars) {
    const paper = vars["--paper"];
    const paperLine = vars["--paper-line"];
    const ink = vars["--ink"];
    const sage = vars["--sage"];
    const rust = vars["--rust"];
    const accent = vars["--accent"];
    const fontDisplay = vars["--font-display"];

    // Lightened a couple of accents based on the heritage palette so the
    // exported SVG renders the same way the on-screen tree does even when
    // CSS custom-property fallbacks aren't available.
    const olive = vars["--olive"] || "#5E7D63";
    const oliveSoft = vars["--olive-soft"] || "#DAE2D5";
    const gold = vars["--gold"] || vars["--accent"] || "#B89A5A";
    const text2 = vars["--text-2"] || "#4A463E";
    return `
      .t-node-bg {
        fill: ${paper};
        stroke: ${paperLine};
        stroke-width: 1;
      }
      /* Backing disc behind every photo — must explicitly pick paper so it
         doesn't fall back to SVG's default black fill in the rasterised PNG. */
      .t-node-photo-bg {
        fill: ${paper};
      }
      .t-edge {
        fill: none;
        stroke: rgba(196, 182, 154, 0.75);
        stroke-width: 1.25;
        stroke-linecap: round;
      }
      .t-edge--couple {
        stroke: ${gold};
        stroke-width: 2;
        stroke-dasharray: 0;
      }
      .t-couple-knot circle {
        fill: ${paper};
        stroke: ${gold};
        stroke-width: 1.75;
      }
      .t-node-photo-ring {
        fill: none;
        stroke: ${olive};
        stroke-width: 2;
      }
      .t-node-photo-ring--deceased {
        stroke: ${rust};
        stroke-dasharray: 4 3;
      }
      /* The initials-fallback circle uses --accent-soft on screen. Tree-view
         renders a circle with fill="var(--accent-soft)" — and that var
         doesn't survive serialisation, so substitute the literal here. */
      .t-node circle[fill="var(--accent-soft)"] { fill: ${oliveSoft}; }
      .t-node text { fill: ${ink}; }
      /* The initials text node has fill="var(--accent)" inline; substitute. */
      .t-node text[fill="var(--accent)"] { fill: ${olive}; font-family: ${fontDisplay}; }
      .t-node-name {
        font-family: ${fontDisplay};
        font-weight: 500;
        font-size: 14px;
        fill: ${ink};
      }
      .t-node-dates {
        font-size: 10.5px;
        fill: rgba(15, 19, 32, 0.55);
        letter-spacing: 0.04em;
      }
      .ix-header-band {
        fill: ${paper};
      }
      .ix-header-rule {
        stroke: ${accent};
        stroke-width: 1;
      }
      .ix-header-title {
        font-family: ${fontDisplay};
        font-weight: 600;
        font-size: 28px;
        fill: ${ink};
      }
      .ix-header-sub {
        font-size: 12px;
        fill: rgba(15, 19, 32, 0.55);
        letter-spacing: 0.06em;
      }
      .ix-bg {
        fill: ${paper};
      }
    `;
  }

  // Compute the bounding box of the laid-out content (the live svg has the
  // groups already positioned; getBBox on the cloned svg only works once
  // attached to the DOM, so use the live one which is mounted).
  function liveContentBBox(liveSvg) {
    try {
      // Prefer the union of the two groups so we don't capture stray defs.
      const groups = liveSvg.querySelectorAll(".tree-edges, .tree-nodes");
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      groups.forEach((g) => {
        const b = g.getBBox();
        if (b.width === 0 && b.height === 0) return;
        if (b.x < minX) minX = b.x;
        if (b.y < minY) minY = b.y;
        if (b.x + b.width > maxX) maxX = b.x + b.width;
        if (b.y + b.height > maxY) maxY = b.y + b.height;
      });
      if (!isFinite(minX)) return null;
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    } catch (e) {
      return null;
    }
  }

  // ===== exportTreePng =====
  async function exportTreePng({ familyName, density = 2, includePhotos = true, includeDates = true } = {}) {
    const liveSvg = document.querySelector("#view-tree .tree-svg");
    if (!liveSvg) throw new Error("Tree is empty");

    const people = (window.FamilyStore && FamilyStore.getPeople()) || [];
    if (!people.length) throw new Error("Tree is empty");

    const bbox = liveContentBBox(liveSvg);
    if (!bbox || bbox.w <= 0 || bbox.h <= 0) throw new Error("Tree is empty");

    // Clone the SVG so we can mutate freely.
    const clone = liveSvg.cloneNode(true);
    // Strip the in-progress drawing animation class if present.
    clone.classList.remove("is-drawing");

    // Resolve any `var(--xyz)` literals on every fill / stroke attribute
    // and `style` attribute. Without this, the rasteriser sees "var(--…)"
    // and falls back to black on attributes (which is why every photo was
    // rendering as a solid black disc).
    const liveVars = resolveCssVars(liveSvg);
    function resolveLiteral(s) {
      return String(s).replace(/var\(\s*(--[\w-]+)\s*(?:,([^)]+))?\)/g, (m, name, fb) => {
        const v = liveVars[name];
        if (v) return v;
        if (fb) return fb.trim();
        return m;
      });
    }
    Array.from(clone.querySelectorAll("*")).forEach((node) => {
      ["fill", "stroke", "color"].forEach((a) => {
        const v = node.getAttribute(a);
        if (v && v.indexOf("var(") !== -1) node.setAttribute(a, resolveLiteral(v));
      });
      const st = node.getAttribute("style");
      if (st && st.indexOf("var(") !== -1) node.setAttribute("style", resolveLiteral(st));
    });

    // Apply field-visibility toggles to the clone.
    if (!includePhotos) {
      // Remove every <image> in the clone — the photo rings stay, just the
      // photos themselves go.
      Array.from(clone.querySelectorAll("image")).forEach((img) => img.remove());
    }
    if (!includeDates) {
      Array.from(clone.querySelectorAll(".t-node-dates")).forEach((t) => t.remove());
    }

    // Inline images (photos) first — independent of style resolution.
    const imageInlinePromise = includePhotos ? inlineSvgImages(clone) : Promise.resolve();

    // Resolve CSS vars off the live element while it's still attached.
    const vars = resolveCssVars(liveSvg);
    const inlineCss = buildInlineStyle(vars);

    // Wait for image inlining to finish before serialising.
    await imageInlinePromise;

    // Build the output dimensions: bbox + 80px padding + a header band on top.
    const PAD = 80;
    const HEADER_H = 96;
    const outW = Math.ceil(bbox.w + PAD * 2);
    const outH = Math.ceil(bbox.h + PAD * 2 + HEADER_H);

    // Wrap the contents: shift content down by HEADER_H, then translate so the
    // bbox.x/bbox.y becomes (PAD, PAD + HEADER_H) in the new viewBox.
    const offsetX = PAD - bbox.x;
    const offsetY = PAD + HEADER_H - bbox.y;

    // The cloned svg has the original groups; wrap them into a new <g
    // transform> so the entire layout shifts as a unit. The svg's own
    // attributes (viewBox/preserveAspectRatio) are also rewritten below.
    // Move existing children into a transform group.
    const wrapG = document.createElementNS(SVG_NS, "g");
    wrapG.setAttribute("transform", `translate(${offsetX},${offsetY})`);
    // Move every direct child of the svg (defs, edge group, node group) into wrapG
    while (clone.firstChild) wrapG.appendChild(clone.firstChild);

    // Background rect (paper).
    const bg = document.createElementNS(SVG_NS, "rect");
    bg.setAttribute("class", "ix-bg");
    bg.setAttribute("x", "0");
    bg.setAttribute("y", "0");
    bg.setAttribute("width", String(outW));
    bg.setAttribute("height", String(outH));
    clone.appendChild(bg);

    // Inline style block.
    const styleEl = document.createElementNS(SVG_NS, "style");
    styleEl.textContent = inlineCss;
    clone.appendChild(styleEl);

    // Header band (paper-on-paper) + rule + text.
    const headerBand = document.createElementNS(SVG_NS, "rect");
    headerBand.setAttribute("class", "ix-header-band");
    headerBand.setAttribute("x", "0");
    headerBand.setAttribute("y", "0");
    headerBand.setAttribute("width", String(outW));
    headerBand.setAttribute("height", String(HEADER_H));
    clone.appendChild(headerBand);

    const headerRule = document.createElementNS(SVG_NS, "line");
    headerRule.setAttribute("class", "ix-header-rule");
    headerRule.setAttribute("x1", String(PAD));
    headerRule.setAttribute("y1", String(HEADER_H - 1));
    headerRule.setAttribute("x2", String(outW - PAD));
    headerRule.setAttribute("y2", String(HEADER_H - 1));
    clone.appendChild(headerRule);

    const titleText = document.createElementNS(SVG_NS, "text");
    titleText.setAttribute("class", "ix-header-title");
    titleText.setAttribute("x", String(PAD));
    titleText.setAttribute("y", "44");
    titleText.textContent = String(familyName || (FamilyStore.getState && FamilyStore.getState().meta && FamilyStore.getState().meta.familyName) || "Family Tree");
    clone.appendChild(titleText);

    const subText = document.createElementNS(SVG_NS, "text");
    subText.setAttribute("class", "ix-header-sub");
    subText.setAttribute("x", String(PAD));
    subText.setAttribute("y", "70");
    subText.textContent = "Generated " + todayPretty();
    clone.appendChild(subText);

    // Finally append the content wrap on top.
    clone.appendChild(wrapG);

    // Set the svg's own framing attrs.
    clone.setAttribute("xmlns", SVG_NS);
    clone.setAttribute("xmlns:xlink", XLINK_NS);
    clone.setAttribute("viewBox", `0 0 ${outW} ${outH}`);
    clone.setAttribute("width", String(outW));
    clone.setAttribute("height", String(outH));
    clone.setAttribute("preserveAspectRatio", "xMidYMid meet");

    // Serialise.
    const xml = new XMLSerializer().serializeToString(clone);
    // Use unicode-safe base64 — XML may contain non-Latin1 characters (Hindi names).
    const b64 = utf8ToBase64(xml);
    const dataUrl = "data:image/svg+xml;base64," + b64;

    // Determine canvas dimensions, capped at MAX_PIXELS.
    let canvasW = Math.round(outW * density);
    let canvasH = Math.round(outH * density);
    const longest = Math.max(canvasW, canvasH);
    if (longest > MAX_PIXELS) {
      const k = MAX_PIXELS / longest;
      canvasW = Math.round(canvasW * k);
      canvasH = Math.round(canvasH * k);
    }

    // Rasterise via Image.
    const img = await loadImage(dataUrl);

    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvasW, canvasH);

    const blob = await canvasToBlob(canvas, "image/png");
    return {
      blob,
      filename: "family-tree-" + todayISO() + ".png"
    };
  }

  function utf8ToBase64(str) {
    // Encode to UTF-8 bytes, then base64. unescape(encodeURIComponent(...))
    // is the well-known trick for older browsers; here we use TextEncoder.
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Image decode failed"));
      // crossOrigin is irrelevant for a data URL but harmless to omit.
      img.src = src;
    });
  }

  function canvasToBlob(canvas, mime) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("toBlob returned null"));
      }, mime);
    });
  }

  // ===== exportProfileCard =====
  async function exportProfileCard(personId, { density = 2 } = {}) {
    const person = window.FamilyStore && FamilyStore.getPerson(personId);
    if (!person) throw new Error("Person not found");

    // Resolve CSS vars off body.
    const cs = getComputedStyle(document.body);
    const ink = (cs.getPropertyValue("--ink") || "").trim() || "#0F1320";
    const ink2 = (cs.getPropertyValue("--ink-2") || "").trim() || "#171B2C";
    const paper = (cs.getPropertyValue("--paper") || "").trim() || "#F4EFE3";
    const accent = (cs.getPropertyValue("--gold") || cs.getPropertyValue("--accent") || "").trim() || "#E2B23E";
    const accentSoft = "rgba(226, 178, 62, 0.18)";
    const text2 = (cs.getPropertyValue("--text-2") || "").trim() || "#C9C2B0";
    const text3 = (cs.getPropertyValue("--text-3") || "").trim() || "#8C8979";

    // Fetch photo blob if any, in parallel with font readiness.
    const photoUrlPromise = window.PhotoStore ? PhotoStore.getUrl(person) : Promise.resolve(person.photo || null);

    // Wait for fonts and the photo.
    const [photoUrl] = await Promise.all([
      photoUrlPromise,
      (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve()
    ]);

    let photoImg = null;
    if (photoUrl) {
      try { photoImg = await loadImage(photoUrl); }
      catch (_) { photoImg = null; }
    }

    // Logical 1200x630 layout, scaled by density.
    const W = 1200, H = 630;
    const cw = Math.min(MAX_PIXELS, Math.round(W * density));
    const ch = Math.min(MAX_PIXELS, Math.round(H * density));
    const k = Math.min(cw / W, ch / H);

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(W * k);
    canvas.height = Math.round(H * k);
    const ctx = canvas.getContext("2d");
    ctx.scale(k, k);
    ctx.imageSmoothingQuality = "high";
    ctx.textBaseline = "alphabetic";

    // Background.
    ctx.fillStyle = ink;
    ctx.fillRect(0, 0, W, H);

    // Subtle top-right glow.
    const glow = ctx.createRadialGradient(W - 80, H - 80, 0, W - 80, H - 80, 360);
    glow.addColorStop(0, "rgba(226, 178, 62, 0.12)");
    glow.addColorStop(1, "rgba(226, 178, 62, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Top gold filament (mirrors the modal/header motif).
    const filament = ctx.createLinearGradient(0, 0, W, 0);
    filament.addColorStop(0, accent);
    filament.addColorStop(0.6, "transparent");
    ctx.fillStyle = filament;
    ctx.fillRect(0, 0, W, 3);

    // ===== Left side: photo / initials =====
    const leftCx = 260;
    const leftCy = H / 2;
    const photoR = 180;

    // Soft accent halo behind the portrait.
    ctx.beginPath();
    ctx.arc(leftCx, leftCy, photoR + 18, 0, Math.PI * 2);
    ctx.fillStyle = accentSoft;
    ctx.fill();

    if (photoImg) {
      // Clip to circle.
      ctx.save();
      ctx.beginPath();
      ctx.arc(leftCx, leftCy, photoR, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();

      // Draw cover-style: scale image to fill the circle's bounding box.
      const iw = photoImg.naturalWidth || photoImg.width;
      const ih = photoImg.naturalHeight || photoImg.height;
      if (iw > 0 && ih > 0) {
        const scale = Math.max((photoR * 2) / iw, (photoR * 2) / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        ctx.drawImage(photoImg, leftCx - dw / 2, leftCy - dh / 2, dw, dh);
      }
      ctx.restore();
    } else {
      // Fallback: soft accent circle with Fraunces-style initial.
      ctx.beginPath();
      ctx.arc(leftCx, leftCy, photoR, 0, Math.PI * 2);
      ctx.fillStyle = accentSoft;
      ctx.fill();

      const displayName = (FamilyStore.getField && FamilyStore.getField(person, "name")) || person.name || "?";
      const initials = (FamilyStore.initials && FamilyStore.initials(displayName)) || "?";
      ctx.fillStyle = accent;
      ctx.font = '600 140px "Fraunces", Georgia, serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(initials, leftCx, leftCy + 6);
    }

    // 3px gold ring around the photo.
    ctx.beginPath();
    ctx.arc(leftCx, leftCy, photoR, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = accent;
    ctx.stroke();

    // ===== Right side: name, occupation, lifespan, place =====
    const rightX = 540;
    const rightW = W - rightX - 80;

    // Name (Fraunces 64px). Wrap to at most 2 lines.
    const displayName = (FamilyStore.getField && FamilyStore.getField(person, "name")) || person.name || "Unknown";
    ctx.fillStyle = paper;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = '500 64px "Fraunces", Georgia, serif';
    const nameLines = wrapText(ctx, displayName, rightW, 2);
    let y = 200;
    nameLines.forEach((line, i) => {
      ctx.fillText(line, rightX, y + i * 70);
    });
    y += (nameLines.length - 1) * 70;

    // Occupation (italic 22px ivory-2).
    const occupation = (FamilyStore.getField && FamilyStore.getField(person, "occupation")) || person.occupation || "";
    if (occupation) {
      y += 50;
      ctx.fillStyle = text2;
      ctx.font = 'italic 22px "Fraunces", Georgia, serif';
      const occLines = wrapText(ctx, occupation, rightW, 2);
      occLines.forEach((line, i) => {
        ctx.fillText(line, rightX, y + i * 30);
      });
      y += (occLines.length - 1) * 30;
    }

    // Lifespan + age.
    y += 56;
    const lifespan = formatLifespan(person);
    if (lifespan) {
      ctx.fillStyle = paper;
      ctx.font = '400 26px "Inter", -apple-system, sans-serif';
      ctx.fillText(lifespan, rightX, y);
    }

    // Birth-place chip.
    const birthPlace = (FamilyStore.getField && FamilyStore.getField(person, "birthPlace")) || person.birthPlace || "";
    if (birthPlace) {
      y += 50;
      const chipPadX = 16, chipPadY = 8;
      ctx.font = '500 16px "Inter", -apple-system, sans-serif';
      const chipMetrics = ctx.measureText(birthPlace);
      const chipW = chipMetrics.width + chipPadX * 2;
      const chipH = 16 + chipPadY * 2;
      const chipX = rightX;
      const chipY = y - 16;
      drawRoundedRect(ctx, chipX, chipY, chipW, chipH, chipH / 2);
      ctx.fillStyle = accentSoft;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = accent;
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.font = '500 16px "Inter", -apple-system, sans-serif';
      ctx.textBaseline = "middle";
      ctx.fillText(birthPlace, chipX + chipPadX, chipY + chipH / 2 + 1);
      ctx.textBaseline = "alphabetic";
    }

    // ===== Wordmark bottom-right =====
    ctx.fillStyle = paper;
    ctx.font = '500 18px "Inter", -apple-system, sans-serif';
    ctx.textAlign = "right";
    const wordmark = "Family Tree";
    ctx.fillText(wordmark, W - 60, H - 50);
    // Tiny gold dot before the wordmark.
    const wmW = ctx.measureText(wordmark).width;
    ctx.beginPath();
    ctx.arc(W - 60 - wmW - 14, H - 56, 4, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();

    const blob = await canvasToBlob(canvas, "image/png");
    return {
      blob,
      filename: "profile-" + slugify(displayName) + ".png"
    };
  }

  function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function wrapText(ctx, text, maxWidth, maxLines) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const lines = [];
    let current = words[0];
    for (let i = 1; i < words.length; i++) {
      const candidate = current + " " + words[i];
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = words[i];
        if (lines.length === maxLines - 1) break;
      }
    }
    // Add the last line, truncating with an ellipsis if it overflows.
    let last = current;
    if (lines.length >= maxLines) {
      // No more room; ellipsise the last accepted line if it's already there.
      return lines.slice(0, maxLines);
    }
    if (ctx.measureText(last).width > maxWidth) {
      while (last.length > 1 && ctx.measureText(last + "…").width > maxWidth) {
        last = last.slice(0, -1);
      }
      last = last.trimEnd() + "…";
    }
    lines.push(last);
    return lines.slice(0, maxLines);
  }

  function formatLifespan(person) {
    const by = (window.FamilyStore && FamilyStore.getYear) ? FamilyStore.getYear(person.birthDate) : null;
    const dy = (window.FamilyStore && FamilyStore.getYear) ? FamilyStore.getYear(person.deathDate) : null;
    const isDeceased = !!person.deathDate;
    const age = (window.FamilyStore && FamilyStore.calcAge) ? FamilyStore.calcAge(person) : null;

    let range;
    if (by == null && dy == null) range = "";
    else if (by == null) range = "? – " + dy;
    else if (dy == null) range = isDeceased ? `${by} – ?` : `${by} – present`;
    else range = `${by} – ${dy}`;

    if (!range) return "";
    if (age != null && age >= 0) return `${range}  ·  age ${age}`;
    return range;
  }

  // ===== save helpers =====
  // Always-download. The header "Save PNG" expects a file in the user's
  // Downloads folder, not the OS share sheet.
  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
  }

  // Try the OS share sheet (mobile, mostly), fall back to download. Used by
  // the inspector's "Share as image" affordance — the UX of that button
  // matches "share" semantically.
  async function share(blob, filename, title) {
    const file = new File([blob], filename, { type: blob.type || "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      try {
        await navigator.share({ files: [file], title: title || filename });
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return;
      }
    }
    download(blob, filename);
  }

  global.ImageExport = { exportTreePng, exportProfileCard, share, download };
})(window);
