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

  function mount(rootEl) {
    root = rootEl;
    clear(root);

    const title = el("div", null, [
      el("h2", { class: "section-head__title", "data-i18n": "people.title" }, I18n.t("people.title")),
      (subtitleEl = el("div", { class: "section-head__sub" }, ""))
    ]);

    searchInput = el("input", {
      type: "search",
      placeholder: I18n.t("people.searchPlaceholder"),
      "data-i18n-placeholder": "people.searchPlaceholder",
      "aria-label": "Search people by name",
      oninput: (e) => { searchTerm = e.target.value || ""; render(); }
    });
    const search = el("div", { class: "searchbar" }, [
      el("span", { class: "searchbar__icon", "aria-hidden": "true" }, "🔍"),
      searchInput
    ]);

    const addBtn = el("button", {
      class: "btn btn--primary",
      type: "button",
      onclick: () => openForm(null)
    }, [el("span", { "aria-hidden": "true" }, "＋"), el("span", { "data-i18n": "actions.add" }, I18n.t("actions.add"))]);

    const head = el("div", { class: "section-head" }, [
      title,
      el("div", { style: { display: "flex", gap: "var(--s-3)", alignItems: "center", flexWrap: "wrap" } }, [
        search,
        addBtn
      ])
    ]);

    gridHost = el("div", null);

    root.appendChild(head);
    root.appendChild(gridHost);

    render();
  }

  function render() {
    if (!root || !gridHost) return;
    const all = FamilyStore.getPeople();
    subtitleEl.textContent = all.length === 1 ? I18n.t("people.countOne") : I18n.t("people.countMany", { n: all.length });

    clear(gridHost);

    if (all.length === 0) {
      gridHost.appendChild(emptyStateInitial());
      return;
    }

    const filtered = filterPeople(all, searchTerm);
    if (filtered.length === 0) {
      gridHost.appendChild(emptyStateNoMatches());
      return;
    }

    const sorted = sortPeople(filtered);
    const grid = el("div", { class: "people-grid" }, sorted.map(personCard));
    gridHost.appendChild(grid);
  }

  function filterPeople(people, term) {
    const q = term.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) => {
      if (p.name && p.name.toLowerCase().includes(q)) return true;
      if (p.name_hi && p.name_hi.toLowerCase().includes(q)) return true;
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
          el("div", { class: "person-card__name" }, displayName),
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
    if (window.ProfileView && ProfileView.open) ProfileView.open(id);
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

  function openForm(id) {
    const isEdit = !!id;
    const existing = isEdit ? FamilyStore.getPerson(id) : null;
    if (isEdit && !existing) {
      toast("Person not found", "danger");
      return;
    }

    // Working copy of the person (only fields used by the form).
    const draft = {
      id: existing ? existing.id : null,
      name: existing ? existing.name : "",
      name_hi: existing ? existing.name_hi || "" : "",
      photoId: existing ? existing.photoId || null : null,
      photoUrl: existing ? existing.photoUrl || null : null,
      photo: existing ? existing.photo : null, // legacy
      birthDate: existing ? existing.birthDate || "" : "",
      deathDate: existing ? existing.deathDate || "" : "",
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
      parents: existing ? existing.parents.slice() : [],
      spouses: existing ? existing.spouses.slice() : []
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
            draft.photoUrl = null;
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
        draft.photoId = null; draft.photoUrl = null; draft.photo = null;
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
        photo: draft.photo, photoId: draft.photoId, photoUrl: draft.photoUrl
      }, "lg"));
      const has = !!(draft.photoId || draft.photoUrl || draft.photo);
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
        if (!(draft.photoId || draft.photoUrl || draft.photo)) refreshPhoto();
      }
    });
    const nameHiInput = el("input", {
      class: "input", type: "text", value: draft.name_hi,
      placeholder: "पूरा नाम", lang: "hi",
      oninput: (e) => { draft.name_hi = e.target.value; }
    });

    const birthDateInput = el("input", {
      class: "input",
      type: "text",
      value: draft.birthDate,
      placeholder: "YYYY-MM-DD or YYYY",
      oninput: (e) => { draft.birthDate = e.target.value; }
    });

    const deathDateInput = el("input", {
      class: "input",
      type: "text",
      value: draft.deathDate,
      placeholder: "YYYY-MM-DD or YYYY",
      oninput: (e) => { draft.deathDate = e.target.value; }
    });

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

    const genderSelect = el("select", {
      class: "select",
      onchange: (e) => { draft.gender = e.target.value; }
    }, [
      el("option", { value: "" }, "—"),
      el("option", { value: "m" }, "Male"),
      el("option", { value: "f" }, "Female"),
      el("option", { value: "o" }, "Other")
    ]);
    genderSelect.value = draft.gender || "";

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

    // ----- Relations (parents / spouses) -----
    const others = FamilyStore.getPeople()
      .filter((p) => p.id !== draft.id)
      .sort((a, b) => a.name.localeCompare(b.name));

    function buildRelationSelect(selectedIds, onChange) {
      const options = others.map((p) => {
        const opt = el("option", { value: p.id }, p.name + (p.birthDate ? ` (${FamilyStore.getYear(p.birthDate) || ""})` : ""));
        if (selectedIds.includes(p.id)) opt.selected = true;
        return opt;
      });
      const sel = el("select", {
        class: "select",
        multiple: true,
        size: Math.min(6, Math.max(4, others.length || 4)),
        onchange: (e) => {
          const picked = Array.from(e.target.selectedOptions).map((o) => o.value);
          onChange(picked);
        }
      }, options);
      return sel;
    }

    const parentsControl = others.length
      ? buildRelationSelect(draft.parents, (ids) => { draft.parents = ids; })
      : el("div", { class: "relations-list" }, []);

    const spousesControl = others.length
      ? buildRelationSelect(draft.spouses, (ids) => { draft.spouses = ids; })
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
        field(I18n.t("form.birthDate"), birthDateInput, I18n.t("form.datePlaceholder")),
        field(I18n.t("form.deathDate"), deathDateInput, "Leave blank if living")
      ]),
      pair(I18n.t("form.birthPlace"), birthPlaceInput, birthPlaceHiInput),
      pair(I18n.t("form.deathPlace"), deathPlaceInput, deathPlaceHiInput),
      field(I18n.t("form.gender"), genderSelect),
      pair(I18n.t("form.occupation"), occupationInput, occupationHiInput),
      pair(I18n.t("form.description"), descriptionInput, descriptionHiInput, I18n.t("form.descriptionHint")),
      pair(I18n.t("form.achievements"), achievementsInput, achievementsHiInput, I18n.t("form.achievementsHint")),
      pair(I18n.t("form.education"), educationInput, educationHiInput, I18n.t("form.educationHint")),
      field(I18n.t("form.parents"), parentsControl, others.length ? "Hold ⌘/Ctrl to select multiple" : "Add other people first to link relations"),
      field(I18n.t("form.spouses"), spousesControl, others.length ? "Hold ⌘/Ctrl to select multiple" : null),
      pair(I18n.t("form.notes"), notesInput, notesHiInput)
    ]);

    // ----- Footer -----
    const cancelBtn = el("button", { class: "btn btn--ghost", type: "button" }, I18n.t("actions.cancel"));
    const saveBtn = el("button", { class: "btn btn--primary", type: "button" }, I18n.t("actions.save"));

    const dlg = openModal({
      title: isEdit ? I18n.t("form.editTitle") : I18n.t("form.addTitle"),
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
        toast(I18n.t("form.datePlaceholder"), "danger");
        birthDateInput.focus();
        return;
      }
      if (draft.deathDate && !FamilyStore.parseDate(draft.deathDate)) {
        toast(I18n.t("form.datePlaceholder"), "danger");
        deathDateInput.focus();
        return;
      }

      const payload = {
        name,
        name_hi: draft.name_hi || "",
        photo: draft.photo || null,
        photoId: draft.photoId || null,
        photoUrl: draft.photoUrl || null,
        birthDate: draft.birthDate || null,
        deathDate: draft.deathDate || null,
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
        if (isEdit) FamilyStore.updatePerson(draft.id, payload);
        else FamilyStore.addPerson(payload);
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

  global.PeopleView = { mount, render, openForm };
})(window);
