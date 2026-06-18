/**
 * PrintBook — generate a printable family book. Builds a hidden DOM tree
 * with one A4 page per person (cover + per-person pages), applies a
 * print-only stylesheet that puts each .print-page on its own physical
 * page, and calls window.print(). The user picks "Save as PDF" in the
 * native print dialog and ends up with a multi-page heirloom they can
 * spiral-bind at a print shop.
 *
 * Public:
 *   PrintBook.open()  — opens the system print dialog with the book
 *                       laid out for printing.
 */
(function (global) {
  "use strict";

  function open() {
    if (!window.FamilyStore) return;
    const people = FamilyStore.getPeople();
    if (!people.length) {
      window.UI && UI.toast && UI.toast("Add at least one relative before printing.", "danger");
      return;
    }
    // Sort: living first, then by birth year ascending (so the book reads
    // generationally even if the underlying data isn't sorted).
    const ordered = people.slice().sort((a, b) => {
      const ay = FamilyStore.getYear(a.birthDate);
      const by = FamilyStore.getYear(b.birthDate);
      if (ay == null && by != null) return 1;
      if (by == null && ay != null) return -1;
      if (ay != null && by != null && ay !== by) return ay - by;
      return (a.name || "").localeCompare(b.name || "");
    });

    const root = document.createElement("div");
    root.className = "print-book-root";
    root.setAttribute("aria-hidden", "true");

    // Cover page
    root.appendChild(coverPage());
    // One page per person
    ordered.forEach((p) => root.appendChild(personPage(p)));

    document.body.appendChild(root);
    document.body.classList.add("is-printing");
    // The browser's print dialog blocks the JS thread; reflows happen
    // synchronously before it opens. Defer to next frame so any pending
    // photo URLs / fonts are paint-ready.
    requestAnimationFrame(() => {
      try { window.print(); }
      finally {
        // Wait one tick so the print stylesheet snapshot is taken before
        // we tear the DOM down. afterprint handles the close path; this
        // is belt-and-braces for browsers that don't fire afterprint.
        setTimeout(cleanup, 250);
      }
    });

    function cleanup() {
      document.body.classList.remove("is-printing");
      if (root.parentNode) root.parentNode.removeChild(root);
    }
    window.addEventListener("afterprint", cleanup, { once: true });
  }

  function coverPage() {
    const meta = (FamilyStore.getState && FamilyStore.getState().meta) || {};
    const title = (FamilyStore.getFamilyTitle && FamilyStore.getFamilyTitle())
      || meta.familyName || "Family";
    const today = new Date().toLocaleDateString(undefined, {
      year: "numeric", month: "long", day: "numeric"
    });
    const page = document.createElement("section");
    page.className = "print-page print-page--cover";
    page.innerHTML =
      '<div class="print-cover">' +
      '  <div class="print-cover__eyebrow">A family book</div>' +
      '  <h1 class="print-cover__title"></h1>' +
      '  <div class="print-cover__rule"></div>' +
      '  <div class="print-cover__date"></div>' +
      '</div>';
    page.querySelector(".print-cover__title").textContent = title;
    page.querySelector(".print-cover__date").textContent = "Printed " + today;
    return page;
  }

  function personPage(p) {
    const page = document.createElement("section");
    page.className = "print-page print-page--person";

    const F = (k) => FamilyStore.getField(p, k);
    const name = F("name") || p.name;
    const occupation = F("occupation") || p.occupation || "";
    const birthPlace = F("birthPlace") || p.birthPlace || "";
    const deathPlace = F("deathPlace") || p.deathPlace || "";
    const description = F("description") || p.description || "";
    const notes = F("notes") || p.notes || "";
    const achievements = F("achievements") || [];
    const education = F("education") || [];
    const stories = (p.stories || []).slice();

    // Header
    const header = document.createElement("header");
    header.className = "print-person__head";
    const photo = document.createElement("div");
    photo.className = "print-person__photo";
    const photoUrl = window.PhotoStore ? PhotoStore.getUrlSync(p) : (p.photo || null);
    if (photoUrl) {
      const img = document.createElement("img");
      img.src = photoUrl;
      img.alt = "";
      photo.appendChild(img);
    } else if (window.PhotoStore && (p.photoId || p.photoUrl)) {
      const img = document.createElement("img");
      img.alt = "";
      photo.appendChild(img);
      PhotoStore.getUrl(p).then((u) => { if (u) img.src = u; });
    } else {
      photo.classList.add("print-person__photo--initials");
      photo.textContent = (FamilyStore.initials && FamilyStore.initials(name)) || "?";
    }
    const titleBlock = document.createElement("div");
    titleBlock.className = "print-person__title";
    const h2 = document.createElement("h2");
    h2.textContent = name;
    titleBlock.appendChild(h2);
    if (occupation) {
      const occ = document.createElement("div");
      occ.className = "print-person__occupation";
      occ.textContent = occupation;
      titleBlock.appendChild(occ);
    }
    const lifespan = FamilyStore.formatDateRange(p);
    if (lifespan) {
      const span = document.createElement("div");
      span.className = "print-person__lifespan";
      span.textContent = lifespan + (birthPlace ? "  ·  Born in " + birthPlace : "")
        + (deathPlace ? "  ·  Died in " + deathPlace : "");
      titleBlock.appendChild(span);
    }
    header.appendChild(photo);
    header.appendChild(titleBlock);
    page.appendChild(header);

    // Body — about, achievements, education, stories, notes
    function section(title, content) {
      if (!content) return;
      const sec = document.createElement("section");
      sec.className = "print-section";
      const h = document.createElement("h3"); h.textContent = title;
      sec.appendChild(h);
      sec.appendChild(content);
      page.appendChild(sec);
    }
    if (description) {
      const p1 = document.createElement("p");
      p1.className = "print-prose";
      p1.textContent = description;
      section("About", p1);
    }
    if (achievements.length) {
      const ul = document.createElement("ul");
      ul.className = "print-list";
      achievements.forEach((a) => { const li = document.createElement("li"); li.textContent = a; ul.appendChild(li); });
      section("Life achievements", ul);
    }
    if (education.length) {
      const ul = document.createElement("ul");
      ul.className = "print-list";
      education.forEach((a) => { const li = document.createElement("li"); li.textContent = a; ul.appendChild(li); });
      section("Education", ul);
    }
    if (stories.length) {
      const wrap = document.createElement("div");
      wrap.className = "print-stories";
      stories.forEach((s) => {
        const item = document.createElement("article");
        item.className = "print-story";
        if (s.title) {
          const t = document.createElement("h4"); t.textContent = s.title;
          item.appendChild(t);
        }
        if (s.body) {
          const b = document.createElement("p"); b.textContent = s.body;
          item.appendChild(b);
        }
        wrap.appendChild(item);
      });
      section("Stories", wrap);
    }
    if (notes) {
      const p2 = document.createElement("p");
      p2.className = "print-prose print-prose--muted";
      p2.textContent = notes;
      section("Notes", p2);
    }

    // Footer — page number + family title
    const footer = document.createElement("footer");
    footer.className = "print-person__foot";
    const familyTitle = (FamilyStore.getFamilyTitle && FamilyStore.getFamilyTitle()) || "";
    footer.textContent = familyTitle;
    page.appendChild(footer);

    return page;
  }

  global.PrintBook = { open };
})(window);
