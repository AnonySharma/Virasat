/**
 * People view — list, search, add, edit, and delete family members.
 *
 * Exposes window.PeopleView = { mount(rootEl), render() }.
 * mount() builds the static scaffold (header, search, grid host) once.
 * render() refreshes the grid based on current FamilyStore state and the search filter.
 */
(function (global) {
  "use strict";

  const { el, clear, avatar, toast, openModal, confirm, field } = UI;

  let root = null;
  let gridHost = null;
  let subtitleEl = null;
  let searchInput = null;
  let searchTerm = "";
  let filterMode = "all";   // "all" | "alive" | "deceased"

  function mount(rootEl) {
    root = rootEl;
    clear(root);

    searchInput = el("input", {
      type: "search",
      placeholder: I18n.t("people.searchPlaceholder"),
      "data-i18n-placeholder": "people.searchPlaceholder",
      "aria-label": "Search people by name",
      oninput: (e) => { searchTerm = e.target.value || ""; render(); }
    });
    const search = el("div", { class: "searchbar" }, [
      el("i", { class: "fa-solid fa-magnifying-glass searchbar__icon", "aria-hidden": "true" }),
      searchInput
    ]);

    const addBtn = el("button", {
      class: "btn btn--primary",
      type: "button",
      onclick: () => openForm(null)
    }, [
      el("i", { class: "fa-solid fa-user-plus", "aria-hidden": "true" }),
      el("span", { "data-i18n": "actions.add" }, I18n.t("actions.add"))
    ]);

    const head = el("div", { class: "view-head" }, [
      el("div", { class: "view-head__title-wrap" }, [
        el("h2", { class: "view-head__title", "data-i18n": "people.title" }, I18n.t("people.title")),
        (subtitleEl = el("span", { class: "view-head__sub" }, ""))
      ]),
      el("div", { class: "view-head__actions" }, [search, addBtn])
    ]);

    gridHost = el("div", { class: "people-grid" });

    root.appendChild(head);
    root.appendChild(gridHost);

    render();
  }

  function setSearch(s) { searchTerm = s || ""; if (searchInput) searchInput.value = searchTerm; render(); }
  function setFilter(f) { filterMode = f || "all"; render(); }

  function render() {
    if (!root || !gridHost) return;
    const all = FamilyStore.getPeople();
    subtitleEl.textContent = all.length === 1 ? I18n.t("people.countOne") : I18n.t("people.countMany", { n: all.length });

    clear(gridHost);

    if (all.length === 0) {
      gridHost.style.display = "block";
      gridHost.appendChild(emptyStateInitial());
      return;
    }

    // Search hides non-matches; the alive/deceased filter only DIMS them so
    // the user keeps a sense of the whole tree.
    const searched = filterPeople(all, searchTerm);
    if (searched.length === 0) {
      gridHost.style.display = "block";
      gridHost.appendChild(emptyStateNoMatches());
      return;
    }

    gridHost.style.display = "";
    const sorted = sortPeople(searched);
    sorted.forEach((p) => {
      const card = personCard(p);
      const matches = filterMode === "all"
        || (filterMode === "alive" && FamilyStore.isAlive(p))
        || (filterMode === "deceased" && FamilyStore.isDeceased(p));
      if (!matches) card.classList.add("is-dim");
      gridHost.appendChild(card);
    });
  }

  function filterPeople(people, term) {
    const q = term.trim().toLowerCase();
    if (!q) return people;
    // Pre-compute the set of people whose stories match the term so we don't
    // walk every story for every person on every keystroke.
    const storyHits = new Set();
    if (FamilyStore.searchStories) {
      try {
        FamilyStore.searchStories(q).forEach((m) => {
          if (m && m.person) storyHits.add(m.person.id);
        });
      } catch (_) { /* defensive — fall back to name-only matching */ }
    }
    return people.filter((p) => {
      if (p.name && p.name.toLowerCase().includes(q)) return true;
      if (p.name_hi && p.name_hi.toLowerCase().includes(q)) return true;
      if (storyHits.has(p.id)) return true;
      if (p.notes && p.notes.toLowerCase().includes(q)) return true;
      if (p.notes_hi && p.notes_hi.toLowerCase().includes(q)) return true;
      return false;
    });
  }

  function sortPeople(people) {
    return people.slice().sort((a, b) => {
      // Living first
      const aliveA = FamilyStore.isAlive(a);
      const aliveB = FamilyStore.isAlive(b);
      if (aliveA !== aliveB) return aliveA ? -1 : 1;
      // Birth year ascending, nulls last
      const yA = FamilyStore.getYear(a.birthDate);
      const yB = FamilyStore.getYear(b.birthDate);
      if (yA == null && yB != null) return 1;
      if (yB == null && yA != null) return -1;
      if (yA != null && yB != null && yA !== yB) return yA - yB;
      // Name
      return a.name.localeCompare(b.name);
    });
  }

  function personCard(person) {
    const displayName = FamilyStore.getField(person, "name") || person.name;
    const displayPlace = FamilyStore.getField(person, "birthPlace") || person.birthPlace;
    const ageChip = buildAgeChip(person);
    const placeChip = displayPlace
      ? el("span", { class: "chip chip--muted" }, [el("span", { "aria-hidden": "true" }, "📍"), displayPlace])
      : null;

    const editBtn = el("button", {
      class: "btn btn--icon btn--sm btn--ghost",
      type: "button",
      "aria-label": "Edit " + person.name,
      title: "Edit",
      onclick: (e) => { e.stopPropagation(); openForm(person.id); }
    }, "✎");

    const delBtn = el("button", {
      class: "btn btn--icon btn--sm btn--ghost",
      type: "button",
      "aria-label": "Delete " + person.name,
      title: "Delete",
      onclick: (e) => { e.stopPropagation(); deletePerson(person.id); }
    }, "🗑");

    const card = el("div", {
      class: "card person-card",
      tabindex: "0",
      role: "button",
      "aria-label": I18n.t("actions.openProfile") + ": " + person.name,
      onclick: () => openProfile(person.id),
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openProfile(person.id); } }
    }, [
      el("div", { class: "person-card__top" }, [
        avatar(person, "lg"),
        el("div", null, [
          el("div", { class: "person-card__name" }, [
            displayName,
            // Show the alternate-script name as a small subtitle if both exist
            (I18n.getLang() === "hi" && person.name && person.name !== displayName)
              ? el("span", { class: "person-card__name-hi" }, person.name)
              : (I18n.getLang() !== "hi" && person.name_hi && person.name_hi !== displayName)
                ? el("span", { class: "person-card__name-hi", lang: "hi" }, person.name_hi)
                : null
          ]),
          el("div", { class: "person-card__dates" }, FamilyStore.formatDateRange(person))
        ])
      ]),
      el("div", { class: "person-card__meta" }, [ageChip, placeChip].filter(Boolean)),
      el("div", { class: "person-card__actions" }, [editBtn, delBtn])
    ]);

    return card;
  }

  function buildAgeChip(person) {
    const age = FamilyStore.calcAge(person);
    const alive = FamilyStore.isAlive(person);
    let label;
    if (age == null) {
      label = I18n.t(alive ? "people.living" : "people.deceased");
    } else if (alive) {
      label = I18n.t("people.ageLiving", { n: age });
    } else {
      label = I18n.t("people.ageLived", { n: age });
    }
    const cls = "chip person-card__age-chip " + (alive ? "chip--leaf" : "chip--accent");
    return el("span", { class: cls }, label);
  }

  function openProfile(id) {
    if (window.Inspector && Inspector.show) Inspector.show(id);
    else if (window.ProfileView && ProfileView.open) ProfileView.open(id);
    else openForm(id);
  }

  function emptyStateInitial() {
    return el("div", { class: "empty" }, [
      el("div", { class: "empty__icon", "aria-hidden": "true" }, "🌱"),
      el("div", { class: "empty__title" }, "Plant your family tree"),
      el("div", { class: "empty__text" }, "Start by adding the first family member."),
      el("button", {
        class: "btn btn--primary",
        type: "button",
        onclick: () => openForm(null)
      }, [el("span", { "aria-hidden": "true" }, "＋"), "Add first person"])
    ]);
  }

  function emptyStateNoMatches() {
    return el("div", { class: "empty" }, [
      el("div", { class: "empty__icon", "aria-hidden": "true" }, "🔎"),
      el("div", { class: "empty__title" }, "No matches"),
      el("div", { class: "empty__text" }, "Try a different name or clear the search.")
    ]);
  }

  // ===== Add/Edit form =====

  function openForm(id, seed) {
    const isEdit = !!id;
    const existing = isEdit ? FamilyStore.getPerson(id) : null;
    if (isEdit && !existing) {
      toast("Person not found", "danger");
      return;
    }
    seed = seed || {};

    // Working copy of the person (only fields used by the form).
    const draft = {
      id: existing ? existing.id : null,
      name: existing ? existing.name : "",
      name_hi: existing ? existing.name_hi || "" : "",
      photoId: existing ? existing.photoId || null : null,
      photo: existing ? existing.photo : null, // base64 (legacy / freshly imported)
      birthDate: existing ? existing.birthDate || "" : "",
      birthDatePrecision: (existing && existing.birthDatePrecision) || "exact",
      deathDate: existing ? existing.deathDate || "" : "",
      deathDatePrecision: (existing && existing.deathDatePrecision) || "exact",
      birthPlace: existing ? existing.birthPlace || "" : "",
      birthPlace_hi: existing ? existing.birthPlace_hi || "" : "",
      deathPlace: existing ? existing.deathPlace || "" : "",
      deathPlace_hi: existing ? existing.deathPlace_hi || "" : "",
      gender: existing ? existing.gender || "" : "",
      notes: existing ? existing.notes || "" : "",
      notes_hi: existing ? existing.notes_hi || "" : "",
      occupation: existing ? existing.occupation || "" : "",
      occupation_hi: existing ? existing.occupation_hi || "" : "",
      description: existing ? existing.description || "" : "",
      description_hi: existing ? existing.description_hi || "" : "",
      achievements: existing && existing.achievements ? existing.achievements.slice() : [],
      achievements_hi: existing && existing.achievements_hi ? existing.achievements_hi.slice() : [],
      education: existing && existing.education ? existing.education.slice() : [],
      education_hi: existing && existing.education_hi ? existing.education_hi.slice() : [],
      parents: existing ? existing.parents.slice() : (seed.parents ? seed.parents.slice() : []),
      spouses: existing ? existing.spouses.slice() : (seed.spouses ? seed.spouses.slice() : []),
      __addAsParentOf: seed.__addAsParentOf || null
    };

    // ----- Photo uploader -----
    const fileInput = el("input", {
      type: "file",
      accept: "image/*",
      hidden: true,
      onchange: async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = "";
        if (!file) return;
        try {
          if (window.PhotoStore) {
            const id = await PhotoStore.fileToPhotoId(file);
            draft.photoId = id;
            draft.photo = null;
          } else {
            const dataUrl = await FamilyStore.fileToDataURL(file);
            draft.photo = dataUrl;
          }
          refreshPhoto();
        } catch (err) {
          toast(err.message, "danger");
        }
      }
    });

    const photoSlot = el("div", null);
    const removeBtn = el("button", {
      class: "btn btn--ghost btn--sm",
      type: "button",
      onclick: () => {
        if (draft.photoId && window.PhotoStore) PhotoStore.delete(draft.photoId);
        draft.photoId = null; draft.photo = null;
        refreshPhoto();
      }
    }, I18n.t("actions.remove"));
    const buttonsCol = el("div", { class: "photo-uploader__buttons" }, [
      el("button", {
        class: "btn btn--sm",
        type: "button",
        onclick: () => fileInput.click()
      }, I18n.t("actions.upload")),
      removeBtn
    ]);
    const photoUploader = el("div", { class: "photo-uploader" }, [photoSlot, buttonsCol, fileInput]);

    function refreshPhoto() {
      clear(photoSlot);
      photoSlot.appendChild(avatar({
        name: draft.name || "?",
        photo: draft.photo, photoId: draft.photoId
      }, "lg"));
      const has = !!(draft.photoId || draft.photo);
      removeBtn.style.display = has ? "" : "none";
    }
    refreshPhoto();

    // ----- Text fields -----
    const nameInput = el("input", {
      class: "input",
      type: "text",
      value: draft.name,
      required: true,
      placeholder: "Full name",
      oninput: (e) => {
        draft.name = e.target.value;
        if (!(draft.photoId || draft.photo)) refreshPhoto();
      }
    });
    const nameHiInput = el("input", {
      class: "input", type: "text", value: draft.name_hi,
      placeholder: "पूरा नाम", lang: "hi",
      oninput: (e) => { draft.name_hi = e.target.value; }
    });

    // Heritage date pickers — fall back to plain text inputs if the
    // module hasn't loaded for any reason.
    const birthDatePicker = window.HeritagePicker
      ? window.HeritagePicker.create({
          value: draft.birthDate, placeholder: "YYYY-MM-DD",
          allowYearOnly: true,
          onChange: (iso) => { draft.birthDate = iso; }
        })
      : null;
    const birthDateInput = birthDatePicker
      ? birthDatePicker.el
      : el("input", {
          class: "input", type: "text", value: draft.birthDate,
          placeholder: "YYYY-MM-DD or YYYY",
          oninput: (e) => { draft.birthDate = e.target.value; }
        });

    const deathDatePicker = window.HeritagePicker
      ? window.HeritagePicker.create({
          value: draft.deathDate, placeholder: "Leave blank if living",
          allowYearOnly: true,
          onChange: (iso) => { draft.deathDate = iso; }
        })
      : null;
    const deathDateInput = deathDatePicker
      ? deathDatePicker.el
      : el("input", {
          class: "input", type: "text", value: draft.deathDate,
          placeholder: "YYYY-MM-DD or YYYY",
          oninput: (e) => { draft.deathDate = e.target.value; }
        });

    // Precision pickers — Exact / About / Before / After. Sit beside each
    // date input. When the date is empty, we still keep "exact" but the
    // picker is harmless since the date isn't shown anywhere.
    const PRECISION_OPTS = [
      { value: "exact",  label: "Exact" },
      { value: "about",  label: "About (c.)" },
      { value: "before", label: "Before" },
      { value: "after",  label: "After" }
    ];
    const birthPrecPicker = window.HeritageSelect ? HeritageSelect.create({
      options: PRECISION_OPTS, value: draft.birthDatePrecision || "exact",
      onChange: (v) => { draft.birthDatePrecision = v; }
    }) : null;
    const deathPrecPicker = window.HeritageSelect ? HeritageSelect.create({
      options: PRECISION_OPTS, value: draft.deathDatePrecision || "exact",
      onChange: (v) => { draft.deathDatePrecision = v; }
    }) : null;
    function dateWithPrecisionField(label, dateEl, precPicker, hint) {
      const wrap = el("div", { class: "field" }, [
        el("span", { class: "field__label" }, label),
        el("div", { style: { display: "grid", gridTemplateColumns: "1fr 130px", gap: "8px" } }, [
          dateEl,
          precPicker ? precPicker.el : null
        ]),
        hint ? el("span", { class: "field__hint" }, hint) : null
      ]);
      return wrap;
    }

    const birthPlaceInput = el("input", {
      class: "input", type: "text", value: draft.birthPlace,
      placeholder: "City, Country",
      oninput: (e) => { draft.birthPlace = e.target.value; }
    });
    const birthPlaceHiInput = el("input", {
      class: "input", type: "text", value: draft.birthPlace_hi,
      placeholder: "नगर, देश", lang: "hi",
      oninput: (e) => { draft.birthPlace_hi = e.target.value; }
    });

    const deathPlaceInput = el("input", {
      class: "input", type: "text", value: draft.deathPlace,
      placeholder: "City, Country",
      oninput: (e) => { draft.deathPlace = e.target.value; }
    });
    const deathPlaceHiInput = el("input", {
      class: "input", type: "text", value: draft.deathPlace_hi,
      placeholder: "नगर, देश", lang: "hi",
      oninput: (e) => { draft.deathPlace_hi = e.target.value; }
    });

    const genderPicker = window.HeritageSelect
      ? HeritageSelect.create({
          options: [
            { value: "", label: I18n.t("form.genderNone") },
            { value: "m", label: I18n.t("form.genderM") },
            { value: "f", label: I18n.t("form.genderF") },
            { value: "o", label: I18n.t("form.genderO") }
          ],
          value: draft.gender || "",
          placeholder: I18n.t("form.genderNone"),
          onChange: (v) => { draft.gender = v; }
        })
      : null;
    const genderSelect = genderPicker
      ? genderPicker.el
      : el("select", { class: "select", onchange: (e) => { draft.gender = e.target.value; } }, [
          el("option", { value: "" }, I18n.t("form.genderNone")),
          el("option", { value: "m" }, I18n.t("form.genderM")),
          el("option", { value: "f" }, I18n.t("form.genderF")),
          el("option", { value: "o" }, I18n.t("form.genderO"))
        ]);
    if (!genderPicker) genderSelect.value = draft.gender || "";

    const notesInput = el("textarea", {
      class: "textarea",
      placeholder: "Stories, milestones, anything to remember…",
      oninput: (e) => { draft.notes = e.target.value; }
    }, draft.notes);
    const notesHiInput = el("textarea", {
      class: "textarea", placeholder: "कहानियाँ, यादें…", lang: "hi",
      oninput: (e) => { draft.notes_hi = e.target.value; }
    }, draft.notes_hi);

    const occupationInput = el("input", {
      class: "input", type: "text", value: draft.occupation,
      placeholder: "Engineer, Teacher, …",
      oninput: (e) => { draft.occupation = e.target.value; }
    });
    const occupationHiInput = el("input", {
      class: "input", type: "text", value: draft.occupation_hi,
      placeholder: "अभियंता, शिक्षक…", lang: "hi",
      oninput: (e) => { draft.occupation_hi = e.target.value; }
    });

    const descriptionInput = el("textarea", {
      class: "textarea",
      placeholder: "A short biography or memory…",
      oninput: (e) => { draft.description = e.target.value; }
    }, draft.description);
    const descriptionHiInput = el("textarea", {
      class: "textarea", placeholder: "संक्षिप्त परिचय…", lang: "hi",
      oninput: (e) => { draft.description_hi = e.target.value; }
    }, draft.description_hi);

    const achievementsInput = el("textarea", {
      class: "textarea",
      placeholder: "First in family to graduate\nWon district cricket trophy 1982\n…",
      oninput: (e) => { draft.achievements = e.target.value.split(/\n+/).map((s) => s.trim()).filter(Boolean); }
    }, (draft.achievements || []).join("\n"));
    const achievementsHiInput = el("textarea", {
      class: "textarea", placeholder: "उपलब्धियाँ (प्रत्येक पंक्ति में एक)", lang: "hi",
      oninput: (e) => { draft.achievements_hi = e.target.value.split(/\n+/).map((s) => s.trim()).filter(Boolean); }
    }, (draft.achievements_hi || []).join("\n"));

    const educationInput = el("textarea", {
      class: "textarea",
      placeholder: "BA, Delhi University, 1968\nPhD, IIT Bombay, 1976\n…",
      oninput: (e) => { draft.education = e.target.value.split(/\n+/).map((s) => s.trim()).filter(Boolean); }
    }, (draft.education || []).join("\n"));
    const educationHiInput = el("textarea", {
      class: "textarea", placeholder: "शिक्षा (प्रत्येक पंक्ति में एक)", lang: "hi",
      oninput: (e) => { draft.education_hi = e.target.value.split(/\n+/).map((s) => s.trim()).filter(Boolean); }
    }, (draft.education_hi || []).join("\n"));

    // ----- Relations (father / mother / spouses) -----
    // No native pickers; everything goes through HeritageSelect.
    const others = FamilyStore.getPeople()
      .filter((p) => p.id !== draft.id)
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", "en"));

    function personLabel(p) {
      const dn = FamilyStore.getField(p, "name") || p.name;
      const yr = FamilyStore.getYear(p.birthDate);
      return yr ? `${dn} · ${yr}` : dn;
    }

    function relationOptions(filterFn, noneLabel) {
      const opts = [{ value: "", label: noneLabel || "—" }];
      others.filter(filterFn || (() => true)).forEach((p) => {
        opts.push({ value: p.id, label: personLabel(p) });
      });
      return opts;
    }

    // Gender-aware filters. We accept "no gender on file" everywhere so
    // people whose gender we haven't recorded aren't excluded.
    const isMale   = (p) => p.gender === "m" || !p.gender;
    const isFemale = (p) => p.gender === "f" || !p.gender;
    function spouseGenderFilter() {
      // Whoever is being edited has draft.gender. Spouses are typically the
      // opposite — but again only narrow when we *have* a gender on file.
      if (draft.gender === "m") return (p) => p.gender === "f" || !p.gender;
      if (draft.gender === "f") return (p) => p.gender === "m" || !p.gender;
      // "Other" / unspecified → don't narrow.
      return () => true;
    }

    // Heuristic: among the existing parents on the draft, the "father" slot
    // is filled by a male parent (or the first listed) and "mother" by a
    // female (or the second listed). This is just for editing the form;
    // the underlying schema still stores `parents: [id, id]`.
    let fatherId = "", motherId = "";
    if (draft.parents && draft.parents.length) {
      const ps = draft.parents.map(FamilyStore.getPerson).filter(Boolean);
      const m = ps.find((p) => p.gender === "m");
      const f = ps.find((p) => p.gender === "f");
      fatherId = m ? m.id : (ps[0] ? ps[0].id : "");
      motherId = f ? f.id : (ps[1] ? ps[1].id : (m ? "" : (ps[0] && !m ? "" : "")));
      // Don't double-pick the same person for both slots
      if (fatherId && motherId === fatherId) motherId = "";
    }
    function recomputeParents() {
      const out = [];
      if (fatherId) out.push(fatherId);
      if (motherId && motherId !== fatherId) out.push(motherId);
      draft.parents = out;
    }

    const fatherPicker = HeritageSelect.create({
      options: relationOptions((p) => p.id !== motherId, I18n.t("form.fatherNone") || "— None —"),
      value: fatherId,
      placeholder: I18n.t("form.fatherNone") || "— None —",
      onChange: (v) => {
        fatherId = v;
        // Refresh the mother options so she can't be the same person
        motherPicker.setOptions(relationOptions((p) => p.id !== fatherId, I18n.t("form.motherNone") || "— None —"));
        recomputeParents();
      }
    });
    const motherPicker = HeritageSelect.create({
      options: relationOptions((p) => p.id !== fatherId, I18n.t("form.motherNone") || "— None —"),
      value: motherId,
      placeholder: I18n.t("form.motherNone") || "— None —",
      onChange: (v) => {
        motherId = v;
        fatherPicker.setOptions(relationOptions((p) => p.id !== motherId, I18n.t("form.fatherNone") || "— None —"));
        recomputeParents();
      }
    });

    // Spouses — dynamic list of HeritageSelect rows
    const spouseRowsHost = el("div", { class: "form-stack", style: { gap: "8px" } });
    let spouseList = (draft.spouses || []).slice(); // working array of ids (with possible "")

    function rebuildSpouseRows() {
      clear(spouseRowsHost);
      // Always show at least one row so the section isn't empty
      const items = spouseList.length ? spouseList : [""];
      items.forEach((id, i) => {
        const used = items.filter((x, j) => x && j !== i);
        const picker = HeritageSelect.create({
          options: relationOptions((p) => !used.includes(p.id), I18n.t("form.spouseNone") || "— None —"),
          value: id || "",
          placeholder: I18n.t("form.spouseNone") || "— None —",
          onChange: (v) => {
            spouseList[i] = v;
            // Keep draft.spouses clean (no empties, no dupes)
            draft.spouses = spouseList.filter((x, j, arr) => x && arr.indexOf(x) === j);
            // Re-render so the other rows can hide the new pick
            spouseList = draft.spouses.slice();
            rebuildSpouseRows();
          }
        });
        const row = el("div", { class: "hrel-row" }, [
          el("span", { class: "hrel-row__pic" }, [
            id ? UI.avatar(FamilyStore.getPerson(id), "sm") : el("span", {
              class: "avatar avatar--sm avatar--mist",
              style: { background: "var(--surface-2)", color: "var(--text-3)" }
            }, "♥")
          ]),
          el("div", { class: "hrel-row__sel" }, [picker.el]),
          (items.length > 1 || id)
            ? el("button", {
                class: "hrel-row__remove",
                type: "button",
                "aria-label": "Remove",
                onclick: () => {
                  spouseList.splice(i, 1);
                  draft.spouses = spouseList.filter(Boolean);
                  spouseList = draft.spouses.slice();
                  rebuildSpouseRows();
                }
              }, [el("i", { class: "fa-solid fa-xmark" })])
            : null
        ]);
        spouseRowsHost.appendChild(row);
      });
      // "+ Add another spouse" button (only meaningful if there are unused candidates)
      const usedIds = new Set(spouseList.filter(Boolean));
      const canAdd = others.some((p) => !usedIds.has(p.id));
      if (canAdd) {
        spouseRowsHost.appendChild(el("button", {
          class: "hrel-add", type: "button",
          onclick: () => {
            spouseList.push("");
            rebuildSpouseRows();
          }
        }, [
          el("i", { class: "fa-solid fa-plus" }),
          el("span", null, I18n.t("form.addSpouse") || "Add another spouse")
        ]));
      }
    }
    rebuildSpouseRows();

    const parentsControl = others.length
      ? el("div", { class: "form-grid" }, [
          el("label", { class: "field" }, [
            el("span", { class: "field__label" }, I18n.t("form.father") || "Father"),
            fatherPicker.el
          ]),
          el("label", { class: "field" }, [
            el("span", { class: "field__label" }, I18n.t("form.mother") || "Mother"),
            motherPicker.el
          ])
        ])
      : el("div", { class: "relations-list" }, []);

    const spousesControl = others.length
      ? spouseRowsHost
      : el("div", { class: "relations-list" }, []);

    // ----- Body layout -----
    // pair(label, en, hi, hint) renders an English field and its optional Hindi twin.
    function pair(label, en, hi, hint) {
      const wrap = el("div", { class: "field-pair" }, [
        field(label, en, hint),
        el("label", { class: "field field--hi" }, [
          el("span", { class: "field__label field__label--hi" }, [
            el("span", { lang: "hi" }, "हिन्दी"),
            el("span", { class: "field__label-tag" }, "optional")
          ]),
          hi
        ])
      ]);
      return wrap;
    }

    const body = el("div", { class: "form-stack" }, [
      photoUploader,
      pair(I18n.t("form.name"), nameInput, nameHiInput, "Required"),
      el("div", { class: "form-grid" }, [
        dateWithPrecisionField(I18n.t("form.birthDate"), birthDateInput, birthPrecPicker, I18n.t("form.datePlaceholder")),
        dateWithPrecisionField(I18n.t("form.deathDate"), deathDateInput, deathPrecPicker, "Leave blank if living")
      ]),
      pair(I18n.t("form.birthPlace"), birthPlaceInput, birthPlaceHiInput),
      pair(I18n.t("form.deathPlace"), deathPlaceInput, deathPlaceHiInput),
      field(I18n.t("form.gender"), genderSelect),
      pair(I18n.t("form.occupation"), occupationInput, occupationHiInput),
      pair(I18n.t("form.description"), descriptionInput, descriptionHiInput, I18n.t("form.descriptionHint")),
      pair(I18n.t("form.achievements"), achievementsInput, achievementsHiInput, I18n.t("form.achievementsHint")),
      pair(I18n.t("form.education"), educationInput, educationHiInput, I18n.t("form.educationHint")),
      others.length
        ? el("div", { class: "field" }, [
            el("span", { class: "field__label" }, I18n.t("form.parents")),
            parentsControl
          ])
        : field(I18n.t("form.parents"), parentsControl, "Add other people first to link relations"),
      others.length
        ? el("div", { class: "field" }, [
            el("span", { class: "field__label" }, I18n.t("form.spouses")),
            spousesControl
          ])
        : field(I18n.t("form.spouses"), spousesControl),
      pair(I18n.t("form.notes"), notesInput, notesHiInput)
    ]);

    // ----- Footer -----
    const cancelBtn = el("button", { class: "btn btn--ghost", type: "button" }, I18n.t("actions.cancel"));
    const saveBtn = el("button", { class: "btn btn--primary", type: "button" }, I18n.t("actions.save"));

    const dlg = openModal({
      title: isEdit
        ? I18n.t("form.editTitle")
        : (seed && seed.parents && seed.parents.length
            ? "Add child"
            : seed && seed.spouses && seed.spouses.length
              ? "Add spouse"
              : seed && seed.__addAsParentOf
                ? "Add parent"
                : I18n.t("form.addTitle")),
      body,
      footer: [cancelBtn, saveBtn]
    });

    cancelBtn.addEventListener("click", () => dlg.close());

    saveBtn.addEventListener("click", () => {
      const name = (draft.name || "").trim();
      if (!name) {
        toast(I18n.t("form.nameRequired"), "danger");
        nameInput.focus();
        return;
      }
      if (draft.birthDate && !FamilyStore.parseDate(draft.birthDate)) {
        toast(I18n.t("form.dateInvalid"), "danger");
        if (birthDatePicker) birthDatePicker.focus();
        else birthDateInput.focus && birthDateInput.focus();
        return;
      }
      if (draft.deathDate && !FamilyStore.parseDate(draft.deathDate)) {
        toast(I18n.t("form.dateInvalid"), "danger");
        if (deathDatePicker) deathDatePicker.focus();
        else deathDateInput.focus && deathDateInput.focus();
        return;
      }

      const payload = {
        name,
        name_hi: draft.name_hi || "",
        photo: draft.photo || null,
        photoId: draft.photoId || null,
        birthDate: draft.birthDate || null,
        birthDatePrecision: draft.birthDate ? (draft.birthDatePrecision || "exact") : null,
        deathDate: draft.deathDate || null,
        deathDatePrecision: draft.deathDate ? (draft.deathDatePrecision || "exact") : null,
        birthPlace: draft.birthPlace || "",
        birthPlace_hi: draft.birthPlace_hi || "",
        deathPlace: draft.deathPlace || "",
        deathPlace_hi: draft.deathPlace_hi || "",
        gender: draft.gender || null,
        notes: draft.notes || "",
        notes_hi: draft.notes_hi || "",
        occupation: draft.occupation || "",
        occupation_hi: draft.occupation_hi || "",
        description: draft.description || "",
        description_hi: draft.description_hi || "",
        achievements: (draft.achievements || []).slice(),
        achievements_hi: (draft.achievements_hi || []).slice(),
        education: (draft.education || []).slice(),
        education_hi: (draft.education_hi || []).slice(),
        parents: draft.parents.slice(),
        spouses: draft.spouses.slice()
      };

      try {
        let saved;
        if (isEdit) saved = FamilyStore.updatePerson(draft.id, payload);
        else saved = FamilyStore.addPerson(payload);
        // If we were asked to attach this new person as a parent of someone,
        // do that now that we have an id.
        if (!isEdit && draft.__addAsParentOf && saved) {
          const child = FamilyStore.getPerson(draft.__addAsParentOf);
          if (child) {
            const parents = (child.parents || []).slice();
            if (!parents.includes(saved.id)) parents.push(saved.id);
            FamilyStore.updatePerson(child.id, { parents });
          }
        }
        dlg.close();
        toast(I18n.t("form.saved"), "success");
      } catch (err) {
        toast(err.message || "Save failed", "danger");
      }
    });

    setTimeout(() => nameInput.focus(), 50);
  }

  // ===== Delete =====

  async function deletePerson(id) {
    const person = FamilyStore.getPerson(id);
    if (!person) return;
    const displayName = FamilyStore.getField(person, "name") || person.name;
    const ok = await confirm({
      title: I18n.t("form.deleteTitle") + " — " + displayName,
      message: I18n.t("form.deleteMsg"),
      confirmLabel: I18n.t("actions.remove"),
      danger: true
    });
    if (!ok) return;
    if (person.photoId && window.PhotoStore) PhotoStore.delete(person.photoId).catch(() => {});
    FamilyStore.deletePerson(id);
    toast(I18n.t("form.removed"), "success");
  }

  if (window.I18n && I18n.onChange) I18n.onChange(() => { if (root) render(); });

  global.PeopleView = { mount, render, openForm, setSearch, setFilter };
})(window);
