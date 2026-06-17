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
 * Achievements / Education accept newline OR semicolon-separated entries.
 * Parents/spouses are looked up by exact-name match (case-insensitive).
 * If not found, they are NOT auto-created — the importer surfaces a list
 * of missing relations so the user can resolve them after.
 */
(function (global) {
  "use strict";

  const TEMPLATE_URL = "https://docs.google.com/forms/d/e/1FAIpQLSe-FAMILY-TREE-TEMPLATE/viewform"; // placeholder — user clones own
  const REQUIRED_HEADERS = ["name"];

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
          }, I18n.t("collect.openTemplate")),
          UI.el("button", {
            class: "btn", type: "button",
            onclick: () => copyJson()
          }, I18n.t("collect.copyJson"))
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
        }, [UI.el("span", { "aria-hidden": "true" }, "📄 "), I18n.t("collect.importCsv")])
      ])
    ]);

    UI.openModal({
      title: I18n.t("collect.title"),
      body,
      footer: [UI.el("button", { class: "btn btn--ghost", type: "button", onclick: () => closeAny() }, I18n.t("actions.close"))]
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

  function formQuestions() {
    return [
      { title: "Full name (English)", help: "e.g. Ramesh Sharma", required: true },
      { title: "नाम (हिन्दी)", help: "वैकल्पिक — उसी नाम का हिन्दी रूप" },
      { title: "Father's full name", help: "Exactly as recorded in the tree (helps us link)" },
      { title: "Mother's full name" },
      { title: "Spouse's full name", help: "Leave blank if not applicable" },
      { title: "Birth date", help: "YYYY-MM-DD or just the year" },
      { title: "Death date", help: "Leave blank if living" },
      { title: "Birth place", help: "City, country" },
      { title: "Death place" },
      { title: "Gender", help: "Male / Female / Other / blank" },
      { title: "Occupation" },
      { title: "About / short description", help: "A paragraph or two" },
      { title: "Life achievements", help: "One per line, or separated by ;" },
      { title: "Education", help: "One per line, or separated by ;" }
    ];
  }

  function copyJson() {
    const json = JSON.stringify({ questions: formQuestions() }, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json).then(
        () => UI.toast(I18n.t("collect.copied"), "success"),
        () => fallbackCopy(json)
      );
    } else {
      fallbackCopy(json);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); UI.toast(I18n.t("collect.copied"), "success"); }
    catch (e) { UI.toast("Copy failed", "danger"); }
    ta.remove();
  }

  function pickCsv() {
    const input = document.getElementById("import-file-input");
    if (!input) return;
    const onChange = (e) => {
      input.removeEventListener("change", onChange);
      const file = e.target.files && e.target.files[0];
      input.value = "";
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => importCsvText(String(reader.result || ""));
      reader.onerror = () => UI.toast("Read failed", "danger");
      reader.readAsText(file);
    };
    input.addEventListener("change", onChange);
    input.click();
  }

  function importCsvText(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) { UI.toast(I18n.t("collect.csvInvalid"), "danger"); return; }
    const headers = rows[0].map((h) => normalizeHeader(h));
    if (!REQUIRED_HEADERS.every((h) => headers.includes(h))) {
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
      const name = row["name"] || row["full name"] || row["full name (english)"];
      if (!name) return;
      if (byName.has(name.toLowerCase())) return; // skip duplicates
      const fatherId = byName.get((row["father's name"] || row["father's full name"] || row["father"] || "").toLowerCase()) || null;
      const motherId = byName.get((row["mother's name"] || row["mother's full name"] || row["mother"] || "").toLowerCase()) || null;
      const spouseId = byName.get((row["spouse name"] || row["spouse's name"] || row["spouse's full name"] || row["spouse"] || "").toLowerCase()) || null;
      const parents = [fatherId, motherId].filter(Boolean);
      const spouses = spouseId ? [spouseId] : [];

      const splitList = (s) => (s || "").split(/[\n;]+/).map((x) => x.trim()).filter(Boolean);

      const newPerson = FamilyStore.addPerson({
        name,
        name_hi: row["name (hindi)"] || row["नाम (हिन्दी)"] || row["hindi name"] || "",
        birthDate: row["birth date"] || null,
        deathDate: row["death date"] || null,
        birthPlace: row["birth place"] || "",
        deathPlace: row["death place"] || "",
        gender: shortenGender(row["gender"]),
        occupation: row["occupation"] || "",
        description: row["description"] || row["about"] || row["about / short description"] || "",
        achievements: splitList(row["achievements"] || row["life achievements"]),
        education: splitList(row["education"]),
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
