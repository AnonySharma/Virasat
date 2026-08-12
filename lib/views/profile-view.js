// @ts-check
/**
 * ProfileView — full-page profile for one person.
 * Opens via ProfileView.open(personId). Re-uses the .view container.
 *
 * Adds a fourth view to the app dynamically (no entry in main nav; reachable
 * by clicking a person from People / Tree / Timeline).
 */
(function (global) {
  "use strict";

  const VIEW_ID = "view-profile";
  let viewEl = null;
  let currentId = null;

  function ensureView() {
    if (viewEl) return viewEl;
    viewEl = document.createElement("section");
    viewEl.className = "view view--profile";
    viewEl.id = VIEW_ID;
    viewEl.setAttribute("aria-label", "Profile");
    /** @type {HTMLElement} */ (document.querySelector(".app-main")).appendChild(viewEl);
    return viewEl;
  }

  function open(id) {
    ensureView();
    currentId = id;
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("is-active"));
    viewEl.classList.add("is-active");
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("is-active"));
    render();
    // Animate in (respect reduced-motion preference)
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) {
      viewEl.classList.remove("is-entering");
      // Force reflow so the animation re-triggers on consecutive opens
      void viewEl.offsetWidth;
      viewEl.classList.add("is-entering");
      setTimeout(() => viewEl.classList.remove("is-entering"), 600);
    }
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  }

  function render() {
    if (!viewEl || !currentId) return;
    const p = FamilyStore.getPerson(currentId);
    if (!p) {
      UI.clear(viewEl);
      viewEl.appendChild(UI.emptyState({
        icon: "fa-solid fa-circle-question",
        title: "Person not found",
        cta: { label: I18n.t("actions.back"), onClick: backToPeople }
      }));
      return;
    }

    const parents = (p.parents || []).map(FamilyStore.getPerson).filter(Boolean);
    const spouses = (p.spouses || []).map(FamilyStore.getPerson).filter(Boolean);
    const children = FamilyStore.getChildrenOf(p.id);
    const siblings = FamilyStore.getSiblingsOf(p.id);

    const displayName = FamilyStore.getField(p, "name") || p.name;
    const displayOccupation = FamilyStore.getField(p, "occupation") || p.occupation;
    const displayDescription = FamilyStore.getField(p, "description") || p.description;
    const displayNotes = FamilyStore.getField(p, "notes") || p.notes;
    const displayAchievements = FamilyStore.getField(p, "achievements") || p.achievements;
    const displayEducation = FamilyStore.getField(p, "education") || p.education;

    UI.clear(viewEl);
    viewEl.appendChild(UI.el("div", { class: "profile" }, [
      // Top bar
      UI.el("div", { class: "profile__topbar" }, [
        UI.el("button", { class: "btn btn--ghost", type: "button", onclick: backToPeople }, [
          UI.el("i", { class: "fa-solid fa-arrow-left", "aria-hidden": "true" }),
          UI.el("span", null, I18n.t("actions.back"))
        ]),
        UI.el("div", { class: "profile__topbar-actions" }, [
          readAloudButton(p),
          UI.el("button", {
            class: "btn", type: "button",
            onclick: async () => {
              if (!window.ImageExport) return;
              try {
                const { blob, filename } = await ImageExport.exportFullProfile(p.id);
                await ImageExport.share(blob, filename, displayName);
                UI.toast(I18n.t("inspector.imageSaved"), "success");
              } catch (err) {
                UI.toast("Couldn't generate image: " + (err && err.message || "unknown"), "danger");
              }
            }
          }, [
            UI.el("i", { class: "fa-solid fa-share-from-square", "aria-hidden": "true" }),
            UI.el("span", null, I18n.t("inspector.actSaveImage"))
          ]),
          UI.el("button", {
            class: "btn btn--primary js-edit-only", type: "button",
            onclick: () => window.PeopleView && PeopleView.openForm && PeopleView.openForm(p.id)
          }, I18n.t("profile.edit"))
        ])
      ]),

      // Wide hero band — shows the hero crop of the photo when one exists.
      // Falls through silently when there's no photo or no custom hero crop.
      heroBand(p),

      // Hero
      UI.el("div", { class: "profile__hero" }, [
        UI.avatar(p, "lg"),
        UI.el("div", { class: "profile__hero-info" }, [
          UI.el("h1", { class: "profile__name" }, [
            displayName,
            // Alternate-script secondary name
            (I18n.getLang() === "hi" && p.name && p.name !== displayName)
              ? UI.el("span", { class: "profile__name-hi" }, p.name)
              : (I18n.getLang() !== "hi" && p.name_hi && p.name_hi !== displayName)
                ? UI.el("span", { class: "profile__name-hi", lang: "hi" }, p.name_hi)
                : null
          ]),
          displayOccupation ? UI.el("div", { class: "profile__occupation" }, displayOccupation) : null,
          UI.el("div", { class: "profile__lifeline" }, lifelineChips(p))
        ])
      ]),

      // About / description
      sectionCard(
        I18n.t("profile.about"),
        displayDescription
          ? UI.el("p", { class: "profile__prose" }, displayDescription)
          : muted(I18n.t("profile.emptyDescription"))
      ),

      // Achievements
      sectionCard(
        I18n.t("profile.achievements"),
        displayAchievements && displayAchievements.length
          ? UI.el("ul", { class: "profile__list" }, displayAchievements.map((a) => UI.el("li", {}, a)))
          : muted(I18n.t("profile.emptyAchievements"))
      ),

      // Education
      sectionCard(
        I18n.t("profile.education"),
        displayEducation && displayEducation.length
          ? UI.el("ul", { class: "profile__list profile__list--edu" }, displayEducation.map((a) => UI.el("li", {}, a)))
          : muted(I18n.t("profile.emptyEducation"))
      ),

      // Notes
      displayNotes ? sectionCard(I18n.t("form.notes"), UI.el("p", { class: "profile__prose" }, displayNotes)) : null,

      // Family
      sectionCard(I18n.t("profile.family"), familyBlock(parents, spouses, children, siblings))
    ]));
  }

  function heroBand(p) {
    if (!p || (!p.photoId && !p.photo)) return null;
    const band = UI.el("div", { class: "profile__photo-band" });
    const img = UI.el("img", { class: "profile__photo-band__img", alt: "" });
    const crop = p.photoCropHero;
    if (crop) {
      img.style.objectPosition = (crop.x ?? 50) + "% " + (crop.y ?? 50) + "%";
      const s = Math.max(1, crop.scale || 1);
      if (s > 1.001) img.style.transform = "scale(" + s + ")";
    }
    const sync = window.PhotoStore ? PhotoStore.getUrlSync(p) : (p.photo || null);
    if (sync) img.src = sync;
    else if (window.PhotoStore) {
      PhotoStore.getUrl(p).then((u) => { if (u) img.src = u; });
    }
    band.appendChild(img);
    return band;
  }

  function lifelineChips(p) {
    const out = [];
    const birthPlace = FamilyStore.getField(p, "birthPlace") || p.birthPlace;
    const deathPlace = FamilyStore.getField(p, "deathPlace") || p.deathPlace;
    if (p.birthDate) {
      out.push(UI.el("span", { class: "chip chip--alive" }, [
        UI.el("strong", {}, I18n.t("profile.born") + ": "),
        document.createTextNode(p.birthDate + (birthPlace ? ` · ${birthPlace}` : ""))
      ]));
    }
    if (p.deathDate) {
      out.push(UI.el("span", { class: "chip chip--deceased" }, [
        UI.el("strong", {}, I18n.t("profile.died") + ": "),
        document.createTextNode(p.deathDate + (deathPlace ? ` · ${deathPlace}` : ""))
      ]));
    }
    const age = FamilyStore.calcAge(p);
    if (age != null) {
      const key = p.deathDate ? "people.ageLived" : "people.ageLiving";
      out.push(UI.el("span", { class: "chip" }, I18n.t(key, { n: age })));
    }
    if (out.length === 0) out.push(UI.el("span", { class: "chip chip--muted" }, I18n.t("profile.none")));
    return out;
  }

  function familyBlock(parents, spouses, children, siblings) {
    const wrap = UI.el("div", { class: "profile__family" }, []);
    const groups = [
      [I18n.t("profile.parents"), parents],
      [I18n.t("profile.spouses"), spouses],
      [I18n.t("profile.children"), children],
      [I18n.t("profile.siblings"), siblings]
    ];
    let any = false;
    groups.forEach(([label, list]) => {
      if (!list || !list.length) return;
      any = true;
      wrap.appendChild(UI.el("div", { class: "profile__family-group" }, [
        UI.el("div", { class: "profile__family-label" }, label),
        UI.el("div", { class: "profile__family-row" }, list.map(personChip))
      ]));
    });
    if (!any) wrap.appendChild(muted(I18n.t("profile.none")));
    return wrap;
  }

  function personChip(person) {
    const displayName = FamilyStore.getField(person, "name") || person.name;
    return UI.el("button", {
      class: "person-chip", type: "button",
      onclick: () => open(person.id),
      title: I18n.t("actions.openProfile")
    }, [
      UI.avatar(person, "xs"),
      UI.el("span", { class: "person-chip__name" }, displayName)
    ]);
  }

  function sectionCard(title, body) {
    return UI.el("section", { class: "profile__section card" }, [
      UI.el("h2", { class: "profile__section-title" }, title),
      UI.el("div", { class: "profile__section-body" }, [body])
    ]);
  }

  // ===== Read-aloud narration =====
  // Reads the profile's text (name, lifespan, occupation, About, achievements,
  // education, notes, stories) via the browser's built-in SpeechSynthesis — no
  // network, no API key, works offline. Pure progressive enhancement: if the
  // engine is missing the button never appears. Available to viewers too —
  // listening isn't editing.
  const speech = (typeof window !== "undefined" && window.speechSynthesis) || null;
  let readBtn = null;
  let speaking = false;

  function supportsSpeech() {
    return !!(speech && typeof window.SpeechSynthesisUtterance === "function");
  }

  // Assemble the spoken script from whatever text the person actually has.
  // Uses the display-language field (getField) so Hindi mode narrates Hindi.
  function narrationText(p) {
    const parts = [];
    const name = FamilyStore.getField(p, "name") || p.name;
    if (name) parts.push(name + ".");
    const from = FamilyStore.getYear ? FamilyStore.getYear(p.birthDate) : null;
    const to = FamilyStore.getYear ? FamilyStore.getYear(p.deathDate) : null;
    if (from != null && to != null) parts.push(I18n.t("profile.lived", { from, to }) + ".");
    else if (from != null) parts.push(I18n.t("profile.livedFrom", { from }) + ".");
    const occ = FamilyStore.getField(p, "occupation") || p.occupation;
    if (occ) parts.push(occ + ".");
    const about = FamilyStore.getField(p, "description") || p.description;
    if (about) parts.push(about);
    const ach = FamilyStore.getField(p, "achievements") || p.achievements;
    if (Array.isArray(ach)) ach.forEach((a) => { if (a) parts.push(a + "."); });
    const edu = FamilyStore.getField(p, "education") || p.education;
    if (Array.isArray(edu)) edu.forEach((e) => { if (e) parts.push(e + "."); });
    const notes = FamilyStore.getField(p, "notes") || p.notes;
    if (notes) parts.push(notes);
    (p.stories || []).forEach((s) => {
      if (s && s.title) parts.push(s.title + ".");
      if (s && s.body) parts.push(s.body);
    });
    return parts.join("  ");
  }

  function stopReading() {
    if (speech) speech.cancel();
    speaking = false;
    syncReadBtn();
  }

  function syncReadBtn() {
    if (!readBtn) return;
    const icon = readBtn.querySelector("i");
    const label = readBtn.querySelector(".js-read-label");
    if (icon) icon.className = (speaking ? "fa-solid fa-stop" : "fa-solid fa-volume-high");
    const text = I18n.t(speaking ? "profile.stopReading" : "profile.readAloud");
    if (label) label.textContent = text;
    readBtn.setAttribute("aria-label", text);
    readBtn.setAttribute("aria-pressed", speaking ? "true" : "false");
  }

  function toggleReading(p) {
    if (!supportsSpeech() || !speech) { UI.toast(I18n.t("profile.readAloudUnavailable"), "info"); return; }
    if (speaking) { stopReading(); return; }
    const text = narrationText(p);
    if (!text.trim()) return;
    const u = new window.SpeechSynthesisUtterance(text);
    // Match the utterance language to the UI language so the OS picks a sensible
    // voice (Hindi vs English); the tag is a hint, not a guarantee of a voice.
    u.lang = I18n.getLang() === "hi" ? "hi-IN" : "en-US";
    u.onend = () => { speaking = false; syncReadBtn(); };
    u.onerror = () => { speaking = false; syncReadBtn(); };
    // Cancel anything already queued (e.g. a prior profile) before starting.
    speech.cancel();
    speech.speak(u);
    speaking = true;
    syncReadBtn();
  }

  function readAloudButton(p) {
    if (!supportsSpeech()) return null;
    // A fresh render means the DOM node with any prior speaking state is gone;
    // keep the engine and UI in sync by cancelling on (re)build.
    speaking = false;
    if (speech) speech.cancel();
    readBtn = UI.el("button", {
      class: "btn btn--ghost", type: "button",
      "aria-pressed": "false",
      "aria-label": I18n.t("profile.readAloud"),
      onclick: () => toggleReading(p)
    }, [
      UI.el("i", { class: "fa-solid fa-volume-high", "aria-hidden": "true" }),
      UI.el("span", { class: "js-read-label" }, I18n.t("profile.readAloud"))
    ]);
    return readBtn;
  }

  function muted(text) { return UI.el("p", { class: "profile__muted" }, text); }

  function backToPeople() {
    stopReading();
    if (viewEl) viewEl.classList.remove("is-active");
    const target = document.getElementById("view-people");
    if (target) target.classList.add("is-active");
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("is-active", /** @type {HTMLElement} */ (b).dataset.view === "people"));
    if (window.PeopleView && PeopleView.render) PeopleView.render();
    currentId = null;
  }

  // Re-render when store changes (if currently open)
  FamilyStore.subscribe(() => {
    if (viewEl && viewEl.classList.contains("is-active")) render();
  });
  // Re-render on language change
  if (window.I18n && I18n.onChange) {
    I18n.onChange(() => { if (viewEl && viewEl.classList.contains("is-active")) render(); });
  }

  global.ProfileView = { open, render };
})(window);
