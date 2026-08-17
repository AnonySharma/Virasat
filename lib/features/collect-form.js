// @ts-check
/**
 * CollectForm — UI for sharing a Google Form with relatives, and importing
 * the resulting CSV responses into the family tree.
 *
 * The Google Form template lives in `forms/family-tree-template.html`
 * (a plain HTML file you can open with the AppScript snippet to generate
 * a real Google Form, or simply use as a question reference).
 *
 * CSV columns (case-insensitive headers):
 *   Name,            Hindi name,         Father's name,       Mother's name,
 *   Spouse name,     Birth date,         Death date,
 *   Birth place,     Death place,        Gender,
 *   Occupation,      Description,        Achievements,        Education,
 *   Email (ignored), Timestamp (ignored)
 *
 * Headers may also be the Hindi question titles (collect.q.*, HI) so a form
 * generated in Hindi round-trips — the per-row lookups carry those aliases.
 *
 * Achievements / Education accept newline OR semicolon-separated entries.
 * Parents/spouses are looked up by exact-name match (case-insensitive).
 * If not found, they are NOT auto-created — the importer surfaces a list
 * of missing relations so the user can resolve them after.
 */
(function (global) {
  "use strict";

  const TEMPLATE_URL = "https://docs.google.com/forms/d/e/1FAIpQLSe-FAMILY-TREE-TEMPLATE/viewform"; // placeholder — user clones own
  // Accepted spellings for the (required) name column, most-specific last.
  // The Google Form template (forms/family-tree-template.html) titles this
  // question "Full name (English)", so that's the header a real CSV export
  // carries — NOT the bare "name" this gate used to demand, which rejected the
  // form's own output before any row was read. normalizeHeader lowercases and
  // collapses whitespace but does NOT strip punctuation, so "(english)"
  // survives verbatim and must be matched as-is. The Hindi entry is the
  // localized question title (collect.q.nameTitle, HI) so a form generated in
  // Hindi round-trips too. Shared by the presence gate and the per-row name
  // lookup so the two can't drift apart again.
  const NAME_HEADERS = ["name", "full name", "full name (english)", "पूरा नाम (अंग्रेज़ी में)", "पूरा नाम"];

  function open() {
    const body = UI.el("div", { class: "form-stack" }, [
      UI.el("p", { style: { margin: 0, color: "var(--ink-2)" } }, I18n.t("collect.intro")),

      // Step 1
      UI.el("section", { class: "card", style: { padding: "var(--s-4)" } }, [
        UI.el("h3", { class: "section-head__sub", style: { margin: "0 0 6px", color: "var(--ink)", fontSize: "15px", fontWeight: "600" } }, I18n.t("collect.step1Title")),
        UI.el("p", { style: { margin: "0 0 var(--s-3)", color: "var(--ink-3)", fontSize: "13px" } }, I18n.t("collect.step1Body")),
        UI.el("div", { style: { display: "flex", flexWrap: "wrap", gap: "var(--s-2)" } }, [
          UI.el("a", {
            class: "btn btn--primary", href: "forms/family-tree-template.html", target: "_blank", rel: "noopener"
          }, [UI.el("i", { class: "fa-solid fa-up-right-from-square", "aria-hidden": "true" }), I18n.t("collect.openTemplate")]),
          UI.el("button", {
            class: "btn", type: "button",
            onclick: () => copyJson()
          }, [UI.el("i", { class: "fa-solid fa-copy", "aria-hidden": "true" }), I18n.t("collect.copyJson")])
        ])
      ]),

      // Preview
      UI.el("details", { class: "card", style: { padding: "var(--s-3) var(--s-4)" } }, [
        UI.el("summary", { style: { cursor: "pointer", fontWeight: "500" } }, I18n.t("collect.previewTitle")),
        renderQuestionPreview()
      ]),

      // Step 2
      UI.el("section", { class: "card", style: { padding: "var(--s-4)" } }, [
        UI.el("h3", { class: "section-head__sub", style: { margin: "0 0 6px", color: "var(--ink)", fontSize: "15px", fontWeight: "600" } }, I18n.t("collect.step2Title")),
        UI.el("p", { style: { margin: "0 0 var(--s-3)", color: "var(--ink-3)", fontSize: "13px" } }, I18n.t("collect.step2Body")),
        UI.el("button", {
          class: "btn btn--primary btn--block", type: "button",
          onclick: pickCsv
        }, [UI.el("i", { class: "fa-solid fa-file-csv", "aria-hidden": "true" }), I18n.t("collect.importCsv")])
      ])
    ]);

    UI.openModal({
      title: I18n.t("collect.title"),
      body,
      footer: [UI.el("button", { class: "btn btn--ghost", type: "button", onclick: () => closeAny() }, [UI.el("i", { class: "fa-solid fa-xmark", "aria-hidden": "true" }), I18n.t("actions.close")])]
    });
  }

  function closeAny() {
    const root = document.getElementById("modal-root");
    if (root) {
      root.setAttribute("aria-hidden", "true");
      while (root.firstChild) root.removeChild(root.firstChild);
      document.body.style.overflow = "";
    }
  }

  function renderQuestionPreview() {
    const qs = formQuestions();
    return UI.el("ol", { style: { paddingLeft: "20px", color: "var(--ink-2)", fontSize: "13px", lineHeight: "1.6" } },
      qs.map((q) => UI.el("li", null, [
        UI.el("strong", null, q.title),
        q.help ? UI.el("span", { style: { color: "var(--ink-3)" } }, " — " + q.help) : null
      ]))
    );
  }

  // Titles/help are localized (collect.q.*). The current-language title also
  // becomes the header a real CSV export carries, so the importer's per-row
  // lookups below carry the matching Hindi aliases in lockstep — keep the two
  // in sync when either changes.
  function formQuestions() {
    const q = (k) => I18n.t("collect.q." + k);
    return [
      { title: q("nameTitle"), help: q("nameHelp"), required: true },
      { title: q("nameHiTitle"), help: q("nameHiHelp") },
      { title: q("fatherTitle"), help: q("fatherHelp") },
      { title: q("motherTitle") },
      { title: q("spouseTitle"), help: q("spouseHelp") },
      { title: q("birthDateTitle"), help: q("birthDateHelp") },
      { title: q("deathDateTitle"), help: q("deathDateHelp") },
      { title: q("birthPlaceTitle"), help: q("birthPlaceHelp") },
      { title: q("deathPlaceTitle") },
      { title: q("genderTitle"), help: q("genderHelp") },
      { title: q("occupationTitle") },
      { title: q("aboutTitle"), help: q("aboutHelp") },
      { title: q("achievementsTitle"), help: q("achievementsHelp") },
      { title: q("educationTitle"), help: q("educationHelp") }
    ];
  }

  function copyJson() {
    const json = JSON.stringify({ questions: formQuestions() }, null, 2);
    // UI.copyText handles the async Clipboard API + textarea fallback; this
    // owns the success/failure toast.
    UI.copyText(json).then((ok) => {
      UI.toast(I18n.t(ok ? "collect.copied" : "collect.copyFailed"), ok ? "success" : "danger");
    });
  }

  function pickCsv() {
    const input = /** @type {HTMLInputElement | null} */ (document.getElementById("import-file-input"));
    if (!input) return;
    const onChange = (e) => {
      input.removeEventListener("change", onChange);
      const file = e.target.files && e.target.files[0];
      input.value = "";
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => importCsvText(String(reader.result || ""));
      reader.onerror = () => UI.toast(I18n.t("collect.readFailed"), "danger");
      reader.readAsText(file);
    };
    input.addEventListener("change", onChange);
    input.click();
  }

  function importCsvText(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) { UI.toast(I18n.t("collect.csvInvalid"), "danger"); return; }
    const headers = rows[0].map((h) => normalizeHeader(h));
    if (!NAME_HEADERS.some((h) => headers.includes(h))) {
      UI.toast(I18n.t("collect.csvInvalid"), "danger");
      return;
    }
    const objects = rows.slice(1)
      .filter((r) => r.some((c) => c && c.trim()))
      .map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] || "").trim()])));

    // Build a name -> id index from the existing tree (case-insensitive).
    const byName = new Map();
    FamilyStore.getPeople().forEach((p) => byName.set(p.name.toLowerCase(), p.id));

    let added = 0;
    objects.forEach((row) => {
      // Resolve the name from whichever accepted header this CSV used — same
      // list the gate checks, so a header the gate accepts always resolves here.
      let name = "";
      for (const h of NAME_HEADERS) { if (row[h]) { name = row[h]; break; } }
      if (!name) return;
      if (byName.has(name.toLowerCase())) return; // skip duplicates
      // Each lookup carries its Hindi header alias last — the localized
      // question title (collect.q.*, HI) a Hindi-generated form would export.
      const fatherId = byName.get((row["father's name"] || row["father's full name"] || row["father"] || row["पिता का पूरा नाम"] || row["पिता का नाम"] || "").toLowerCase()) || null;
      const motherId = byName.get((row["mother's name"] || row["mother's full name"] || row["mother"] || row["माता का पूरा नाम"] || row["माता का नाम"] || "").toLowerCase()) || null;
      const spouseId = byName.get((row["spouse name"] || row["spouse's name"] || row["spouse's full name"] || row["spouse"] || row["जीवनसाथी का पूरा नाम"] || row["जीवनसाथी"] || "").toLowerCase()) || null;
      const parents = [fatherId, motherId].filter(Boolean);
      const spouses = spouseId ? [spouseId] : [];

      const splitList = (s) => (s || "").split(/[\n;]+/).map((x) => x.trim()).filter(Boolean);

      const newPerson = FamilyStore.addPerson({
        name,
        name_hi: row["name (hindi)"] || row["नाम (हिन्दी)"] || row["hindi name"] || "",
        birthDate: row["birth date"] || row["जन्म तिथि"] || null,
        deathDate: row["death date"] || row["मृत्यु तिथि"] || null,
        birthPlace: row["birth place"] || row["जन्म स्थान"] || "",
        deathPlace: row["death place"] || row["मृत्यु स्थान"] || "",
        gender: shortenGender(row["gender"] || row["लिंग"]),
        occupation: row["occupation"] || row["व्यवसाय"] || "",
        description: row["description"] || row["about"] || row["about / short description"] || row["परिचय / संक्षिप्त विवरण"] || "",
        achievements: splitList(row["achievements"] || row["life achievements"] || row["जीवन की उपलब्धियाँ"]),
        education: splitList(row["education"] || row["शिक्षा"]),
        parents,
        spouses
      });
      byName.set(newPerson.name.toLowerCase(), newPerson.id);
      added++;
    });

    closeAny();
    UI.toast(I18n.t("collect.importedCsv", { n: added }), "success");
  }

  function shortenGender(g) {
    if (!g) return null;
    const s = g.toLowerCase().trim();
    if (s.startsWith("m")) return "m";
    if (s.startsWith("f")) return "f";
    if (s.startsWith("o")) return "o";
    // Hindi gender words a Hindi-generated form would carry.
    if (s.startsWith("पुरुष") || s.startsWith("पुरूष")) return "m";
    if (s.startsWith("महिला") || s.startsWith("स्त्री")) return "f";
    if (s.startsWith("अन्य")) return "o";
    return null;
  }

  function normalizeHeader(h) {
    return String(h || "")
      .toLowerCase()
      .replace(/^\s*﻿/, "") // BOM
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Minimal RFC-4180 CSV parser: handles quoted fields, embedded commas,
   * escaped quotes ("") and CRLF/LF line endings. Returns rows of strings.
   */
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cur = "";
    let i = 0;
    let inQuotes = false;
    while (i < text.length) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        cur += ch; i++; continue;
      }
      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === ',') { row.push(cur); cur = ""; i++; continue; }
      if (ch === '\n' || ch === '\r') {
        row.push(cur); cur = "";
        rows.push(row); row = [];
        if (ch === '\r' && text[i + 1] === '\n') i++;
        i++; continue;
      }
      cur += ch; i++;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  global.CollectForm = { open, formQuestions, importCsvText };
})(window);
