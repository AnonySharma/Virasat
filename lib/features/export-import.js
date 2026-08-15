// @ts-check
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

  // How many people share the active cloud tree, or null when unknown (cloud
  // off, offline, error, or the read took too long). Raced against a 2.5s
  // timeout so a destructive-import confirm never hangs waiting on the network
  // — a null just means we show the ordinary (non-shared) warning.
  function activeMemberCountSafe() {
    const c = window.CloudStore;
    if (!c || !c.isActive || !c.isActive() || !c.activeMemberCount) return Promise.resolve(null);
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 2500));
    let live;
    try { live = Promise.resolve(c.activeMemberCount()); }
    catch (_) { return Promise.resolve(null); }
    return Promise.race([live.catch(() => null), timeout]);
  }

  // Sync version (used for live size preview; photos are NOT embedded — we
  // use a placeholder string so the size estimate is still meaningful).
  function buildRedactedStateSync(opts) {
    const src = FamilyStore.getState();
    const scoped = scopeToLineage(src.people, src.marriages, opts);
    const people = (scoped.people || []).map((p) => redactPersonSync(p, opts));
    const marriages = redactMarriagesSync(scoped.marriages, opts);
    return { version: src.version, meta: src.meta, people, marriages };
  }

  // Async — embeds actual photo blobs as base64 when includePhotos is true.
  async function buildRedactedStateAsync(opts) {
    const src = FamilyStore.getState();
    const scoped = scopeToLineage(src.people, src.marriages, opts);
    const people = await Promise.all((scoped.people || []).map((p) => redactPersonAsync(p, opts)));
    const marriages = await redactMarriagesAsync(scoped.marriages, opts);
    return { version: src.version, meta: src.meta, people, marriages };
  }

  // Self-backup pipeline. Distinct from the share-with-family redaction:
  //  - Every field round-trips, regardless of the export modal's toggles.
  //  - Privacy flags (privatePhone / privateEmail / privateAddress) are
  //    PRESERVED so re-import restores the marking. The share path strips
  //    them to avoid leaking "this field used to exist" hints.
  //  - Photos are inlined as a base64 data URL by reading the IDB blob
  //    pointed at by photoId. If the read fails (corrupt IDB, private
  //    browsing), the source-device photoId is kept so a same-device
  //    restore still works; photoFailures is incremented so the caller
  //    can warn the user.
  async function buildBackupState(srcOverride, opts) {
    // srcOverride lets the conflict path back up a losing snapshot that has
    // already been replaced in the live store (see downloadBackupState). Photos
    // are still inlined from IDB, which a hydrate doesn't clear.
    // opts.limitToLineage scopes the backup to a lineage focus-set, matching
    // the export modal's "Only X's lineage" chip (the conflict path passes none).
    const raw = srcOverride || FamilyStore.getState();
    const scoped = scopeToLineage(raw.people, raw.marriages, opts);
    const src = { version: raw.version, meta: raw.meta, people: scoped.people, marriages: scoped.marriages };
    let photoFailures = 0;
    let photoTotal = 0;

    async function inlinePhoto(rec) {
      // Already a base64 data URL? Pass through.
      if (rec.photo && /^data:/.test(rec.photo)) return { ok: true, dataUrl: rec.photo };
      if (window.PhotoStore && rec.photoId) {
        try {
          const blob = await PhotoStore.get(rec.photoId);
          if (blob) return { ok: true, dataUrl: await PhotoStore.blobToDataUrl(blob) };
        } catch (e) {
          console.warn("Backup: IDB photo unreachable for", rec.photoId, e);
        }
      }
      return { ok: false };
    }

    const people = await Promise.all((src.people || []).map(async (p) => {
      const out = JSON.parse(JSON.stringify(p));
      // Gallery photos are inlined the same way as the primary: read each
      // IDB blob to base64 so the backup is self-contained, dropping the
      // photoId on success (kept on failure so a same-device restore works).
      if (Array.isArray(out.gallery) && out.gallery.length) {
        out.gallery = await Promise.all(out.gallery.map(async (g) => {
          if (!g || (!g.photo && !g.photoId)) return g;
          photoTotal++;
          const r = await inlinePhoto(g);
          if (r.ok) { const gg = { ...g, photo: r.dataUrl }; delete gg.photoId; return gg; }
          photoFailures++;
          return g;
        }));
      }
      const hasAnyPhoto = !!(p.photo || p.photoId);
      if (!hasAnyPhoto) return out;
      photoTotal++;
      const r = await inlinePhoto(p);
      if (r.ok) {
        out.photo = r.dataUrl;
        // Inlined photo is the source of truth — drop the photoId so
        // getUrlSync doesn't try to re-read a stale IDB key on import.
        delete out.photoId;
      } else {
        // Keep the photoId so a same-device restore still works.
        photoFailures++;
      }
      return out;
    }));

    const marriages = {};
    const rawM = src.marriages || {};
    await Promise.all(Object.keys(rawM).map(async (k) => {
      const m = rawM[k];
      if (!m) return;
      const out = JSON.parse(JSON.stringify(m));
      const hasAnyPhoto = !!(m.photo || m.photoId);
      if (hasAnyPhoto) {
        photoTotal++;
        const r = await inlinePhoto(m);
        if (r.ok) {
          out.photo = r.dataUrl;
          delete out.photoId;
        } else {
          photoFailures++;
        }
      }
      marriages[k] = out;
    }));

    return {
      state: { version: src.version, meta: src.meta, people, marriages },
      photoTotal,
      photoFailures
    };
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
    // Explicitly-unknown parent roles ("father"/"mother"). A sparse annotation
    // that's almost always absent, so — like name_hi — only ship it when set,
    // rather than padding every record with an empty array.
    if (Array.isArray(p.unknownParents) && p.unknownParents.length) {
      out.unknownParents = p.unknownParents.slice();
    }
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
      delete out.photo; delete out.photoId;
      delete out.gallery;
    }
    // Per-field privacy — strip whatever the user marked private. Privacy
    // flags themselves are also stripped so the receiving device doesn't
    // see "this field had a private hint and now it's gone".
    if (out.contact && typeof out.contact === "object") {
      const c = out.contact;
      if (c.privatePhone) c.phone = "";
      if (c.privateEmail) c.email = "";
      if (c.privateAddress) c.address = "";
      delete c.privatePhone; delete c.privateEmail; delete c.privateAddress;
      // If everything's empty after redaction, drop the contact object entirely.
      if (!c.phone && !c.email && !c.address) delete out.contact;
    }
  }

  function redactPersonSync(p, opts) {
    if (opts.format === MINIMAL) return applyMinimal(p);
    const out = JSON.parse(JSON.stringify(p));
    if (opts.includePhotos) {
      // For preview, swap binary refs with a small placeholder so the size
      // estimate accounts for the structural cost without reading IDB.
      delete out.photoId;
      if (!out.photo && p.photoId) out.photo = "[binary photo, ~30KB]";
      // Same placeholder accounting for each gallery photo.
      if (Array.isArray(out.gallery)) out.gallery.forEach((g) => {
        if (g && !g.photo && g.photoId) g.photo = "[binary photo, ~30KB]";
        if (g) delete g.photoId;
      });
    }
    applyFieldToggles(out, opts);
    return out;
  }

  async function redactPersonAsync(p, opts) {
    if (opts.format === MINIMAL) return applyMinimal(p);
    const out = JSON.parse(JSON.stringify(p));
    // Every photo ships inlined as a base64 data URL on `photo` — the
    // exported JSON is fully self-contained.
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
      // If p.photo is already a data URL (sample data) it stays as-is.
      // Gallery photos: inline each blob to base64 (or drop the binary when
      // skipping inline for the size estimate), always dropping the photoId so
      // the receiving device doesn't re-read a stale IDB key.
      if (Array.isArray(out.gallery)) {
        out.gallery = await Promise.all(out.gallery.map(async (g) => {
          if (!g) return g;
          const gg = { ...g };
          delete gg.photoId;
          if (opts.skipPhotoInline) { delete gg.photo; }
          else if (window.PhotoStore && g.photoId && !gg.photo) {
            try { const blob = await PhotoStore.get(g.photoId); if (blob) gg.photo = await blobToDataUrl(blob); } catch (_) {}
          }
          return gg;
        }));
      }
    } else {
      delete out.photo; delete out.photoId;
      delete out.gallery;
    }
    applyFieldToggles(out, opts);
    return out;
  }

  // blobToDataUrl lives on PhotoStore — same primitive shared with image-export.
  const blobToDataUrl = (b) => PhotoStore.blobToDataUrl(b);

  // Restrict a raw {people, marriages} pair to a lineage focus-set. Reuses
  // ImageExport.buildFocusSet so a JSON / backup export scoped to "Only X's
  // lineage" contains exactly the people the PNG path frames — the chip must
  // mean the same thing on all three buttons. Returns the source unchanged
  // when no lineage limit is active (or the helper is unavailable).
  function scopeToLineage(people, marriages, opts) {
    if (!opts || !opts.limitToLineage || !opts.lineageFocusId) return { people, marriages };
    const set = (window.ImageExport && ImageExport.buildFocusSet)
      ? ImageExport.buildFocusSet(opts.lineageFocusId) : null;
    if (!set) return { people, marriages };
    const keptPeople = (people || []).filter((p) => p && set.has(p.id));
    const keptMarriages = {};
    Object.keys(marriages || {}).forEach((k) => {
      // marriageKey() is "aId|bId" sorted; keep a marriage only when BOTH
      // partners are in the lineage set (a partner outside it isn't exported).
      const parts = String(k).split("|");
      if (parts.length === 2 && set.has(parts[0]) && set.has(parts[1])) keptMarriages[k] = marriages[k];
    });
    return { people: keptPeople, marriages: keptMarriages };
  }

  // Compact pill that flips between on/off — replaces the older
  // verbose toggle row (icon + title + description on every line) with
  // something that fits three across in the export modal. Active state
  // is gold-soft fill, inactive is muted.
  /**
   * @param {object} opts
   * @param {string} [opts.label]
   * @param {string} [opts.icon]
   * @param {boolean} [opts.active]
   * @param {(on: boolean) => void} [opts.onChange]
   */
  function makeFieldChip({ label, icon, active, onChange }) {
    let on = active !== false;
    const btn = UI.el("button", {
      type: "button",
      class: "field-chip" + (on ? " is-on" : ""),
      "aria-pressed": on ? "true" : "false",
      onclick: () => {
        on = !on;
        btn.classList.toggle("is-on", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
        if (typeof onChange === "function") onChange(on);
      }
    }, [
      UI.el("i", { class: icon, "aria-hidden": "true" }),
      UI.el("span", { class: "field-chip__label" }, label)
    ]);
    return btn;
  }

  // PNG quality presets — density is the device-pixel multiplier; the
  // approximate file size is a rough estimate based on the live tree's
  // bounding box. Names chosen to read like quality tiers, not numbers.
  // Labels/descriptions resolve through i18n at render time (see
  // renderQualityCards) so a language switch re-labels them; only the id +
  // density are structural here.
  const PNG_QUALITIES = [
    { id: "sketch",   labelKey: "exp.qSketch",   descKey: "exp.qSketchDesc",   density: 1.5 },
    { id: "standard", labelKey: "exp.qStandard", descKey: "exp.qStandardDesc", density: 2,   recommended: true },
    { id: "great",    labelKey: "exp.qGreat",    descKey: "exp.qGreatDesc",    density: 3 },
    { id: "heirloom", labelKey: "exp.qHeirloom", descKey: "exp.qHeirloomDesc", density: 4 }
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
      lineageFocusId: focusId,
      // Embedding is the only sensible mode (a JSON without inlined photos
      // is useless to anyone but this device's IDB), so it's hard-coded on
      // and the user-facing toggle is gone.
      embedPhotosInJson: true
    };

    // Plain muted text rather than a chip — chips read as toggles, and
    // sat next to "Minimal mode" the size estimate looked like a second
    // option you could click. It's a passive readout, not a control.
    const sizeReadout = UI.el("span", {
      class: "exp-size-readout",
      style: { color: "var(--text-3)", fontSize: "13px", fontVariantNumeric: "tabular-nums" }
    }, "");

    function refreshPreview() {
      try {
        const redacted = buildRedactedStateSync(state);
        const str = JSON.stringify(redacted);
        const bytes = new Blob([str]).size;
        sizeReadout.textContent = "JSON ≈ " + formatSize(bytes);
      } catch (e) {
        sizeReadout.textContent = "JSON ≈ —";
      }
    }

    // Lineage-only chip is shown only when a person is in focus.
    let lineageChip = null;
    if (focusId) {
      lineageChip = makeFieldChip({
        label: I18n.t("exp.onlyLineage", { name: focusName }),
        icon: "fa-solid fa-code-branch",
        active: true,
        onChange: (on) => { state.limitToLineage = on; }
      });
    }

    const fieldChips = UI.el("div", { class: "field-chips" }, [
      makeFieldChip({
        label: I18n.t("exp.photos"), icon: "fa-regular fa-image",
        active: true,
        onChange: (on) => { state.includePhotos = on; refreshPreview(); }
      }),
      makeFieldChip({
        label: I18n.t("exp.dates"), icon: "fa-regular fa-calendar",
        active: true,
        onChange: (on) => { state.includeDates = on; refreshPreview(); }
      }),
      makeFieldChip({
        label: I18n.t("exp.places"), icon: "fa-solid fa-location-dot",
        active: true,
        onChange: (on) => { state.includeLocations = on; refreshPreview(); }
      })
    ]);

    // Minimal-mode is a different beast: it overrides the field chips and
    // outputs only id/name/parents/spouses/gender/timestamps. Lives next to
    // the size estimate so the user sees the format-vs-size trade-off in
    // one place.
    const minimalChip = makeFieldChip({
      label: I18n.t("exp.minimalMode"),
      icon: "fa-solid fa-compress",
      active: false,
      onChange: (on) => {
        state.format = on ? MINIMAL : FULL;
        // Field chips are visually muted when minimal mode wins.
        fieldChips.classList.toggle("is-locked", on);
        refreshPreview();
      }
    });

    const jsonRow = UI.el("div", { class: "exp-json-row" }, [
      minimalChip,
      sizeReadout
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
            UI.el("span", null, I18n.t(q.labelKey)),
            q.recommended ? UI.el("span", { class: "png-quality__badge" }, [
              UI.el("i", { class: "fa-solid fa-star", "aria-hidden": "true" })
            ]) : null
          ]),
          UI.el("div", { class: "png-quality__desc" }, I18n.t(q.descKey)),
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
      UI.el("div", { class: "field__label", style: { marginBottom: "4px" } }, I18n.t("exp.pngQuality")),
      pngQualityHost
    ]);

    const body = UI.el("div", { class: "form-stack" }, [
      UI.el("p", { style: { color: "var(--text-3)", marginTop: "0", fontSize: "13px" } }, I18n.t("exp.body")),

      lineageChip ? UI.el("div", { class: "field-chips field-chips--single" }, [lineageChip]) : null,

      UI.el("div", { class: "field__label" }, I18n.t("exp.includeInExport")),
      fieldChips,

      pngSection,

      UI.el("div", { class: "field__label", style: { marginTop: "8px" } }, "JSON"),
      jsonRow
    ]);

    const cancelBtn = UI.cancelBtn(I18n.t("actions.cancel"));
    const pngBtn = UI.el("button", { class: "btn", type: "button" }, [
      UI.el("i", { class: "fa-regular fa-image", "aria-hidden": "true" }),
      UI.el("span", null, I18n.t("exp.savePng"))
    ]);
    const jsonBtn = UI.el("button", { class: "btn", type: "button" }, [
      UI.el("i", { class: "fa-solid fa-file-code", "aria-hidden": "true" }),
      UI.el("span", null, I18n.t("exp.saveJson"))
    ]);
    // Save backup — distinct mental model from "share with family". Bypasses
    // every toggle, preserves privacy flags (so re-import restores the
    // markings), inlines every photo as base64, names the file with a
    // virasat-backup- prefix so cloud-sync tools and Downloads search find
    // it as a recovery file.
    const backupBtn = UI.el("button", { class: "btn btn--primary", type: "button" }, [
      UI.el("i", { class: "fa-solid fa-shield-halved", "aria-hidden": "true" }),
      UI.el("span", null, I18n.t("exp.saveBackup"))
    ]);

    const dlg = UI.openModal({
      title: I18n.t("exp.title"),
      body,
      footer: [cancelBtn, pngBtn, jsonBtn, backupBtn]
    });

    cancelBtn.addEventListener("click", () => dlg.close());

    pngBtn.addEventListener("click", async () => {
      pngBtn.disabled = true;
      jsonBtn.disabled = true;
      // Swap the label-span's text in place so the button keeps its icon
      // child. Old code did pngBtn.innerHTML = "Rendering…" which wiped the
      // FA icon and the span structure; restoring `orig` only restored the
      // text label, leaving the button iconless after a successful export.
      const labelSpan = pngBtn.querySelector("span:not([aria-hidden])") || pngBtn;
      const origLabel = labelSpan.textContent;
      labelSpan.textContent = I18n.t("exp.rendering");
      try {
        if (!window.ImageExport) throw new Error("Image export not loaded.");
        const treeView = document.getElementById("view-tree");
        if (treeView && !treeView.classList.contains("is-active")) {
          document.querySelectorAll(".nav-btn").forEach((b) => {
            if (/** @type {HTMLElement} */ (b).dataset.view === "tree") /** @type {HTMLElement} */ (b).click();
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
        UI.toast(I18n.t("exp.pngSaved", { file: filename }), "success");
        dlg.close();
      } catch (e) {
        try { console.warn("[Virasat] PNG export failed:", e); } catch (_) {}
        UI.toast(I18n.t("exp.exportFailed"), "danger");
      } finally {
        pngBtn.disabled = false;
        jsonBtn.disabled = false;
        labelSpan.textContent = origLabel;
      }
    });

    jsonBtn.addEventListener("click", async () => {
      pngBtn.disabled = true;
      jsonBtn.disabled = true;
      backupBtn.disabled = true;
      const labelSpan = jsonBtn.querySelector("span:not([aria-hidden])") || jsonBtn;
      const origLabel = labelSpan.textContent;
      labelSpan.textContent = "…";
      try {
        // Wire embed-photos: when off, JSON skips inlining base64 even if includePhotos is on.
        const exportOpts = Object.assign({}, state, { skipPhotoInline: !state.embedPhotosInJson });
        const redacted = await buildRedactedStateAsync(exportOpts);
        const filename = "family-tree-" + todayISO() + ".json";
        UI.downloadFile(filename, JSON.stringify(redacted, null, 2));
        UI.toast(I18n.t("exp.exported", { n: redacted.people.length }), "success");
        dlg.close();
      } catch (e) {
        try { console.warn("[Virasat] JSON export failed:", e); } catch (_) {}
        UI.toast(I18n.t("exp.exportFailed"), "danger");
      } finally {
        pngBtn.disabled = false;
        jsonBtn.disabled = false;
        backupBtn.disabled = false;
        labelSpan.textContent = origLabel;
      }
    });

    backupBtn.addEventListener("click", async () => {
      pngBtn.disabled = true;
      jsonBtn.disabled = true;
      backupBtn.disabled = true;
      const labelSpan = backupBtn.querySelector("span:not([aria-hidden])") || backupBtn;
      const origLabel = labelSpan.textContent;
      labelSpan.textContent = I18n.t("exp.backingUp");
      try {
        const { state: backup, photoTotal, photoFailures } = await buildBackupState(null, state);
        const familyName = (FamilyStore.getFamilyTitle ? FamilyStore.getFamilyTitle() : null)
          || (backup.meta && backup.meta.familyName) || "family";
        const slug = backupSlug(familyName);
        const filename = "virasat-backup-" + (slug ? slug + "-" : "") + todayISO() + ".json";
        UI.downloadFile(filename, JSON.stringify(backup, null, 2));
        if (photoFailures === 0) {
          UI.toast(I18n.t("exp.backupSaved", { file: filename }), "success");
        } else {
          UI.toast(I18n.t("exp.backupPartial", { failed: photoFailures, total: photoTotal }), "warning");
        }
        dlg.close();
      } catch (e) {
        try { console.warn("[Virasat] backup failed:", e); } catch (_) {}
        UI.toast(I18n.t("exp.backupFailed"), "danger");
      } finally {
        pngBtn.disabled = false;
        jsonBtn.disabled = false;
        backupBtn.disabled = false;
        labelSpan.textContent = origLabel;
      }
    });

    refreshPreview();
  }

  // Local slug for the backup filename. ASCII-only, dash-separated, capped
  // at a sensible length so the filename stays readable in Downloads.
  function backupSlug(s) {
    return String(s || "")
      .normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32);
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
    const input = /** @type {HTMLInputElement} */ (document.getElementById("import-file-input"));
    if (!input) {
      UI.toast(I18n.t("imp.fileInputMissing"), "danger");
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
          UI.toast(I18n.t("imp.csvUnavailable"), "danger");
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

      // Replace overwrites the tree for EVERY member and pushes to them (editors
      // can trigger it too), so when the active tree is shared, name how many
      // people lose their copy before confirming. The member-count read is raced
      // against a short timeout and falls back to null so a slow/blocked network
      // never stalls the import behind this advisory check.
      const sharedWith = await activeMemberCountSafe();
      const isShared = typeof sharedWith === "number" && sharedWith > 1;
      const ok = await UI.confirm({
        title: I18n.t("imp.confirmTitle"),
        message: isShared
          ? I18n.t("imp.confirmMsgShared", { a: currentCount, b: newCount, members: sharedWith })
          : I18n.t("imp.confirmMsg", { a: currentCount, b: newCount }),
        confirmLabel: I18n.t("imp.confirmBtn"),
        danger: true
      });

      if (ok) {
        try {
          FamilyStore.replaceAll(parsed);
          // Migrate any base64 photos that came in via the JSON into IndexedDB
          // so localStorage doesn't bloat. Async; if it fails we surface but
          // don't block the import — photos will still render via the legacy
          // base64 fallback. Then (cloud mode only) backfill the migrated blobs
          // to the bucket so the imported photos sync to other devices —
          // replaceAll'd photoIds never went through fileToPhotoId's upload.
          if (window.PhotoStore && PhotoStore.migrateLegacy) {
            PhotoStore.migrateLegacy()
              .then(() => PhotoStore.backfillToCloud && PhotoStore.backfillToCloud())
              .catch((e) => console.warn("Photo migration/backfill:", e));
          }
          UI.toast(I18n.t("imp.imported", { n: newCount }), "success");
        } catch (e) {
          try { console.warn("[Virasat] import failed:", e); } catch (_) {}
          UI.toast(I18n.t("imp.importFailed"), "danger");
        }
      }
      reset();
    };

    input.addEventListener("change", onChange);
    input.click();
  }

  // One-call backup download. Used by the conflict banner to rescue a losing
  // local edit before last-writer-wins overwrites it: cloud-store snapshots the
  // doomed state and passes it here, so the file holds the edit the user is
  // about to lose — not the server copy that just replaced it. With no argument
  // it backs up the current live tree (a generic "save a copy" entry point).
  // Returns { ok, filename?, photoFailures?, empty?, error? } — never throws.
  async function downloadBackupState(srcState) {
    try {
      const src = srcState || FamilyStore.getState();
      if (!src || !Array.isArray(src.people) || src.people.length === 0) {
        return { ok: false, empty: true };
      }
      const { state: backup, photoFailures } = await buildBackupState(src);
      const familyName = (backup.meta && backup.meta.familyName)
        || (FamilyStore.getFamilyTitle && FamilyStore.getFamilyTitle()) || "family";
      const slug = backupSlug(familyName);
      const filename = "virasat-backup-" + (slug ? slug + "-" : "") + todayISO() + ".json";
      UI.downloadFile(filename, JSON.stringify(backup, null, 2));
      return { ok: true, filename, photoFailures };
    } catch (e) {
      console.error("Backup download failed:", e);
      return { ok: false, error: (e && e.message) || "unknown" };
    }
  }

  global.ExportImport = { openExport, openImport, downloadBackupState };
})(window);
