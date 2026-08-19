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
      // Document scans inline exactly like gallery photos — the backup carries
      // the scan bytes so it's self-contained on a fresh device.
      if (Array.isArray(out.documents) && out.documents.length) {
        out.documents = await Promise.all(out.documents.map(async (d) => {
          if (!d || (!d.photo && !d.photoId)) return d;
          photoTotal++;
          const r = await inlinePhoto(d);
          if (r.ok) { const dd = { ...d, photo: r.dataUrl }; delete dd.photoId; return dd; }
          photoFailures++;
          return d;
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
      // Documents are scan images; without photos there's nothing to ship but a
      // citation note, and a citation with no source is misleading — drop them.
      delete out.documents;
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
      // Document scans are stored larger (legible text) → account ~120KB each.
      if (Array.isArray(out.documents)) out.documents.forEach((d) => {
        if (d && !d.photo && d.photoId) d.photo = "[binary scan, ~120KB]";
        if (d) delete d.photoId;
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
      // Document scans inline the same way — read each IDB blob to base64,
      // dropping the photoId so the receiver doesn't chase a stale key.
      if (Array.isArray(out.documents)) {
        out.documents = await Promise.all(out.documents.map(async (d) => {
          if (!d) return d;
          const dd = { ...d };
          delete dd.photoId;
          if (opts.skipPhotoInline) { delete dd.photo; }
          else if (window.PhotoStore && d.photoId && !dd.photo) {
            try { const blob = await PhotoStore.get(d.photoId); if (blob) dd.photo = await blobToDataUrl(blob); } catch (_) {}
          }
          return dd;
        }));
      }
    } else {
      delete out.photo; delete out.photoId;
      delete out.gallery;
      delete out.documents;
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

  // Read the live tree's View Options so the PNG export can default to the
  // same visible state. Mirrors tree-view.js readBool: a missing key is the
  // feature's own default (all default ON except when the user turned it off);
  // any stored value other than "0" is truthy. Relations are special — the
  // on-node kin pills only render live when BOTH "relation to me" is on AND a
  // self person is pinned, so gate the export default on both to avoid offering
  // a relations toggle that could never draw anything.
  function readLiveTreeToggles() {
    function b(key, dflt) {
      try {
        var v = localStorage.getItem(key);
        if (v === null) return dflt;
        return v !== "0";
      } catch (_) { return dflt; }
    }
    var hasSelf = !!(window.SelfAnchor && SelfAnchor.get && SelfAnchor.get());
    return {
      pets: b("virasat.showPets", true),
      // `age` toggle — persisted under "virasat.showAge" (migrated from the
      // legacy "virasat.showStoryCount" key by tree-view.js at startup).
      age: b("virasat.showAge", true),
      eras: b("virasat.showEras", true),
      relations: hasSelf && b("virasat.showRelationToMe", true)
    };
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

    // The PNG export clones the LIVE tree SVG, so it can only ever trim what's
    // on screen — never re-add a feature you've hidden in View Options. Seed the
    // "shown in the image" chips from those live toggles so the export defaults
    // to exactly the tree the user is looking at; each chip then lets them trim
    // that feature out of this one shared image. Relations follow the live
    // "relation to me" toggle AND require a pinned self — a per-viewer lens, so
    // it's only ever on if the user already opted in on screen.
    const liveShow = readLiveTreeToggles();

    // Options are split by artifact so the two panels never share a control.
    // The older single includePhotos/includeDates set was rendered in BOTH the
    // image and data panels, which let minimal-mode's "locked" styling bleed
    // across formats. `image.*` are on-canvas display toggles (seeded from the
    // live tree's View Options); `data.*` are what the JSON file carries. Photos
    // in the image (discs on nodes) and photos in the file (embedded base64) are
    // genuinely different choices, so they're independent flags now.
    const state = {
      // Which artifact the single Save button produces: "png" | "json" | "backup".
      exportFormat: "png",
      image: {
        photos: true,
        dates: true,
        pets: liveShow.pets,
        age: liveShow.age,
        eras: liveShow.eras,
        relations: liveShow.relations
      },
      data: {
        photos: true,
        dates: true,
        places: true,
        minimal: false
      },
      pngQuality: "standard",
      // Lineage scope is shared (image + data); a backup is always the whole tree.
      limitToLineage: !!focusId,
      lineageFocusId: focusId
    };

    // The redaction/preview pipeline reads flat opts (format + include*). Build
    // them from state.data so the data panel stays the single source of truth,
    // and photos are always embedded (a JSON without inlined photos is useless
    // off this device — skipPhotoInline stays false everywhere it's exported).
    function dataOpts() {
      return {
        format: state.data.minimal ? MINIMAL : FULL,
        includePhotos: state.data.photos,
        includeDates: state.data.dates,
        includeLocations: state.data.places,
        limitToLineage: state.limitToLineage,
        lineageFocusId: state.lineageFocusId
      };
    }

    // Plain muted text rather than a chip — chips read as toggles, and
    // sat next to "Minimal mode" the size estimate looked like a second
    // option you could click. It's a passive readout, not a control.
    const sizeReadout = UI.el("span", {
      class: "exp-size-readout",
      style: { color: "var(--text-3)", fontSize: "13px", fontVariantNumeric: "tabular-nums" }
    }, "");

    function refreshPreview() {
      try {
        const redacted = buildRedactedStateSync(dataOpts());
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

    // — Format picker — the single choice that reshapes the rest of the dialog:
    // an image to print/share, a data file to re-import, or a full backup.
    // Radio-cards, same idiom as the import + PNG-quality pickers, so only the
    // options relevant to the chosen format are ever shown (no more three
    // competing Save buttons).
    const FORMATS = [
      { id: "png",    icon: "fa-regular fa-image",       titleKey: "exp.fmtImageTitle",  descKey: "exp.fmtImageDesc" },
      { id: "json",   icon: "fa-solid fa-file-code",     titleKey: "exp.fmtDataTitle",   descKey: "exp.fmtDataDesc" },
      { id: "backup", icon: "fa-solid fa-shield-halved", titleKey: "exp.fmtBackupTitle", descKey: "exp.fmtBackupDesc" }
    ];
    const formatHost = UI.el("div", { class: "exp-format" });
    const formatCards = [];
    FORMATS.forEach((f) => {
      const card = UI.el("button", {
        type: "button", class: "exp-format__card", "aria-pressed": "false",
        onclick: () => { state.exportFormat = f.id; applyFormat(); }
      }, [
        UI.el("div", { class: "exp-format__label" }, [
          UI.el("i", { class: f.icon, "aria-hidden": "true" }),
          UI.el("span", null, I18n.t(f.titleKey))
        ]),
        UI.el("div", { class: "exp-format__desc" }, I18n.t(f.descKey))
      ]);
      formatCards.push({ id: f.id, el: card });
      formatHost.appendChild(card);
    });

    // Image display chips — one "Shown in the image" group covering every
    // on-canvas feature (photos, dates, pets, age, decade markers, and — only
    // when it could actually draw — relation labels). Seeded from the live
    // tree's View Options; each chip trims that feature out of this one image.
    // These live only in the image panel, so nothing here can touch the data
    // file. `relations` renders only when a self is pinned + "relation to me"
    // is on live, matching the live popover's gating.
    const imgChipDefs = [
      { key: "photos", label: I18n.t("exp.imgPhotos"), icon: "fa-regular fa-image" },
      { key: "dates",  label: I18n.t("exp.imgDates"),  icon: "fa-regular fa-calendar" },
      { key: "pets",   label: I18n.t("exp.imgPets"),   icon: "fa-solid fa-paw" },
      { key: "age",    label: I18n.t("exp.imgAge"),    icon: "fa-solid fa-hourglass-half" },
      { key: "eras",   label: I18n.t("exp.imgEras"),   icon: "fa-solid fa-layer-group" }
    ];
    const imgChips = imgChipDefs.map((d) => makeFieldChip({
      label: d.label, icon: d.icon, active: state.image[d.key],
      onChange: (on) => { state.image[d.key] = on; }
    }));
    // Only surface the relations chip when it would render something.
    if (liveShow.relations) {
      imgChips.push(makeFieldChip({
        label: I18n.t("exp.imgRelations"), icon: "fa-solid fa-people-arrows",
        active: state.image.relations,
        onChange: (on) => { state.image.relations = on; }
      }));
    }
    const imageExtras = UI.el("div", { class: "field-chips" }, imgChips);

    // Data-file chips — what the JSON carries (photos as embedded base64, dates,
    // locations). Their own instances, living only in the data panel, so minimal
    // mode can grey them without touching the image panel.
    const dataChips = UI.el("div", { class: "field-chips" }, [
      makeFieldChip({
        label: I18n.t("exp.photos"), icon: "fa-regular fa-image", active: state.data.photos,
        onChange: (on) => { state.data.photos = on; refreshPreview(); }
      }),
      makeFieldChip({
        label: I18n.t("exp.dates"), icon: "fa-regular fa-calendar", active: state.data.dates,
        onChange: (on) => { state.data.dates = on; refreshPreview(); }
      }),
      makeFieldChip({
        label: I18n.t("exp.places"), icon: "fa-solid fa-location-dot", active: state.data.places,
        onChange: (on) => { state.data.places = on; refreshPreview(); }
      })
    ]);

    // Minimal mode (data only): overrides the chips above and outputs just
    // id/name/parents/spouses/gender/timestamps. Greys the data chips (its own
    // container only) to signal they no longer apply, and sits beside the size
    // estimate so the format-vs-size trade-off reads in one place.
    const minimalChip = makeFieldChip({
      label: I18n.t("exp.minimalMode"),
      icon: "fa-solid fa-compress",
      active: false,
      onChange: (on) => {
        state.data.minimal = on;
        dataChips.classList.toggle("is-locked", on);
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

    // Small labeled group: a caption above its control(s), tight spacing.
    const group = (labelText, control) => UI.el("div", { class: "exp-group" }, [
      UI.el("div", { class: "field__label" }, labelText),
      control
    ]);

    // Per-format option panels — only the active one is shown (applyFormat).
    // Image: on-canvas display chips + quality. Data: what the file carries +
    // minimal-mode + size estimate. Backup: a reassurance note — it takes no
    // options. Each panel owns its controls outright, so switching format can
    // never leave another format's chips in a stale/greyed state.
    const imagePanel = UI.el("div", { class: "exp-panel" }, [
      group(I18n.t("exp.shownInImage"), imageExtras),
      group(I18n.t("exp.pngQuality"), pngQualityHost)
    ]);
    const dataPanel = UI.el("div", { class: "exp-panel" }, [
      group(I18n.t("exp.includeInExport"), dataChips),
      jsonRow
    ]);
    const backupPanel = UI.el("div", { class: "exp-panel" }, [
      UI.el("div", {
        style: {
          display: "flex", gap: "8px", alignItems: "flex-start", padding: "8px 10px",
          borderRadius: "var(--r-sm)", background: "var(--olive-soft)", color: "var(--olive-deep)",
          fontSize: "12.5px", lineHeight: "1.5"
        }
      }, [
        UI.el("i", { class: "fa-solid fa-shield-halved", "aria-hidden": "true", style: { marginTop: "2px" } }),
        UI.el("span", null, I18n.t("exp.backupNote"))
      ])
    ]);

    // Lineage-only scope (image + data; a backup is always the whole tree).
    const lineageWrap = lineageChip
      ? UI.el("div", { class: "field-chips field-chips--single" }, [lineageChip])
      : null;

    const body = UI.el("div", { class: "form-stack" }, [
      UI.el("p", { style: { color: "var(--text-3)", marginTop: "0", fontSize: "13px" } }, I18n.t("exp.body")),
      group(I18n.t("exp.fmtLabel"), formatHost),
      lineageWrap,
      imagePanel,
      dataPanel,
      backupPanel
    ]);

    // Reflect the chosen format: light up its card, show only that format's
    // panel (each is self-contained), hide the lineage scope for a backup
    // (always whole-tree), and repoint the single Save button's icon + label.
    function applyFormat() {
      const fmt = state.exportFormat;
      formatCards.forEach((c) => {
        const on = c.id === fmt;
        c.el.classList.toggle("is-active", on);
        c.el.setAttribute("aria-pressed", on ? "true" : "false");
      });
      const isBackup = fmt === "backup";
      imagePanel.style.display = fmt === "png" ? "" : "none";
      dataPanel.style.display = fmt === "json" ? "" : "none";
      backupPanel.style.display = isBackup ? "" : "none";
      if (lineageWrap) lineageWrap.style.display = isBackup ? "none" : "";
      saveIcon.className = fmt === "png" ? "fa-regular fa-image"
        : isBackup ? "fa-solid fa-shield-halved" : "fa-solid fa-file-code";
      saveLabel.textContent = fmt === "png" ? I18n.t("exp.savePng")
        : isBackup ? I18n.t("exp.saveBackup") : I18n.t("exp.saveJson");
    }

    const cancelBtn = UI.cancelBtn(I18n.t("actions.cancel"));
    // One Save button — its icon + label track the chosen format (set by
    // applyFormat), replacing the old trio of competing Save buttons.
    const saveIcon = UI.el("i", { "aria-hidden": "true" });
    const saveLabel = UI.el("span", null, "");
    const saveBtn = UI.el("button", { class: "btn btn--primary", type: "button" }, [saveIcon, saveLabel]);

    const dlg = UI.openModal({
      title: I18n.t("exp.title"),
      body,
      footer: [cancelBtn, saveBtn]
    });

    cancelBtn.addEventListener("click", () => dlg.close());

    // Each exporter shows its own success/error toast and resolves to whether
    // it succeeded; runExport owns the shared busy state and closes on success.
    async function exportPng() {
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
          includePhotos: state.image.photos,
          includeDates: state.image.dates,
          includePets: state.image.pets,
          includeAge: state.image.age,
          includeEras: state.image.eras,
          includeRelations: state.image.relations,
          focusId: state.limitToLineage ? state.lineageFocusId : null
        });
        ImageExport.download(blob, filename);
        UI.toast(I18n.t("exp.pngSaved", { file: filename }), "success");
        return true;
      } catch (e) {
        try { console.warn("[Virasat] PNG export failed:", e); } catch (_) {}
        UI.toast(I18n.t("exp.exportFailed"), "danger");
        return false;
      }
    }

    async function exportJson() {
      try {
        // Photos are always embedded as base64 (a JSON without inlined photos is
        // useless off this device), so skipPhotoInline stays false.
        const exportOpts = Object.assign({}, dataOpts(), { skipPhotoInline: false });
        const redacted = await buildRedactedStateAsync(exportOpts);
        const filename = "family-tree-" + todayISO() + ".json";
        UI.downloadFile(filename, JSON.stringify(redacted, null, 2));
        UI.toast(I18n.t("exp.exported", { n: redacted.people.length }), "success");
        return true;
      } catch (e) {
        try { console.warn("[Virasat] JSON export failed:", e); } catch (_) {}
        UI.toast(I18n.t("exp.exportFailed"), "danger");
        return false;
      }
    }

    // Backup — distinct mental model from "share with family". Bypasses every
    // toggle, preserves privacy flags (so re-import restores the markings),
    // inlines every photo as base64, and names the file with a virasat-backup-
    // prefix so cloud-sync tools and Downloads search find it as a recovery file.
    async function exportBackup() {
      try {
        // A backup is always the whole tree — it's a safety copy, and its panel
        // hides the lineage-scope chip. Force limitToLineage off so a focus that
        // was active when the dialog opened can't silently truncate the backup.
        const backupOpts = Object.assign({}, state, { limitToLineage: false });
        const { state: backup, photoTotal, photoFailures } = await buildBackupState(null, backupOpts);
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
        return true;
      } catch (e) {
        try { console.warn("[Virasat] backup failed:", e); } catch (_) {}
        UI.toast(I18n.t("exp.backupFailed"), "danger");
        return false;
      }
    }

    async function runExport() {
      const fmt = state.exportFormat;
      const labelSpan = saveBtn.querySelector("span:not([aria-hidden])") || saveBtn;
      const origLabel = labelSpan.textContent;
      saveBtn.disabled = true;
      cancelBtn.disabled = true;
      formatCards.forEach((c) => { c.el.disabled = true; });
      labelSpan.textContent = fmt === "png" ? I18n.t("exp.rendering")
        : fmt === "backup" ? I18n.t("exp.backingUp") : "…";
      let ok = false;
      try {
        ok = fmt === "png" ? await exportPng()
          : fmt === "backup" ? await exportBackup() : await exportJson();
      } finally {
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
        formatCards.forEach((c) => { c.el.disabled = false; });
        labelSpan.textContent = origLabel;
      }
      if (ok) dlg.close();
    }
    saveBtn.addEventListener("click", runExport);

    applyFormat();
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

  // Arrange a flat people[] into a tree(1)-style descendant chart. A family is
  // a DAG (every child has up to two parents who are a married couple), so a
  // naïve "hang each child under its first parent" splits siblings across the
  // two parents and turns every married-in spouse (who has no parents in the
  // file) into a bogus root. Instead we treat each couple as one household:
  //   • Of a couple, the "primary" is the partner whose OWN parents are in the
  //     file (the bloodline that links upward); the other rides along as an
  //     inline "& spouse" and never gets its own node. Ties (both or neither
  //     bloodline — e.g. the top couple, or a data quirk where two siblings are
  //     married) break by earlier birth, then name, then id — deterministic so
  //     every child of the couple anchors to the SAME primary no matter which
  //     order its parents[] lists mother/father.
  //   • A child is attached under the primary of its parents' couple, deduped.
  //   • Roots are primaries with no in-file parents; sibling groups sort by
  //     birth year then name.
  // Returns [{ prefix, person, spouse }] where prefix is the box-drawing stem
  // ("├── ", "│   ", "└── ", …), person is the primary, and spouse is the
  // married-in partner (or null). Cyclic parent refs are guarded; any primary
  // not reached from a root is listed flush-left, so every household shows.
  function buildTreeLines(people) {
    const byId = new Map();
    people.forEach((p) => { if (p && p.id != null) byId.set(p.id, p); });

    const inFileParents = (p) => (Array.isArray(p.parents) ? p.parents : []).filter((id) => id !== p.id && byId.has(id));
    const firstSpouse = (p) => {
      const sps = Array.isArray(p.spouses) ? p.spouses : [];
      for (let i = 0; i < sps.length; i++) if (sps[i] !== p.id && byId.has(sps[i])) return byId.get(sps[i]);
      return null;
    };
    const yearOf = (p) => {
      const y = p && FamilyStore.getYear ? FamilyStore.getYear(p.birthDate) : null;
      return typeof y === "number" ? y : Infinity;
    };
    const nameOf = (p) => String((p && FamilyStore.getField(p, "name")) || "");

    // primaryOf(id) → the household's primary id (self when single). Caches
    // both partners to the same winner on first computation.
    const primaryCache = new Map();
    const primaryOf = (id) => {
      if (primaryCache.has(id)) return primaryCache.get(id);
      const a = byId.get(id);
      const b = a ? firstSpouse(a) : null;
      if (!a || !b) { primaryCache.set(id, id); return id; }
      const aBlood = inFileParents(a).length > 0;
      const bBlood = inFileParents(b).length > 0;
      let winner;
      if (aBlood !== bBlood) winner = aBlood ? a : b;
      else {
        const ya = yearOf(a), yb = yearOf(b);
        if (ya !== yb) winner = ya < yb ? a : b;
        else {
          const c = nameOf(a).localeCompare(nameOf(b));
          winner = c !== 0 ? (c < 0 ? a : b) : (String(a.id) < String(b.id) ? a : b);
        }
      }
      primaryCache.set(a.id, winner.id);
      primaryCache.set(b.id, winner.id);
      return winner.id;
    };

    const order = (a, b) => {
      const ya = yearOf(a), yb = yearOf(b);
      if (ya !== yb) return ya - yb;            // undated (Infinity) sinks to the end
      return nameOf(a).localeCompare(nameOf(b));
    };

    // children of each primary, deduped (a child couple reaches the same anchor
    // via either partner's parents[]).
    const childrenOf = new Map();
    const seenChild = new Map();                // anchorId → Set(childPrimaryId)
    people.forEach((p) => {
      if (!p || p.id == null) return;
      const parents = inFileParents(p);
      if (parents.length === 0) return;
      const anchor = primaryOf(parents[0]);     // parents are a couple → one primary
      const childPrimary = primaryOf(p.id);
      if (childPrimary === anchor) return;      // self/loop guard
      if (!childrenOf.has(anchor)) { childrenOf.set(anchor, []); seenChild.set(anchor, new Set()); }
      const set = seenChild.get(anchor);
      if (!set.has(childPrimary)) { set.add(childPrimary); childrenOf.get(anchor).push(byId.get(childPrimary)); }
    });
    childrenOf.forEach((arr) => arr.sort(order));

    const isChild = new Set();
    childrenOf.forEach((arr) => arr.forEach((c) => isChild.add(c.id)));
    const roots = people
      .filter((p) => p && p.id != null && primaryOf(p.id) === p.id && !isChild.has(p.id))
      .sort(order);

    const lines = [];
    const seen = new Set();
    const emit = (p, prefix, isLast, isRoot) => {
      if (seen.has(p.id)) return;               // cyclic parent ref — bail
      seen.add(p.id);
      const sp = firstSpouse(p);
      if (sp) seen.add(sp.id);                  // partner shown inline, not as its own node
      const branch = isRoot ? "" : (isLast ? "└── " : "├── ");
      lines.push({ prefix: prefix + branch, person: p, spouse: sp });
      const kids = childrenOf.get(p.id) || [];
      const nextPrefix = isRoot ? "" : prefix + (isLast ? "    " : "│   ");
      kids.forEach((k, i) => emit(k, nextPrefix, i === kids.length - 1, false));
    };
    roots.forEach((r, i) => emit(r, "", i === roots.length - 1, true));

    // Any primary not reached (cyclic parent ref) → flush-left, so no household
    // is silently dropped. Non-primary spouses are already shown via a partner.
    people.forEach((p) => {
      if (!p || p.id == null || seen.has(p.id)) return;
      if (primaryOf(p.id) !== p.id) return;
      seen.add(p.id);
      const sp = firstSpouse(p);
      if (sp) seen.add(sp.id);
      lines.push({ prefix: "", person: p, spouse: sp });
    });
    return lines;
  }

  // Rich import preview. Stands in for a bare confirm() ahead of the import:
  // the user sees what the file actually holds — family name, how many people /
  // marriages / photos, and the full roster as a tree hierarchy — then chooses
  // what to do with it. In cloud mode that's a choice between "add as a new
  // tree" (the safe default — overwrites nothing) and "replace this tree" (the
  // destructive path, still guarded by the "can't undo" warning, worded for
  // shared vs solo trees); signed out there's only the single replace path. In
  // "new" mode the user can also rename the tree before it's provisioned.
  // Resolves to { mode: "new"|"replace", name }; Cancel / Esc / backdrop /
  // ✕ resolve null. Reads parsed data, mutates nothing.
  function confirmImportWithPreview(parsed, opts) {
    const o = opts || {};
    const currentCount = o.currentCount || 0;
    const newCount = o.newCount || 0;
    const isShared = !!o.isShared;
    const sharedWith = o.sharedWith;
    const t = (k, v) => I18n.t(k, v);

    // Multi-tree lives only in cloud mode (signed-out has a single local tree),
    // so "add as a new tree" is offered only when cloud is active. Otherwise the
    // dialog keeps its original single, destructive Replace behaviour.
    const cloudActive = !!(window.CloudStore && window.CloudStore.isActive && window.CloudStore.isActive());

    const people = Array.isArray(parsed.people) ? parsed.people : [];
    const meta = (parsed && parsed.meta) || {};
    const familyName = String(meta.familyName || meta.familyTitle || "").trim();
    // Marriages live in each person's spouses[] (the v2 source of truth); the
    // top-level `marriages` map is usually empty, so count unique unordered
    // spouse-pairs and only fall back to the map when there are no spouse links.
    const idSet = new Set(people.map((p) => p && p.id).filter((x) => x != null));
    const coupleKeys = new Set();
    people.forEach((p) => {
      if (!p || p.id == null) return;
      (Array.isArray(p.spouses) ? p.spouses : []).forEach((sid) => {
        if (sid != null && sid !== p.id && idSet.has(sid)) coupleKeys.add([String(p.id), String(sid)].sort().join("|"));
      });
    });
    const marriageCount = coupleKeys.size
      || (parsed && parsed.marriages && typeof parsed.marriages === "object" ? Object.keys(parsed.marriages).length : 0);
    const photoCount = people.filter((p) => p && (p.photo || p.photoId)).length;

    // Three at-a-glance counts of what the file carries.
    const statChip = (count, labelKey, icon) => UI.el("div", {
      style: {
        flex: "1 1 0", textAlign: "center", padding: "var(--s-3)",
        background: "rgba(94, 125, 99, .06)", borderRadius: "var(--r-md)"
      }
    }, [
      UI.el("i", { class: icon, "aria-hidden": "true", style: { color: "var(--text-3)" } }),
      UI.el("div", { style: { fontSize: "22px", fontWeight: "700", lineHeight: "1.2" } }, String(count)),
      UI.el("div", { class: "field__label", style: { marginTop: "2px" } }, t(labelKey))
    ]);
    const statRow = UI.el("div", { style: { display: "flex", gap: "8px" } }, [
      statChip(newCount, "imp.statPeople", "fa-solid fa-users"),
      statChip(marriageCount, "imp.statMarriages", "fa-solid fa-heart"),
      statChip(photoCount, "imp.statPhotos", "fa-solid fa-image")
    ]);

    // The full roster as a tree(1)-style descendant chart — every person
    // present (no truncation), children under their parents' household, and
    // each married-in spouse shown inline as "& spouse", so the shape of the
    // family reads at a glance before the import commits. A monospace stem
    // keeps the │ / ├── / └── columns aligned across rows; names and dates
    // stay in the proportional UI font.
    const stemStyle = { fontFamily: "var(--font-mono)", whiteSpace: "pre", color: "var(--text-3)" };
    const nameStyle = { fontWeight: "600" };
    const dateStyle = { color: "var(--text-3)", marginLeft: "6px", fontSize: "12px" };
    const ampStyle = { color: "var(--text-3)", margin: "0 6px" };
    const rowStyle = { whiteSpace: "nowrap", padding: "1px 0", fontSize: "13px", lineHeight: "1.7" };
    const nameText = (p) => String(FamilyStore.getField(p, "name") || "").trim() || t("imp.previewUnnamed");
    const dateText = (p) => {
      const d = FamilyStore.formatDateRange ? FamilyStore.formatDateRange(p) : "";
      return d && d !== "—" ? d : "";
    };
    const treeRows = buildTreeLines(people).map(({ prefix, person, spouse }) => {
      const cells = [
        UI.el("span", { style: stemStyle }, prefix),
        UI.el("span", { style: nameStyle }, nameText(person))
      ];
      const pd = dateText(person);
      if (pd) cells.push(UI.el("span", { style: dateStyle }, pd));
      if (spouse) {
        cells.push(UI.el("span", { style: ampStyle }, "&"));
        cells.push(UI.el("span", { style: nameStyle }, nameText(spouse)));
        const sd = dateText(spouse);
        if (sd) cells.push(UI.el("span", { style: dateStyle }, sd));
      }
      return UI.el("div", { style: rowStyle }, cells);
    });
    // overflow:auto (both axes) mirrors a terminal: deep/wide trees scroll
    // rather than wrap and break the connector columns.
    const rosterTree = UI.el("div", {
      style: {
        maxHeight: "300px", overflow: "auto", border: "1px solid var(--line)",
        borderRadius: "var(--r-md)", padding: "8px 12px"
      }
    }, treeRows);

    // The destructive-action warning — same copy as the old confirm(), now a
    // callout under the preview. Shown only when the chosen mode is "replace"
    // (in cloud mode the user can instead add the file as a new tree, which
    // overwrites nothing).
    const warnText = isShared
      ? t("imp.confirmMsgShared", { a: currentCount, b: newCount, members: sharedWith })
      : t("imp.confirmMsg", { a: currentCount, b: newCount });
    const warning = UI.el("div", {
      style: {
        display: "flex", gap: "8px", alignItems: "flex-start", padding: "8px 10px",
        borderRadius: "var(--r-sm)", background: "var(--danger-soft)", color: "var(--danger)",
        fontSize: "12.5px", lineHeight: "1.5"
      }
    }, [
      UI.el("i", { class: "fa-solid fa-triangle-exclamation", "aria-hidden": "true", style: { marginTop: "2px" } }),
      UI.el("span", null, warnText)
    ]);

    // The reassuring counterpart shown for the non-destructive "new tree" mode.
    const newNote = cloudActive ? UI.el("div", {
      style: {
        display: "none", gap: "8px", alignItems: "flex-start", padding: "8px 10px",
        borderRadius: "var(--r-sm)", background: "var(--olive-soft)", color: "var(--olive-deep)",
        fontSize: "12.5px", lineHeight: "1.5"
      }
    }, [
      UI.el("i", { class: "fa-solid fa-circle-info", "aria-hidden": "true", style: { marginTop: "2px" } }),
      UI.el("span", null, t("imp.modeNewNote", { a: currentCount }))
    ]) : null;

    // Destination picker (cloud only): add as a NEW tree — the safe default —
    // or REPLACE the current one. Radio-card style, mirroring the export
    // dialog's PNG-quality picker; the replace card tints danger-red when active.
    let mode = cloudActive ? "new" : "replace";
    const modeCards = [];
    let modeHost = null;
    if (cloudActive) {
      const MODES = [
        { id: "new", icon: "fa-solid fa-code-branch", titleKey: "imp.modeNewTitle", descKey: "imp.modeNewDesc" },
        { id: "replace", icon: "fa-solid fa-arrows-rotate", titleKey: "imp.modeReplaceTitle", descKey: "imp.modeReplaceDesc", danger: true }
      ];
      modeHost = UI.el("div", { class: "import-mode" });
      MODES.forEach((m) => {
        const card = UI.el("button", {
          type: "button",
          class: "import-mode__card" + (m.danger ? " import-mode__card--danger" : ""),
          "aria-pressed": "false",
          onclick: () => { mode = m.id; applyMode(); }
        }, [
          UI.el("div", { class: "import-mode__label" }, [
            UI.el("i", { class: m.icon, "aria-hidden": "true" }),
            UI.el("span", null, t(m.titleKey))
          ]),
          UI.el("div", { class: "import-mode__desc" }, t(m.descKey))
        ]);
        modeCards.push({ id: m.id, el: card });
        modeHost.appendChild(card);
      });
    }

    // The new tree's name (cloud "new" mode only). Prefilled from the file's own
    // meta so it defaults to the imported family's name, but editable here — the
    // natural moment to rename, since this is where the tree gets provisioned
    // (e.g. keep two "Sharma" files apart as "Sharma — paternal"). Hidden in
    // replace mode, where the name isn't ours to set.
    let nameInput = null, nameField = null;
    if (cloudActive) {
      const defaultName = String(meta.familyTitle || meta.familyName || "").trim();
      nameInput = UI.el("input", {
        class: "input", type: "text", value: defaultName, maxlength: "80",
        placeholder: t("imp.newTreeNamePlaceholder")
      });
      nameField = UI.el("label", { class: "field" }, [
        UI.el("span", { class: "field__label" }, t("imp.newTreeNameLabel")),
        nameInput
      ]);
    }

    const body = UI.el("div", { class: "form-stack" }, [
      familyName ? UI.el("div", {
        style: { display: "flex", alignItems: "center", gap: "8px", fontSize: "15px", fontWeight: "600" }
      }, [
        UI.el("i", { class: "fa-solid fa-tree", "aria-hidden": "true", style: { color: "var(--olive)" } }),
        UI.el("span", null, familyName)
      ]) : null,
      statRow,
      UI.el("div", { class: "field__label", style: { marginTop: "4px" } }, t("imp.previewSample")),
      rosterTree,
      cloudActive ? UI.el("div", { class: "field__label", style: { marginTop: "4px" } }, t("imp.modeLabel")) : null,
      modeHost,
      nameField,
      warning,
      newNote
    ]);

    const cancelBtn = UI.cancelBtn(t("actions.cancel"));
    const importIcon = UI.el("i", { "aria-hidden": "true" });
    const importLabel = UI.el("span", null, "");
    const importBtn = UI.el("button", { type: "button", class: "btn" }, [importIcon, importLabel]);

    // Reflect the selected mode across the cards, the two callouts, and the
    // commit button (label + danger styling). Also the initial paint.
    function applyMode() {
      modeCards.forEach((c) => {
        const on = c.id === mode;
        c.el.classList.toggle("is-active", on);
        c.el.setAttribute("aria-pressed", on ? "true" : "false");
      });
      const danger = mode === "replace";
      warning.style.display = danger ? "flex" : "none";
      if (newNote) newNote.style.display = danger ? "none" : "flex";
      if (nameField) nameField.style.display = danger ? "none" : "flex";
      importBtn.className = "btn " + (danger ? "btn--danger" : "btn--primary");
      importIcon.className = danger ? "fa-solid fa-file-import" : "fa-solid fa-code-branch";
      importLabel.textContent = danger ? t("imp.confirmBtn") : t("imp.confirmBtnNew");
    }
    applyMode();

    // Resolves to { mode: "new"|"replace", name } — name is the (trimmed) tree
    // name typed for "new" mode, "" otherwise. null on cancel/dismiss.
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };

      const dlg = UI.openModal({
        title: t("imp.confirmTitle"),
        body,
        footer: [cancelBtn, importBtn],
        onClose: () => done(null)
      });
      cancelBtn.addEventListener("click", () => dlg.close());
      importBtn.addEventListener("click", () => {
        done({ mode, name: nameInput ? nameInput.value.trim() : "" });
        dlg.close();
      });
    });
  }

  function openImport() {
    // Import calls FamilyStore.replaceAll (and delegates CSV to addPerson), both
    // of which no-op under the read-only guard. The menu entry is already
    // js-edit-only, so a viewer can't normally reach here — but guard defensively
    // so a stray call warns cleanly instead of showing a false "imported" toast.
    if (window.FamilyStore && FamilyStore.isReadOnly && FamilyStore.isReadOnly()) {
      UI.toast(I18n.t("people.readOnly"), "warning");
      return;
    }
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
      const choice = await confirmImportWithPreview(parsed, { currentCount, newCount, isShared, sharedWith });
      const mode = choice && choice.mode;

      if (mode) {
        try {
          if (mode === "new") {
            // Add as a NEW tree (cloud only): provision an empty tree named from
            // the name the user chose (defaulted from the file's meta, but
            // editable in the dialog) and switch to it. createTree arms the push
            // pipeline on the new row, so the replaceAll below persists the
            // imported data up as the new tree's first version — the current
            // tree is untouched.
            const meta = (parsed && parsed.meta) || {};
            const metaTitle = String(meta.familyTitle || meta.familyName || "").trim();
            const family = String(meta.familyName || "").trim()
              || (metaTitle ? metaTitle.split(/\s+/)[0] : "")
              || "Family";
            const title = String((choice && choice.name) || "").trim() || metaTitle;
            await window.CloudStore.createTree(title || family, family);
          }
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
          UI.toast(I18n.t(mode === "new" ? "imp.importedNew" : "imp.imported", { n: newCount }), "success");
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
