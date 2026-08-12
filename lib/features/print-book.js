// @ts-check
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

  async function open() {
    if (!window.FamilyStore) return;
    const people = FamilyStore.getPeople();
    if (!people.length) {
      window.UI && UI.toast && UI.toast(I18n.t("print.emptyGuard"), "danger");
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

    // Preload every photo into PhotoStore's object-URL cache BEFORE building
    // pages. On a cold remote (cloud) tree the blobs live only in Storage, so
    // getUrl triggers a download + IDB repopulate; without awaiting them here,
    // window.print() (next rAF) would snapshot blank photos. Once resolved,
    // personPage's getUrlSync hits the warm cache and renders synchronously.
    // Errors per-photo are swallowed so one unreachable image can't abort the
    // whole book — that person just prints with initials.
    if (window.PhotoStore && PhotoStore.getUrl) {
      await Promise.all(ordered
        .filter((p) => p && p.photoId)
        .map((p) => PhotoStore.getUrl(p).catch(() => null)));
    }

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
    // Build via DOM API so user-typed `title` reaches the DOM as a TextNode,
    // not via innerHTML interpolation. The interpolation form was safe in
    // practice (title was assigned via textContent immediately after) but
    // we keep the codebase free of user-data-into-innerHTML patterns so a
    // future contributor doesn't follow the wrong template.
    const page = document.createElement("section");
    page.className = "print-page print-page--cover";
    const cover = document.createElement("div");
    cover.className = "print-cover";
    const eyebrow = document.createElement("div");
    eyebrow.className = "print-cover__eyebrow";
    eyebrow.textContent = I18n.t("print.eyebrow");
    const titleEl = document.createElement("h1");
    titleEl.className = "print-cover__title";
    titleEl.textContent = title;
    const rule = document.createElement("div");
    rule.className = "print-cover__rule";
    const dateEl = document.createElement("div");
    dateEl.className = "print-cover__date";
    dateEl.textContent = I18n.t("print.printed", { date: today });
    cover.appendChild(eyebrow);
    cover.appendChild(titleEl);
    cover.appendChild(rule);
    cover.appendChild(dateEl);
    page.appendChild(cover);
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
    } else if (window.PhotoStore && p.photoId) {
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
      span.textContent = lifespan + (birthPlace ? "  ·  " + I18n.t("print.bornIn", { place: birthPlace }) : "")
        + (deathPlace ? "  ·  " + I18n.t("print.diedIn", { place: deathPlace }) : "");
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
      section(I18n.t("print.secAbout"), p1);
    }
    if (achievements.length) {
      const ul = document.createElement("ul");
      ul.className = "print-list";
      achievements.forEach((a) => { const li = document.createElement("li"); li.textContent = a; ul.appendChild(li); });
      section(I18n.t("print.secAchievements"), ul);
    }
    if (education.length) {
      const ul = document.createElement("ul");
      ul.className = "print-list";
      education.forEach((a) => { const li = document.createElement("li"); li.textContent = a; ul.appendChild(li); });
      section(I18n.t("print.secEducation"), ul);
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
      section(I18n.t("print.secStories"), wrap);
    }
    if (notes) {
      const p2 = document.createElement("p");
      p2.className = "print-prose print-prose--muted";
      p2.textContent = notes;
      section(I18n.t("print.secNotes"), p2);
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
