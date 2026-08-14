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

  // The mounted book DOM (one .print-page per person). Non-null only while a
  // print is in flight — shared so the native Ctrl+P path (beforeprint) and the
  // in-app button (open) build at most one copy, and both teardown paths remove
  // the same node.
  let bookRoot = null;

  // Build the book synchronously and reveal it for print. Idempotent: if a book
  // is already mounted (open built it, or a prior beforeprint fired) this is a
  // no-op, so the two entry paths never stack two copies. Photos render from
  // PhotoStore's warm sync cache; open() preloads cold/remote blobs first
  // (beforeprint can't await), so a raw Ctrl+P on a cold remote tree may fall
  // back to initials for any face not yet cached.
  function buildBook() {
    if (bookRoot) return;
    if (!window.FamilyStore) return;
    const people = FamilyStore.getPeople();
    if (!people.length) return;   // nothing to print — leave the page untouched
    // Sort: undated last, then by birth year ascending (so the book reads
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
    root.appendChild(coverPage());
    ordered.forEach((p) => root.appendChild(personPage(p)));

    document.body.appendChild(root);
    document.body.classList.add("is-printing");
    bookRoot = root;
  }

  function cleanup() {
    document.body.classList.remove("is-printing");
    if (bookRoot && bookRoot.parentNode) bookRoot.parentNode.removeChild(bookRoot);
    bookRoot = null;
  }

  // The in-app "Print family book" action. Unlike a raw Ctrl+P this can await,
  // so it preloads every photo into PhotoStore's object-URL cache BEFORE
  // building pages: on a cold remote (cloud) tree the blobs live only in
  // Storage, so getUrl triggers a download + IDB repopulate; without awaiting,
  // window.print() would snapshot blank photos. Errors per-photo are swallowed
  // so one unreachable image can't abort the whole book.
  async function open() {
    if (!window.FamilyStore) return;
    const people = FamilyStore.getPeople();
    if (!people.length) {
      window.UI && UI.toast && UI.toast(I18n.t("print.emptyGuard"), "danger");
      return;
    }
    if (window.PhotoStore && PhotoStore.getUrl) {
      await Promise.all(people
        .filter((p) => p && p.photoId)
        .map((p) => PhotoStore.getUrl(p).catch(() => null)));
    }
    buildBook();
    // The browser's print dialog blocks the JS thread; reflows happen
    // synchronously before it opens. Defer to next frame so any pending photo
    // URLs / fonts are paint-ready.
    requestAnimationFrame(() => {
      try { window.print(); }
      finally {
        // Belt-and-braces for browsers that don't fire afterprint; the
        // afterprint listener below handles the normal close.
        setTimeout(cleanup, 250);
      }
    });
  }

  // Native print routes (Ctrl+P / Cmd+P / File → Print) never call open(), so
  // without this the print stylesheet would hide the whole app and print a
  // blank page. Build the book on beforeprint (idempotent with open) and tear
  // it down on afterprint, so every route yields the same formatted book.
  global.addEventListener("beforeprint", buildBook);
  global.addEventListener("afterprint", cleanup);

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
