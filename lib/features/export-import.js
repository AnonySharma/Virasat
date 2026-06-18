/**
 * Export / Import — JSON file roundtrip for the family tree.
 *
 * Exposes window.ExportImport with two methods:
 *   - openExport(): modal with redaction toggles + format choice + size preview
 *   - openImport(): triggers the hidden #import-file-input, validates, confirms, replaces
 */
(function (global) {
  "use strict";

  const FULL = "full";
  const MINIMAL = "minimal";

  // Allowlist of fields kept in the "minimal" export (regardless of toggles).
  // gender survives so living/deceased filters keep working on re-import;
  // createdAt/updatedAt survive so the tree's provenance (when the record
  // was first added) doesn't reset on every round-trip.
  const MINIMAL_FIELDS = ["id", "name", "parents", "spouses", "gender", "createdAt", "updatedAt"];

  function todayISO() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    const kb = bytes / 1024;
    if (kb < 1024) return kb.toFixed(kb < 10 ? 2 : 1) + " KB";
    return (kb / 1024).toFixed(2) + " MB";
  }

  // Sync version (used for live size preview; photos are NOT embedded — we
  // use a placeholder string so the size estimate is still meaningful).
  function buildRedactedStateSync(opts) {
    const src = FamilyStore.getState();
    const people = (src.people || []).map((p) => redactPersonSync(p, opts));
    const marriages = redactMarriagesSync(src.marriages, opts);
    return { version: src.version, meta: src.meta, people, marriages };
  }

  // Async — embeds actual photo blobs as base64 when includePhotos is true.
  async function buildRedactedStateAsync(opts) {
    const src = FamilyStore.getState();
    const people = await Promise.all((src.people || []).map((p) => redactPersonAsync(p, opts)));
    const marriages = await redactMarriagesAsync(src.marriages, opts);
    return { version: src.version, meta: src.meta, people, marriages };
  }

  // Marriage records (date / place / story / photoId on the gold-knot modal)
  // need the same redaction as person records. Without this they were
  // silently dropped from every export.
  function redactMarriagesSync(src, opts) {
    if (!src || typeof src !== "object") return {};
    if (opts.format === MINIMAL) return {};
    const out = {};
    Object.keys(src).forEach((k) => {
      const m = src[k];
      if (!m) return;
      const r = JSON.parse(JSON.stringify(m));
      if (!opts.includeDates) delete r.date;
      if (!opts.includeLocations) delete r.place;
      if (!opts.includePhotos) { delete r.photoId; delete r.photo; }
      // For the live size estimate, swap photo binary with a placeholder.
      if (opts.includePhotos && r.photoId && !r.photo) r.photo = "[binary photo, ~30KB]";
      out[k] = r;
    });
    return out;
  }

  async function redactMarriagesAsync(src, opts) {
    if (!src || typeof src !== "object") return {};
    if (opts.format === MINIMAL) return {};
    const keys = Object.keys(src);
    const entries = await Promise.all(keys.map(async (k) => {
      const m = src[k];
      if (!m) return null;
      const r = JSON.parse(JSON.stringify(m));
      if (!opts.includeDates) delete r.date;
      if (!opts.includeLocations) delete r.place;
      if (opts.includePhotos) {
        if (!opts.skipPhotoInline && window.PhotoStore && r.photoId) {
          try {
            const blob = await PhotoStore.get(r.photoId);
            if (blob) r.photo = await blobToDataUrl(blob);
          } catch (_) {}
        }
        delete r.photoId;
      } else {
        delete r.photo; delete r.photoId;
      }
      return [k, r];
    }));
    const out = {};
    entries.forEach((e) => { if (e) out[e[0]] = e[1]; });
    return out;
  }

  function applyMinimal(p) {
    const out = {};
    MINIMAL_FIELDS.forEach((k) => {
      if (k === "parents" || k === "spouses") out[k] = Array.isArray(p[k]) ? p[k].slice() : [];
      else out[k] = p[k];
    });
    if (p.name_hi) out.name_hi = p.name_hi;
    return out;
  }

  function applyFieldToggles(out, opts) {
    if (!opts.includeDates) {
      delete out.birthDate; delete out.deathDate;
    }
    if (!opts.includeLocations) {
      delete out.birthPlace; delete out.birthPlace_hi;
      delete out.deathPlace; delete out.deathPlace_hi;
    }
    if (!opts.includePhotos) {
      delete out.photo; delete out.photoId; delete out.photoUrl;
    }
  }

  function redactPersonSync(p, opts) {
    if (opts.format === MINIMAL) return applyMinimal(p);
    const out = JSON.parse(JSON.stringify(p));
    if (opts.includePhotos) {
      // For preview, swap binary refs with a small placeholder so the size
      // estimate accounts for the structural cost without reading IDB.
      delete out.photoId; delete out.photoUrl;
      if (!out.photo && (p.photoId || p.photoUrl)) out.photo = "[binary photo, ~30KB]";
    }
    applyFieldToggles(out, opts);
    return out;
  }

  async function redactPersonAsync(p, opts) {
    if (opts.format === MINIMAL) return applyMinimal(p);
    const out = JSON.parse(JSON.stringify(p));
    // We never write photoUrl in exports — every photo is inlined as a
    // base64 data URL on the `photo` field. The exported JSON is fully
    // self-contained.
    delete out.photoUrl;
    if (opts.includePhotos) {
      delete out.photoId;
      if (opts.skipPhotoInline) {
        delete out.photo;
      } else if (window.PhotoStore && p.photoId) {
        try {
          const blob = await PhotoStore.get(p.photoId);
          if (blob) out.photo = await blobToDataUrl(blob);
        } catch (_) {}
      }
      // Legacy: if p.photo is already a data URL it stays as-is.
    } else {
      delete out.photo; delete out.photoId;
    }
    applyFieldToggles(out, opts);
    return out;
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  }

  function makeToggle(title, desc, checked, onChange) {
    const input = UI.el("input", { type: "checkbox", onchange: onChange });
    input.checked = checked !== false;
    return UI.el("label", { class: "toggle" }, [
      input,
      UI.el("span", { class: "toggle__text" }, [
        UI.el("span", { class: "toggle__title" }, title),
        UI.el("span", { class: "toggle__desc" }, desc)
      ])
    ]);
  }

  // PNG quality presets — density is the device-pixel multiplier; the
  // approximate file size is a rough estimate based on the live tree's
  // bounding box. Names chosen to read like quality tiers, not numbers.
  const PNG_QUALITIES = [
    { id: "sketch",   label: "Sketch",   desc: "Quick share, small file", density: 1.5 },
    { id: "standard", label: "Standard", desc: "Crisp on screens",        density: 2,   recommended: true },
    { id: "great",    label: "Great",    desc: "Printable A4",            density: 3 },
    { id: "heirloom", label: "Heirloom", desc: "Poster quality",          density: 4 }
  ];

  function estimatePngSize(density) {
    const liveSvg = document.querySelector("#view-tree .tree-svg");
    if (!liveSvg) return null;
    const r = liveSvg.getBoundingClientRect();
    const px = r.width * density * r.height * density;
    // PNG of a tree (lots of ivory + few photo discs + thin lines) compresses
    // very well — measured ratio is around 0.04 bytes/pixel on real exports.
    // We add a small per-photo bump because real photos are noisier and
    // compress less.
    const peopleWithPhotos = (window.FamilyStore ? FamilyStore.getPeople() : [])
      .filter((p) => p && (p.photo || p.photoId)).length;
    const photoOverhead = peopleWithPhotos * 6 * 1024; // ~6 KB per inlined photo
    return Math.max(20 * 1024, Math.round(px * 0.04) + photoOverhead);
  }

  function openExport() {
    // If the user has someone in lineage focus when they open Export, default to
    // exporting just that subtree — same view they're looking at, no surprises.
    const focusId = (window.Inspector && Inspector.getSelected) ? Inspector.getSelected() : null;
    const focusPerson = focusId && window.FamilyStore ? FamilyStore.getPerson(focusId) : null;
    const focusName = focusPerson ? (FamilyStore.getField(focusPerson, "name") || focusPerson.name) : null;

    const state = {
      includePhotos: true,
      includeDates: true,
      includeLocations: true,
      format: FULL,
      pngQuality: "standard",
      limitToLineage: !!focusId,
      lineageFocusId: focusId
    };

    const sizeChip = UI.el("span", { class: "chip chip--muted" }, "");

    function refreshPreview() {
      try {
        const redacted = buildRedactedStateSync(state);
        const str = JSON.stringify(redacted);
        const bytes = new Blob([str]).size;
        sizeChip.textContent = "JSON ≈ " + formatSize(bytes);
      } catch (e) {
        sizeChip.textContent = "JSON ≈ —";
      }
    }

    // Lineage-only toggle is shown only when a person is in focus.
    const toggleLineage = focusId ? makeToggle(
      "Only " + focusName + "'s lineage",
      "Export the subtree from " + focusName + " (and spouse) downward — not the whole family.",
      true,
      (e) => { state.limitToLineage = !!e.target.checked; }
    ) : null;

    const togglePhotos = makeToggle(
      I18n.t("exp.photos"), I18n.t("exp.photosDesc"), true,
      (e) => { state.includePhotos = !!e.target.checked; refreshPreview(); }
    );
    const toggleDates = makeToggle(
      I18n.t("exp.dates"), I18n.t("exp.datesDesc"), true,
      (e) => { state.includeDates = !!e.target.checked; refreshPreview(); }
    );
    const toggleLocations = makeToggle(
      I18n.t("exp.places"), I18n.t("exp.placesDesc"), true,
      (e) => { state.includeLocations = !!e.target.checked; refreshPreview(); }
    );

    // JSON sub-options
    const toggleEmbed = makeToggle(
      "Embed photos in JSON",
      "Save photos as base64 inside the JSON file. Bigger file, but self-contained.",
      true,
      (e) => { state.embedPhotosInJson = !!e.target.checked; refreshPreview(); }
    );
    state.embedPhotosInJson = true;

    const toggleMinimal = makeToggle(
      "Minimal JSON",
      "Names + relations only — no dates, places, descriptions, or photos.",
      false,
      (e) => {
        state.format = e.target.checked ? MINIMAL : FULL;
        // Disable the "embed photos" toggle when minimal is on.
        const embedInput = toggleEmbed.querySelector("input");
        if (embedInput) embedInput.disabled = !!e.target.checked;
        toggleEmbed.style.opacity = e.target.checked ? "0.5" : "1";
        refreshPreview();
      }
    );

    const jsonSection = UI.el("div", {
      class: "card",
      style: { background: "rgba(0,0,0,.04)", padding: "var(--s-3)", display: "flex", flexDirection: "column", gap: "8px" }
    }, [
      UI.el("div", { class: "field__label", style: { marginBottom: "4px" } }, "JSON options"),
      toggleMinimal,
      toggleEmbed,
      UI.el("div", { style: { marginTop: "4px" } }, [sizeChip])
    ]);

    // PNG quality picker — radio cards in heritage palette
    const pngQualityHost = UI.el("div", { class: "png-quality" });
    function renderQualityCards() {
      while (pngQualityHost.firstChild) pngQualityHost.removeChild(pngQualityHost.firstChild);
      PNG_QUALITIES.forEach((q) => {
        const sizeBytes = estimatePngSize(q.density);
        const sizeStr = sizeBytes ? formatSize(sizeBytes) : "—";
        const isActive = state.pngQuality === q.id;
        const card = UI.el("button", {
          class: "png-quality__card" + (isActive ? " is-active" : ""),
          type: "button",
          "aria-pressed": isActive ? "true" : "false",
          onclick: () => { state.pngQuality = q.id; renderQualityCards(); }
        }, [
          UI.el("div", { class: "png-quality__label" }, [
            UI.el("span", null, q.label),
            q.recommended ? UI.el("span", { class: "png-quality__badge" }, "✦") : null
          ]),
          UI.el("div", { class: "png-quality__desc" }, q.desc),
          UI.el("div", { class: "png-quality__size" }, "≈ " + sizeStr)
        ]);
        pngQualityHost.appendChild(card);
      });
    }
    renderQualityCards();

    const pngSection = UI.el("div", {
      class: "card",
      style: { background: "rgba(94, 125, 99, .06)", padding: "var(--s-3)", display: "flex", flexDirection: "column", gap: "8px" }
    }, [
      UI.el("div", { class: "field__label", style: { marginBottom: "4px" } }, "PNG quality"),
      pngQualityHost
    ]);

    const body = UI.el("div", { class: "form-stack" }, [
      UI.el("p", { style: { color: "var(--text-3)", marginTop: "0", fontSize: "13px" } }, I18n.t("exp.body")),

      toggleLineage,

      UI.el("div", { class: "field__label" }, "Include in export"),
      togglePhotos,
      toggleDates,
      toggleLocations,

      pngSection,
      jsonSection
    ]);

    const cancelBtn = UI.el("button", { class: "btn btn--ghost", type: "button" }, I18n.t("actions.cancel"));
    const pngBtn = UI.el("button", { class: "btn", type: "button" }, [
      UI.el("span", { "aria-hidden": "true", style: { marginRight: "4px" } }, "✦"),
      "Save PNG"
    ]);
    const jsonBtn = UI.el("button", { class: "btn btn--primary", type: "button" }, [
      UI.el("span", { "aria-hidden": "true", style: { marginRight: "4px" } }, "{ }"),
      "Save JSON"
    ]);

    const dlg = UI.openModal({
      title: I18n.t("exp.title"),
      body,
      footer: [cancelBtn, pngBtn, jsonBtn]
    });

    cancelBtn.addEventListener("click", () => dlg.close());

    pngBtn.addEventListener("click", async () => {
      pngBtn.disabled = true;
      jsonBtn.disabled = true;
      const orig = pngBtn.textContent;
      pngBtn.innerHTML = "Rendering…";
      try {
        if (!window.ImageExport) throw new Error("Image export not loaded.");
        const treeView = document.getElementById("view-tree");
        if (treeView && !treeView.classList.contains("is-active")) {
          document.querySelectorAll(".nav-btn").forEach((b) => {
            if (b.dataset.view === "tree") b.click();
          });
          await new Promise((r) => setTimeout(r, 400));
        }
        const familyName = (FamilyStore.getFamilyTitle ? FamilyStore.getFamilyTitle() : null)
          || (FamilyStore.getState().meta || {}).familyName
          || "Family Tree";
        const preset = PNG_QUALITIES.find((q) => q.id === state.pngQuality) || PNG_QUALITIES[1];
        const { blob, filename } = await ImageExport.exportTreePng({
          familyName,
          density: preset.density,
          includePhotos: state.includePhotos,
          includeDates: state.includeDates,
          focusId: state.limitToLineage ? state.lineageFocusId : null
        });
        ImageExport.download(blob, filename);
        UI.toast("PNG saved · " + filename, "success");
        dlg.close();
      } catch (e) {
        UI.toast("Export failed: " + (e && e.message || "unknown"), "danger");
      } finally {
        pngBtn.disabled = false;
        jsonBtn.disabled = false;
        pngBtn.innerHTML = orig;
      }
    });

    jsonBtn.addEventListener("click", async () => {
      pngBtn.disabled = true;
      jsonBtn.disabled = true;
      const orig = jsonBtn.textContent;
      jsonBtn.innerHTML = "…";
      try {
        // Wire embed-photos: when off, JSON skips inlining base64 even if includePhotos is on.
        const exportOpts = Object.assign({}, state, { skipPhotoInline: !state.embedPhotosInJson });
        const redacted = await buildRedactedStateAsync(exportOpts);
        const filename = "family-tree-" + todayISO() + ".json";
        UI.downloadFile(filename, JSON.stringify(redacted, null, 2));
        UI.toast(I18n.t("exp.exported", { n: redacted.people.length }), "success");
        dlg.close();
      } catch (e) {
        UI.toast("Export failed: " + (e && e.message || "unknown"), "danger");
      } finally {
        pngBtn.disabled = false;
        jsonBtn.disabled = false;
        jsonBtn.innerHTML = orig;
      }
    });

    refreshPreview();
  }

  function readFileAsText(file) {
    // Prefer File.text() when available (modern browsers). Fall back to FileReader.
    if (file && typeof file.text === "function") return file.text();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error("Read failed"));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsText(file);
    });
  }

  function openImport() {
    const input = document.getElementById("import-file-input");
    if (!input) {
      UI.toast("Import unavailable: file input missing.", "danger");
      return;
    }

    const onChange = async () => {
      input.removeEventListener("change", onChange);
      const file = input.files && input.files[0];
      const reset = () => { try { input.value = ""; } catch (_) {} };

      if (!file) { reset(); return; }

      let text;
      try { text = await readFileAsText(file); }
      catch (_) { UI.toast(I18n.t("imp.invalid"), "danger"); reset(); return; }

      // CSV path → delegate to CollectForm
      if (/\.csv$/i.test(file.name) || /^name\b/i.test(text)) {
        if (window.CollectForm && CollectForm.importCsvText) {
          CollectForm.importCsvText(text);
        } else {
          UI.toast("CSV import unavailable.", "danger");
        }
        reset();
        return;
      }

      let parsed;
      try { parsed = JSON.parse(text); }
      catch (_) { UI.toast(I18n.t("imp.invalid"), "danger"); reset(); return; }

      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.people)) {
        UI.toast(I18n.t("imp.invalid"), "danger");
        reset();
        return;
      }

      const currentCount = FamilyStore.getPeople().length;
      const newCount = parsed.people.length;

      const ok = await UI.confirm({
        title: I18n.t("imp.confirmTitle"),
        message: I18n.t("imp.confirmMsg", { a: currentCount, b: newCount }),
        confirmLabel: I18n.t("imp.confirmBtn"),
        danger: true
      });

      if (ok) {
        try {
          FamilyStore.replaceAll(parsed);
          // Migrate any base64 photos that came in via the JSON into IndexedDB
          // so localStorage doesn't bloat. Async; if it fails we surface but
          // don't block the import — photos will still render via the legacy
          // base64 fallback.
          if (window.PhotoStore && PhotoStore.migrateLegacy) {
            PhotoStore.migrateLegacy().catch((e) => console.warn("Photo migration:", e));
          }
          UI.toast(I18n.t("imp.imported", { n: newCount }), "success");
        } catch (e) {
          UI.toast("Import failed: " + (e && e.message ? e.message : "unknown error"), "danger");
        }
      }
      reset();
    };

    input.addEventListener("change", onChange);
    input.click();
  }

  global.ExportImport = { openExport, openImport };
})(window);
