// @ts-check
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
  // Maintenance filter — when set, only people missing the named field are
  // shown. Cleared on next user-driven setSearch/setFilter call.
  let missingFilter = null; // null | "birth" | "photo" | "description"
  // Cache of rendered person-cards keyed by person id. Lets render() reorder
  // / show / hide existing DOM rather than rebuilding the grid on every
  // keystroke. Cleared when the underlying person changes (data signature
  // mismatch) or when filter mode rotates.
  const cardCache = new Map();
  // Per-person sig of the bits the card displays; if it matches, we reuse
  // the cached node verbatim.
  function cardSig(p) {
    return p.id + "|" + (p.name || "") + "|" + (p.name_hi || "")
      + "|" + (p.birthDate || "") + "|" + (p.deathDate || "")
      + "|" + (p.birthPlace || "") + "|" + (p.photoId || (p.photo ? "p" : "_"))
      + "|" + (p.updatedAt || "");
  }
  // Search debounce — coalesce keystrokes so a 100-person grid doesn't
  // re-filter on every character.
  let searchTimer = null;
  const SEARCH_DEBOUNCE_MS = 120;

  function mount(rootEl) {
    root = rootEl;
    clear(root);

    searchInput = el("input", {
      type: "search",
      placeholder: I18n.t("people.searchPlaceholder"),
      "data-i18n-placeholder": "people.searchPlaceholder",
      "aria-label": I18n.t("people.searchAria"),
      "data-i18n-aria-label": "people.searchAria",
      oninput: (e) => {
        searchTerm = e.target.value || "";
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(render, SEARCH_DEBOUNCE_MS);
      }
    });
    const search = el("div", { class: "searchbar" }, [
      el("i", { class: "fa-solid fa-magnifying-glass searchbar__icon", "aria-hidden": "true" }),
      searchInput
    ]);

    const addBtn = el("button", {
      class: "btn btn--primary js-edit-only",
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

  function setSearch(s) { searchTerm = s || ""; missingFilter = null; if (searchInput) searchInput.value = searchTerm; render(); }
  function setFilter(f) { filterMode = f || "all"; missingFilter = null; render(); }
  // Show only people missing a given field (birth date / photo / description).
  // Used by the rail's "Needs attention" deep-links.
  function setMissingFilter(field) {
    missingFilter = field || null;
    searchTerm = "";
    if (searchInput) searchInput.value = "";
    render();
  }

  // Does a person pass the active Living/Deceased filter? Shared by the
  // no-query grid and the search branch so a search never silently ignores
  // the filter the user set.
  function matchesFilter(p) {
    return filterMode === "all"
      || (filterMode === "alive" && FamilyStore.isAlive(p))
      || (filterMode === "deceased" && FamilyStore.isDeceased(p));
  }

  // Reflect how many cards a search / filter actually surfaced, instead of
  // leaving the header stuck on the full member total.
  function setResultCount(n) {
    subtitleEl.textContent = n === 0 ? I18n.t("people.resultNone")
      : n === 1 ? I18n.t("people.resultOne")
      : I18n.t("people.resultMany", { n });
  }

  function render() {
    if (!root || !gridHost) return;
    const all = FamilyStore.getPeople();
    subtitleEl.textContent = all.length === 1 ? I18n.t("people.countOne") : I18n.t("people.countMany", { n: all.length });

    // Prune the card cache of entries whose person was deleted, so the
    // map doesn't grow unbounded over a long session.
    if (cardCache.size > all.length * 2) {
      const live = new Set(all.map((p) => p.id));
      cardCache.forEach((_, id) => { if (!live.has(id)) cardCache.delete(id); });
    }

    clear(gridHost);

    if (all.length === 0) {
      gridHost.style.display = "block";
      gridHost.appendChild(emptyStateInitial());
      return;
    }

    // Maintenance deep-link: only show people missing a given field.
    if (missingFilter && FamilyStore.peopleMissing) {
      const missing = FamilyStore.peopleMissing(missingFilter);
      gridHost.style.display = "";
      const whatKey = missingFilter === "birth" ? "people.missingBirth"
        : missingFilter === "photo" ? "people.missingPhoto"
        : "people.missingDesc";
      const banner = el("div", { class: "people-missing-banner" }, [
        el("i", { class: "fa-solid fa-circle-info", "aria-hidden": "true" }),
        el("span", null, I18n.t("people.missingBanner", { n: missing.length, what: I18n.t(whatKey) })),
        el("button", {
          class: "btn btn--sm btn--ghost", type: "button",
          onclick: () => setMissingFilter(null)
        }, I18n.t("people.clearFilter"))
      ]);
      gridHost.appendChild(banner);
      if (!missing.length) {
        gridHost.appendChild(UI.emptyState({
          icon: "fa-solid fa-circle-check",
          title: I18n.t("people.allSetTitle"),
          text: I18n.t("people.allSetText")
        }));
        return;
      }
      sortPeople(missing).forEach((p) => gridHost.appendChild(cachedPersonCard(p)));
      return;
    }

    const q = searchTerm.trim().toLowerCase();

    // Story-first search: when the query matches a story title / body / tag,
    // render those story cards directly (clicking opens the inspector
    // scrolled to that story). Non-story matches still show as person cards.
    // We fall through to the legacy people-only path when the query is
    // empty so the default view stays the family list.
    if (q && FamilyStore.searchStories) {
      const storyHits = (function () {
        try { return FamilyStore.searchStories(q) || []; } catch (_) { return []; }
      })();
      const personHits = all.filter((p) => {
        // Honour the active Living/Deceased filter — a search must not
        // silently widen the set the user narrowed with the filter chips.
        if (!matchesFilter(p)) return false;
        if (p.name && p.name.toLowerCase().includes(q)) return true;
        if (p.name_hi && p.name_hi.toLowerCase().includes(q)) return true;
        if (p.notes && p.notes.toLowerCase().includes(q)) return true;
        if (p.notes_hi && p.notes_hi.toLowerCase().includes(q)) return true;
        return false;
      });

      setResultCount(storyHits.length + personHits.length);

      if (storyHits.length === 0 && personHits.length === 0) {
        gridHost.style.display = "block";
        gridHost.appendChild(emptyStateNoMatches());
        return;
      }

      gridHost.style.display = "";
      // Stories first — that's what the user typed for. Then any extra
      // person matches (so a query that hits both a name AND a story shows
      // both signals).
      storyHits.forEach((hit) => gridHost.appendChild(storyResultCard(hit, q)));
      personHits.forEach((p) => gridHost.appendChild(cachedPersonCard(p)));
      return;
    }

    // No query → the regular all-people grid, with alive/deceased dimming.
    gridHost.style.display = "";
    const sorted = sortPeople(all);
    let matchCount = 0;
    sorted.forEach((p) => {
      const card = cachedPersonCard(p);
      const matches = matchesFilter(p);
      if (matches) matchCount++;
      // is-dim is filter-mode driven, not card-content driven, so flip it
      // every render rather than baking into the cache key.
      card.classList.toggle("is-dim", !matches);
      gridHost.appendChild(card);
    });
    // When a Living/Deceased filter is active, report how many it surfaced;
    // with no filter the header keeps the full member total set above.
    if (filterMode !== "all") setResultCount(matchCount);
  }

  // Wrap matched substring of `text` with a <mark> element and return a
  // DocumentFragment. Case-insensitive, only the first match is highlighted
  // (we keep the snippet short anyway).
  function highlight(text, q) {
    const frag = document.createDocumentFragment();
    if (!text) return frag;
    if (!q) { frag.appendChild(document.createTextNode(String(text))); return frag; }
    const t = String(text);
    const lo = t.toLowerCase();
    const idx = lo.indexOf(q.toLowerCase());
    if (idx === -1) { frag.appendChild(document.createTextNode(t)); return frag; }
    if (idx > 0) frag.appendChild(document.createTextNode(t.slice(0, idx)));
    frag.appendChild(el("mark", { class: "search-mark" }, t.slice(idx, idx + q.length)));
    frag.appendChild(document.createTextNode(t.slice(idx + q.length)));
    return frag;
  }

  // Build a snippet around the first occurrence of `q` in `body`, capped at
  // ~180 chars total. Falls back to the start of the body if the query
  // doesn't actually appear there (story-search may have matched on title
  // or a tag, not the body).
  function snippetAround(body, q) {
    if (!body) return "";
    const t = String(body).replace(/\s+/g, " ").trim();
    if (!q) return t.slice(0, 180) + (t.length > 180 ? "…" : "");
    const idx = t.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return t.slice(0, 180) + (t.length > 180 ? "…" : "");
    const start = Math.max(0, idx - 60);
    const end = Math.min(t.length, idx + q.length + 120);
    return (start > 0 ? "…" : "") + t.slice(start, end) + (end < t.length ? "…" : "");
  }

  function storyResultCard(hit, q) {
    const p = hit.person;
    const s = hit.story;
    const displayName = FamilyStore.getField(p, "name") || p.name;
    const card = el("article", {
      class: "card story-result-card",
      tabindex: "0",
      role: "button",
      "aria-label": I18n.t("people.openStory", { title: s.title || I18n.t("people.untitledStory"), name: displayName }),
      onclick: () => openProfileAtStory(p.id, s.id),
      onkeydown: (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          openProfileAtStory(p.id, s.id);
        }
      }
    });

    // Top: avatar + author name + story title
    const head = el("div", { class: "story-result-card__head" }, [
      avatar(p, "sm"),
      el("div", { class: "story-result-card__author" }, [
        el("div", { class: "story-result-card__title" }, highlight(s.title || I18n.t("people.untitledStory"), q)),
        el("div", { class: "story-result-card__by" }, [
          el("i", { class: "fa-solid fa-feather", "aria-hidden": "true" }),
          el("span", null, displayName)
        ])
      ])
    ]);
    card.appendChild(head);

    // Snippet
    const snippet = snippetAround(s.body || "", q);
    if (snippet) {
      const body = el("p", { class: "story-result-card__snippet" });
      body.appendChild(highlight(snippet, q));
      card.appendChild(body);
    }

    // Tags
    if (s.tags && s.tags.length) {
      const tags = el("div", { class: "story-result-card__tags" },
        s.tags.map((t) => el("span", { class: "chip chip--gold" }, "#" + t))
      );
      card.appendChild(tags);
    }

    return card;
  }

  function openProfileAtStory(personId, storyId) {
    if (window.Inspector && Inspector.show) {
      Inspector.show(personId, { scrollToStoryId: storyId });
    } else {
      openProfile(personId);
    }
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

  // Cached version: returns the same DOM node across renders when the
  // visible bits (name / dates / place / photo / updatedAt) haven't
  // changed. Falls back to fresh build otherwise. Saves a name search
  // from rebuilding 14 DOM trees per keystroke.
  function cachedPersonCard(person) {
    const sig = cardSig(person);
    const hit = cardCache.get(person.id);
    if (hit && hit.sig === sig) return hit.node;
    const node = personCard(person);
    cardCache.set(person.id, { sig, node });
    return node;
  }

  function personCard(person) {
    const displayName = FamilyStore.getField(person, "name") || person.name;
    const displayPlace = FamilyStore.getField(person, "birthPlace") || person.birthPlace;
    const ageChip = buildAgeChip(person);
    const placeChip = displayPlace
      ? el("span", { class: "chip chip--muted" }, [
          el("i", { class: "fa-solid fa-location-dot", "aria-hidden": "true" }),
          el("span", null, displayPlace)
        ])
      : null;

    // .js-edit-only → hidden for viewers (body.is-viewer) alongside the guards
    // in openForm/deletePerson, so read-only users don't even see the controls.
    const editBtn = el("button", {
      class: "btn btn--icon btn--sm btn--ghost js-edit-only",
      type: "button",
      "aria-label": I18n.t("actions.edit") + " " + person.name,
      title: I18n.t("actions.edit"),
      onclick: (e) => { e.stopPropagation(); openForm(person.id); }
    }, [el("i", { class: "fa-solid fa-pen", "aria-hidden": "true" })]);

    const delBtn = el("button", {
      class: "btn btn--icon btn--sm btn--ghost js-edit-only",
      type: "button",
      "aria-label": I18n.t("actions.delete") + " " + person.name,
      title: I18n.t("actions.delete"),
      onclick: (e) => { e.stopPropagation(); deletePerson(person.id); }
    }, [el("i", { class: "fa-solid fa-trash-can", "aria-hidden": "true" })]);

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
    const cls = "chip person-card__age-chip " + (alive ? "chip--alive" : "chip--deceased");
    return el("span", { class: cls }, label);
  }

  function openProfile(id) {
    if (window.Inspector && Inspector.show) Inspector.show(id);
    else if (window.ProfileView && ProfileView.open) ProfileView.open(id);
    else openForm(id);
  }

  function emptyStateInitial() {
    return UI.emptyState({
      icon: "fa-solid fa-seedling",
      title: I18n.t("people.emptyTitle"),
      text: I18n.t("people.emptyText"),
      cta: {
        label: I18n.t("people.addFirst"),
        icon: "fa-solid fa-user-plus",
        onClick: () => openForm(null)
      }
    });
  }

  function emptyStateNoMatches() {
    return UI.emptyState({
      icon: "fa-solid fa-magnifying-glass",
      title: I18n.t("people.noMatchTitle"),
      text: I18n.t("people.noMatchText")
    });
  }

  // ===== Add/Edit form =====

  function openForm(id, seed) {
    // Hard gate: viewers must never reach the add/edit form. The buttons that
    // open it are hidden via .js-edit-only, but the tree node-menu, inspector,
    // and kebab all call openForm too — guard the entry point itself so a
    // viewer can't slip through and be shown a form that silently no-ops on
    // save (FamilyStore.add/updatePerson return null under read-only).
    if (window.FamilyStore && FamilyStore.isReadOnly && FamilyStore.isReadOnly()) {
      toast(I18n.t("people.readOnly"), "warning");
      return;
    }
    const isEdit = !!id;
    const existing = isEdit ? FamilyStore.getPerson(id) : null;
    if (isEdit && !existing) {
      toast(I18n.t("people.notFound"), "danger");
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
      photoCropAvatar: existing ? existing.photoCropAvatar || null : null,
      photoCropHero: existing ? existing.photoCropHero || null : null,
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
      // Contact fields with per-field privacy flags. Existing record carries
      // its own contact object; new records start blank.
      contact: existing && existing.contact
        ? { phone: existing.contact.phone || "", email: existing.contact.email || "", address: existing.contact.address || "",
            privatePhone: !!existing.contact.privatePhone, privateEmail: !!existing.contact.privateEmail, privateAddress: !!existing.contact.privateAddress }
        : { phone: "", email: "", address: "", privatePhone: false, privateEmail: false, privateAddress: false },
      isPet: !!(existing && existing.isPet),
      __addAsParentOf: seed.__addAsParentOf || null
    };

    // Photo-blob lifecycle. We do NOT delete the old IDB blob eagerly when the
    // user replaces or removes a photo — a subsequent Cancel (or close-X /
    // Escape / backdrop) would then leave the record pointing at a blob we
    // already destroyed. Instead we remember the original blob + every blob
    // created during this editing session, and reconcile exactly once on close
    // (see the openModal onClose below): keep the blob the persisted record
    // actually references, delete the rest. This also plugs a re-upload orphan
    // leak (upload A, upload B, Save previously left A pinned forever).
    const originalPhotoId = draft.photoId; // blob the person had when the form opened (or null)
    const sessionBlobs = new Set();        // blobs created via upload during this session
    let committed = false;                 // flipped true only on a successful save

    // Snapshot the draft so we can detect unsaved edits on dismiss. The form
    // can hold minutes of work (a full biography) and the app has no undo, so a
    // stray Escape / backdrop-tap / close-X must not silently discard it.
    const openSnapshot = JSON.stringify(draft);
    let discardConfirming = false;         // guard against stacking confirm dialogs

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
          // Do NOT delete the previous blob here — Cancel must be able to
          // restore it. Cleanup of superseded blobs happens once on close
          // (onClose reconciler below), keyed off what was actually saved.
          if (window.PhotoStore) {
            const id = await PhotoStore.fileToPhotoId(file);
            sessionBlobs.add(id);
            draft.photoId = id;
            draft.photo = null;
          } else {
            const dataUrl = await FamilyStore.fileToDataURL(file);
            draft.photo = dataUrl;
          }
          // Crop frames are tied to the *previous* image's dimensions and
          // composition. A new photo deserves a fresh "fit, centred" default;
          // the user can re-open the Reframe editor to dial it in.
          draft.photoCropAvatar = null;
          draft.photoCropHero = null;
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
        // Detach only — the blob is reconciled on close. If the user removes
        // then cancels, the original is still intact in IDB.
        draft.photoId = null; draft.photo = null;
        draft.photoCropAvatar = null; draft.photoCropHero = null;
        refreshPhoto();
      }
    }, [
      el("span", null, I18n.t("actions.remove"))
    ]);
    const reframeBtn = el("button", {
      class: "btn btn--sm", type: "button",
      onclick: async () => {
        if (!window.CropEditor) return;
        // Resolve current photo to a URL the editor can show.
        let url = null;
        if (draft.photo) url = draft.photo;
        else if (draft.photoId && window.PhotoStore) url = await PhotoStore.getUrl({ photoId: draft.photoId });
        if (!url) { toast(I18n.t("form.noPhotoReframe"), "danger"); return; }
        const out = await CropEditor.open(url, {
          initialAvatar: draft.photoCropAvatar,
          initialHero: draft.photoCropHero
        });
        if (!out) return;
        draft.photoCropAvatar = out.avatar;
        draft.photoCropHero = out.hero;
        refreshPhoto();
        toast(I18n.t("form.cropsSaved"), "success");
      }
    }, [
      el("i", { class: "fa-solid fa-crop-simple", "aria-hidden": "true" }),
      el("span", null, I18n.t("form.reframe"))
    ]);
    const buttonsCol = el("div", { class: "photo-uploader__buttons" }, [
      el("button", {
        class: "btn btn--sm",
        type: "button",
        onclick: () => fileInput.click()
      }, [
        el("i", { class: "fa-solid fa-arrow-up-from-bracket", "aria-hidden": "true" }),
        el("span", null, I18n.t("actions.upload"))
      ]),
      reframeBtn,
      removeBtn
    ]);
    const photoUploader = el("div", { class: "photo-uploader" }, [photoSlot, buttonsCol, fileInput]);

    function refreshPhoto() {
      clear(photoSlot);
      photoSlot.appendChild(avatar({
        name: draft.name || "?",
        photo: draft.photo, photoId: draft.photoId,
        photoCropAvatar: draft.photoCropAvatar
      }, "lg"));
      const has = !!(draft.photoId || draft.photo);
      removeBtn.style.display = has ? "" : "none";
      reframeBtn.style.display = has ? "" : "none";
    }
    refreshPhoto();

    // ----- Text fields -----
    const nameInput = el("input", {
      class: "input",
      type: "text",
      value: draft.name,
      required: true,
      placeholder: I18n.t("form.namePlaceholder"),
      oninput: (e) => {
        draft.name = e.target.value;
        if (!(draft.photoId || draft.photo)) refreshPhoto();
        if (typeof clearFieldError === "function") clearFieldError("name");
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
          onChange: (iso) => { draft.birthDate = iso; clearFieldError("birth"); }
        })
      : null;
    const birthDateInput = birthDatePicker
      ? birthDatePicker.el
      : el("input", {
          class: "input", type: "text", value: draft.birthDate,
          placeholder: "YYYY-MM-DD or YYYY",
          oninput: (e) => { draft.birthDate = e.target.value; clearFieldError("birth"); }
        });

    const deathDatePicker = window.HeritagePicker
      ? window.HeritagePicker.create({
          value: draft.deathDate, placeholder: I18n.t("form.deathDatePlaceholder"),
          allowYearOnly: true,
          onChange: (iso) => { draft.deathDate = iso; clearFieldError("death"); syncDeathPrecVisibility(); }
        })
      : null;
    const deathDateInput = deathDatePicker
      ? deathDatePicker.el
      : el("input", {
          class: "input", type: "text", value: draft.deathDate,
          placeholder: "YYYY-MM-DD or YYYY",
          oninput: (e) => { draft.deathDate = e.target.value; clearFieldError("death"); syncDeathPrecVisibility(); }
        });

    // Precision pickers — Exact / About / Before / After. Sit beside each
    // date input. The precision only means something once a date exists, so
    // the death picker is hidden while the death date is blank ("living").
    const PRECISION_OPTS = [
      { value: "exact",  label: I18n.t("form.precExact") },
      { value: "about",  label: I18n.t("form.precAbout") },
      { value: "before", label: I18n.t("form.precBefore") },
      { value: "after",  label: I18n.t("form.precAfter") }
    ];
    const birthPrecPicker = window.HeritageSelect ? HeritageSelect.create({
      options: PRECISION_OPTS, value: draft.birthDatePrecision || "exact",
      onChange: (v) => { draft.birthDatePrecision = v; }
    }) : null;
    const deathPrecPicker = window.HeritageSelect ? HeritageSelect.create({
      options: PRECISION_OPTS, value: draft.deathDatePrecision || "exact",
      onChange: (v) => { draft.deathDatePrecision = v; }
    }) : null;
    // Label the precision selects for screen readers (the visible field label
    // names the date input beside them, not the picker).
    if (birthPrecPicker) birthPrecPicker.el.setAttribute("aria-label", I18n.t("form.datePrecisionLabel", { field: I18n.t("form.birthDate") }));
    if (deathPrecPicker) deathPrecPicker.el.setAttribute("aria-label", I18n.t("form.datePrecisionLabel", { field: I18n.t("form.deathDate") }));

    // Per-field inline error spans, tied to their control via aria-describedby.
    // Keyed so onChange handlers and the save validator can clear/set by name.
    const fieldErrors = {};
    function makeErrorSpan(key) {
      const span = el("span", { class: "field__error", id: "pf-err-" + key, role: "alert" }, [
        el("i", { class: "fa-solid fa-circle-exclamation", "aria-hidden": "true" }),
        el("span", { class: "field__error-msg" }, "")
      ]);
      fieldErrors[key] = span;
      return span;
    }
    function controlFor(key) {
      if (key === "name") return nameInput;
      if (key === "birth") return birthDatePicker ? birthDatePicker.input : birthDateInput;
      if (key === "death") return deathDatePicker ? deathDatePicker.input : deathDateInput;
      return null;
    }
    function setFieldError(key, msg) {
      const span = fieldErrors[key];
      if (span) {
        span.querySelector(".field__error-msg").textContent = msg;
        span.classList.add("is-shown");
      }
      const ctl = controlFor(key);
      if (ctl) { ctl.setAttribute("aria-invalid", "true"); ctl.setAttribute("aria-describedby", "pf-err-" + key); ctl.classList.add("is-invalid"); }
    }
    function clearFieldError(key) {
      const span = fieldErrors[key];
      if (span) { span.classList.remove("is-shown"); span.querySelector(".field__error-msg").textContent = ""; }
      const ctl = controlFor(key);
      if (ctl) { ctl.removeAttribute("aria-invalid"); ctl.removeAttribute("aria-describedby"); ctl.classList.remove("is-invalid"); }
    }
    // Grid element per date row, so syncDeathPrecVisibility can collapse the
    // track when the precision picker is hidden (else the fixed 130px column
    // leaves an empty gutter beside every living person's death date).
    const precGrids = {};
    function syncDeathPrecVisibility() {
      if (!deathPrecPicker) return;
      const hasDeath = !!(draft.deathDate && String(draft.deathDate).trim());
      deathPrecPicker.el.style.display = hasDeath ? "" : "none";
      const grid = precGrids.death;
      if (grid) grid.style.gridTemplateColumns = hasDeath ? "1fr 130px" : "1fr";
    }
    function dateWithPrecisionField(label, key, dateEl, precPicker, hint) {
      const grid = el("div", { style: { display: "grid", gridTemplateColumns: "1fr 130px", gap: "8px" } }, [
        dateEl,
        precPicker ? precPicker.el : null
      ]);
      precGrids[key] = grid;
      const wrap = el("div", { class: "field" }, [
        el("span", { class: "field__label" }, label),
        grid,
        hint ? el("span", { class: "field__hint" }, hint) : null,
        makeErrorSpan(key)
      ]);
      return wrap;
    }

    const birthPlaceInput = el("input", {
      class: "input", type: "text", value: draft.birthPlace,
      placeholder: I18n.t("form.placePlaceholder"),
      oninput: (e) => { draft.birthPlace = e.target.value; }
    });
    const birthPlaceHiInput = el("input", {
      class: "input", type: "text", value: draft.birthPlace_hi,
      placeholder: "नगर, देश", lang: "hi",
      oninput: (e) => { draft.birthPlace_hi = e.target.value; }
    });

    const deathPlaceInput = el("input", {
      class: "input", type: "text", value: draft.deathPlace,
      placeholder: I18n.t("form.placePlaceholder"),
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
      placeholder: I18n.t("form.notesPlaceholder"),
      oninput: (e) => { draft.notes = e.target.value; }
    }, draft.notes);
    const notesHiInput = el("textarea", {
      class: "textarea", placeholder: "कहानियाँ, यादें…", lang: "hi",
      oninput: (e) => { draft.notes_hi = e.target.value; }
    }, draft.notes_hi);

    // Contact fields — phone / email / address. Each with a small "private"
    // checkbox that strips the field from JSON / PNG / poster exports.
    function contactRow(field, type, placeholder, icon) {
      const input = el("input", {
        class: "input", type, value: draft.contact[field], placeholder,
        oninput: (e) => { draft.contact[field] = e.target.value; }
      });
      const privKey = "private" + field.charAt(0).toUpperCase() + field.slice(1);
      const privateCb = el("input", { type: "checkbox" });
      privateCb.checked = !!draft.contact[privKey];
      privateCb.addEventListener("change", () => { draft.contact[privKey] = privateCb.checked; });
      const privateLabel = el("label", { class: "form-private-toggle", title: I18n.t("form.privateHint") }, [
        privateCb,
        el("i", { class: "fa-solid fa-lock", "aria-hidden": "true" }),
        el("span", null, I18n.t("form.private"))
      ]);
      return el("div", { class: "form-contact-row" }, [
        el("i", { class: icon + " form-contact-row__icon", "aria-hidden": "true" }),
        input,
        privateLabel
      ]);
    }
    const contactRows = el("div", { class: "form-contact" }, [
      contactRow("phone", "tel", I18n.t("form.phonePlaceholder"), "fa-solid fa-phone"),
      contactRow("email", "email", "name@example.com", "fa-solid fa-envelope"),
      contactRow("address", "text", I18n.t("form.addressPlaceholder"), "fa-solid fa-house")
    ]);

    // Pet toggle — companion animal? When on, the tree paints a paw badge.
    const petCb = el("input", { type: "checkbox" });
    petCb.checked = !!draft.isPet;
    petCb.addEventListener("change", () => { draft.isPet = petCb.checked; });
    const petToggle = el("label", { class: "form-pet-toggle" }, [
      petCb,
      el("i", { class: "fa-solid fa-paw", "aria-hidden": "true" }),
      el("span", null, I18n.t("form.petLabel"))
    ]);

    const occupationInput = el("input", {
      class: "input", type: "text", value: draft.occupation,
      placeholder: I18n.t("form.occupationPlaceholder"),
      oninput: (e) => { draft.occupation = e.target.value; }
    });
    const occupationHiInput = el("input", {
      class: "input", type: "text", value: draft.occupation_hi,
      placeholder: "अभियंता, शिक्षक…", lang: "hi",
      oninput: (e) => { draft.occupation_hi = e.target.value; }
    });

    const descriptionInput = el("textarea", {
      class: "textarea",
      placeholder: I18n.t("form.descriptionPlaceholder"),
      oninput: (e) => { draft.description = e.target.value; }
    }, draft.description);
    const descriptionHiInput = el("textarea", {
      class: "textarea", placeholder: "संक्षिप्त परिचय…", lang: "hi",
      oninput: (e) => { draft.description_hi = e.target.value; }
    }, draft.description_hi);

    const achievementsInput = el("textarea", {
      class: "textarea",
      placeholder: I18n.t("form.achievementsPlaceholder"),
      oninput: (e) => { draft.achievements = e.target.value.split(/\n+/).map((s) => s.trim()).filter(Boolean); }
    }, (draft.achievements || []).join("\n"));
    const achievementsHiInput = el("textarea", {
      class: "textarea", placeholder: "उपलब्धियाँ (प्रत्येक पंक्ति में एक)", lang: "hi",
      oninput: (e) => { draft.achievements_hi = e.target.value.split(/\n+/).map((s) => s.trim()).filter(Boolean); }
    }, (draft.achievements_hi || []).join("\n"));

    const educationInput = el("textarea", {
      class: "textarea",
      placeholder: I18n.t("form.educationPlaceholder"),
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

    // Descendants of the person being edited must not be offered as a parent —
    // picking one would create an ancestor cycle (e.g. set your own son as
    // your father), which corrupts buildGenerations' generation numbering and
    // makes drawEdges render a backward-pointing edge. The pickers previously
    // only excluded self + narrowed by gender, so this was reachable in two
    // clicks through the ordinary form. BFS over children from the draft id;
    // for a NEW person (draft.id null) there are no descendants → empty set,
    // so this is a safe no-op there.
    const descendantIds = (function collectDescendants() {
      const set = new Set();
      if (!draft.id) return set;
      const queue = [draft.id];
      while (queue.length) {
        const cur = queue.shift();
        (FamilyStore.getChildrenOf(cur) || []).forEach((child) => {
          if (child && !set.has(child.id)) { set.add(child.id); queue.push(child.id); }
        });
      }
      return set;
    })();

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

    // Slot the existing parents into Father / Mother for editing. A male parent
    // fills Father, a female parent fills Mother; any still-unplaced parent
    // (ungendered, or a same-gender second) drops into the first empty slot.
    // This is just for the form — the schema still stores `parents: [id, id]`.
    //
    // Slotting MUST respect gender, not position: a sole female parent assigned
    // to Father positionally would be excluded by the male-only Father filter
    // (and by the Mother filter, which excludes whoever's in Father), leaving
    // her invisible in both pickers and silently droppable on the next edit.
    let fatherId = "", motherId = "";
    if (draft.parents && draft.parents.length) {
      const ps = draft.parents.map(FamilyStore.getPerson).filter(Boolean);
      const male = ps.find((p) => p.gender === "m");
      const female = ps.find((p) => p.gender === "f");
      if (male) fatherId = male.id;
      if (female && female.id !== fatherId) motherId = female.id;
      // Fill remaining empty slots with any parent not already placed.
      ps.forEach((p) => {
        if (p.id === fatherId || p.id === motherId) return;
        if (!fatherId) fatherId = p.id;
        else if (!motherId) motherId = p.id;
      });
    }
    function recomputeParents() {
      const out = [];
      if (fatherId) out.push(fatherId);
      if (motherId && motherId !== fatherId) out.push(motherId);
      draft.parents = out;
    }

    // Gender-narrow the parent dropdowns: fathers are male-or-unspecified,
    // mothers are female-or-unspecified. Showing every person in both lists
    // is confusing — users expect "Father" to mean a male candidate.
    // BUT always keep whoever is currently in this slot, even if their gender
    // doesn't match the heuristic — otherwise an already-assigned parent (from
    // legacy data or a same-gender couple) would vanish from their own picker
    // and couldn't be re-selected or cleared.
    const fatherFilter = (p) => p.id !== motherId && (p.id === fatherId || isMale(p)) && !descendantIds.has(p.id);
    const motherFilter = (p) => p.id !== fatherId && (p.id === motherId || isFemale(p)) && !descendantIds.has(p.id);

    const fatherPicker = HeritageSelect.create({
      options: relationOptions(fatherFilter, I18n.t("form.fatherNone") || "— None —"),
      value: fatherId,
      placeholder: I18n.t("form.fatherNone") || "— None —",
      onChange: (v) => {
        fatherId = v;
        motherPicker.setOptions(relationOptions(motherFilter, I18n.t("form.motherNone") || "— None —"));
        recomputeParents();
      }
    });
    const motherPicker = HeritageSelect.create({
      options: relationOptions(motherFilter, I18n.t("form.motherNone") || "— None —"),
      value: motherId,
      placeholder: I18n.t("form.motherNone") || "— None —",
      onChange: (v) => {
        motherId = v;
        fatherPicker.setOptions(relationOptions(fatherFilter, I18n.t("form.fatherNone") || "— None —"));
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
      const genderOk = spouseGenderFilter();
      items.forEach((id, i) => {
        const used = items.filter((x, j) => x && j !== i);
        const picker = HeritageSelect.create({
          options: relationOptions((p) => !used.includes(p.id) && genderOk(p), I18n.t("form.spouseNone") || "— None —"),
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
                "aria-label": I18n.t("form.removeSpouse"),
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
      // "+ Add another spouse" button (only meaningful if there are unused
      // candidates of a compatible gender — otherwise pressing + would just
      // add an empty row with nothing to pick).
      const usedIds = new Set(spouseList.filter(Boolean));
      const canAdd = others.some((p) => !usedIds.has(p.id) && genderOk(p));
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
            el("span", { class: "field__label-tag" }, I18n.t("form.optional"))
          ]),
          hi
        ])
      ]);
      return wrap;
    }

    const nameField = pair(I18n.t("form.name"), nameInput, nameHiInput, I18n.t("form.required"));
    // Attach the name error span into the English half of the name pair.
    nameField.querySelector(".field")?.appendChild(makeErrorSpan("name"));

    // Essentials — always visible. The identity a record can't do without:
    // photo, name, dates, gender. Everything else lives under More details so
    // a new person isn't a flat wall of ~15 groups.
    const essentials = el("div", { class: "form-stack" }, [
      photoUploader,
      nameField,
      el("div", { class: "form-grid" }, [
        dateWithPrecisionField(I18n.t("form.birthDate"), "birth", birthDateInput, birthPrecPicker, I18n.t("form.datePlaceholder")),
        dateWithPrecisionField(I18n.t("form.deathDate"), "death", deathDateInput, deathPrecPicker, I18n.t("form.deathDatePlaceholder"))
      ]),
      field(I18n.t("form.gender"), genderSelect)
    ]);

    // More details — the rest, folded into a native <details> disclosure so
    // it's keyboard-accessible with no JS. Opens by default when editing a
    // record that already has data in these fields (so nothing is hidden), and
    // stays collapsed for a brand-new person.
    const moreInner = el("div", { class: "form-stack" }, [
      pair(I18n.t("form.birthPlace"), birthPlaceInput, birthPlaceHiInput),
      pair(I18n.t("form.deathPlace"), deathPlaceInput, deathPlaceHiInput),
      pair(I18n.t("form.occupation"), occupationInput, occupationHiInput),
      pair(I18n.t("form.description"), descriptionInput, descriptionHiInput, I18n.t("form.descriptionHint")),
      pair(I18n.t("form.achievements"), achievementsInput, achievementsHiInput, I18n.t("form.achievementsHint")),
      pair(I18n.t("form.education"), educationInput, educationHiInput, I18n.t("form.educationHint")),
      others.length
        ? el("div", { class: "field" }, [
            el("span", { class: "field__label" }, I18n.t("form.parents")),
            parentsControl
          ])
        : field(I18n.t("form.parents"), parentsControl, I18n.t("form.relationsEmpty")),
      others.length
        ? el("div", { class: "field" }, [
            el("span", { class: "field__label" }, I18n.t("form.spouses")),
            spousesControl
          ])
        : field(I18n.t("form.spouses"), spousesControl),
      pair(I18n.t("form.notes"), notesInput, notesHiInput),
      field(I18n.t("form.contact"), contactRows, I18n.t("form.contactHint")),
      el("div", { class: "field" }, [petToggle])
    ]);
    const hasMoreData = !!(draft.birthPlace || draft.birthPlace_hi || draft.deathPlace || draft.deathPlace_hi
      || draft.occupation || draft.occupation_hi || draft.description || draft.description_hi
      || (draft.achievements && draft.achievements.length) || (draft.education && draft.education.length)
      || (draft.parents && draft.parents.length) || (draft.spouses && draft.spouses.length)
      || draft.notes || draft.notes_hi
      || (draft.contact && (draft.contact.phone || draft.contact.email || draft.contact.address))
      || draft.isPet);
    const moreDetails = el("details", { class: "form-more" }, [
      el("summary", { class: "form-more__summary" }, [
        el("i", { class: "fa-solid fa-chevron-right form-more__chev", "aria-hidden": "true" }),
        el("span", null, I18n.t("form.moreDetails"))
      ]),
      moreInner
    ]);
    if (isEdit && hasMoreData) moreDetails.open = true;

    const body = el("div", { class: "form-stack" }, [essentials, moreDetails]);
    // Reflect the initial death-date state (hide precision when "living").
    syncDeathPrecVisibility();

    // ----- Footer -----
    const cancelBtn = UI.cancelBtn(I18n.t("actions.cancel"));
    const saveBtn = UI.saveBtn(I18n.t("actions.save"));

    const dlg = openModal({
      title: isEdit
        ? I18n.t("form.editTitle")
        : (seed && seed.parents && seed.parents.length
            ? I18n.t("inspector.addChild")
            : seed && seed.spouses && seed.spouses.length
              ? I18n.t("inspector.addSpouse")
              : seed && seed.__addAsParentOf
                ? I18n.t("inspector.addParent")
                : I18n.t("form.addTitle")),
      body,
      footer: [cancelBtn, saveBtn],
      // Enter in any single-line field saves — matches every other form on the
      // web. openModal excludes textareas and the date picker's own input (which
      // commits the typed date on its own Enter), so this won't fire mid-date.
      onEnter: () => saveBtn.click(),
      // Unsaved-changes guard. Runs on every dismiss route (Cancel, close-X,
      // Escape, backdrop). If the draft differs from the opening snapshot and
      // the user hasn't saved, veto the close and ask to confirm the discard.
      beforeClose: () => {
        if (committed) return true;                    // a save is never "discarded"
        // Fold in any date typed but not yet committed so the diff is honest.
        if (birthDatePicker && birthDatePicker.flush) birthDatePicker.flush();
        if (deathDatePicker && deathDatePicker.flush) deathDatePicker.flush();
        if (JSON.stringify(draft) === openSnapshot) return true;  // untouched → let it close
        if (discardConfirming) return false;           // confirm already open
        discardConfirming = true;
        UI.confirm({
          title: I18n.t("form.discardTitle"),
          message: I18n.t("form.discardMsg"),
          confirmLabel: I18n.t("actions.discard"),
          danger: true
        }).then((ok) => {
          discardConfirming = false;
          if (ok) dlg.close(true);                     // force past this guard
        });
        return false;
      },
      // Single reconciliation point for photo blobs, covering ALL dismiss
      // routes (Save, Cancel, close-X, Escape, backdrop) since they all funnel
      // through openModal's close(). The blob the surviving record points at is
      // kept; every other blob we touched this session is deleted.
      onClose: () => {
        if (!window.PhotoStore) return;
        // After a save, the record references draft.photoId; after any dismiss
        // it still references originalPhotoId. Anything else we created or
        // replaced is now unreachable and should be freed.
        const keep = committed ? draft.photoId : originalPhotoId;
        const toDelete = new Set(sessionBlobs);
        if (committed && originalPhotoId && originalPhotoId !== keep) {
          // Saved with a different/no photo → the original blob is orphaned.
          toDelete.add(originalPhotoId);
        }
        toDelete.delete(keep); // never delete the blob the record still uses
        toDelete.forEach((id) => { if (id) PhotoStore.delete(id).catch(() => {}); });
      }
    });

    cancelBtn.addEventListener("click", () => dlg.close());

    function focusField(key) {
      if (key === "name") { nameInput.focus(); return; }
      if (key === "birth") { if (birthDatePicker) birthDatePicker.focus(); else birthDateInput.focus && birthDateInput.focus(); return; }
      if (key === "death") { if (deathDatePicker) deathDatePicker.focus(); else deathDateInput.focus && deathDateInput.focus(); }
    }
    // Show an inline error on a field and focus it. Death-date errors live
    // under More details, so open that disclosure first or the message is
    // invisible. Returns false so callers can `return fail(...)`.
    function fail(key, msg) {
      setFieldError(key, msg);
      if (key === "death" && moreDetails && !moreDetails.open) moreDetails.open = true;
      focusField(key);
      return false;
    }

    saveBtn.addEventListener("click", () => {
      // Commit any date the user typed but didn't confirm with Enter — the
      // blur→commit can be deferred on Safari/Firefox and would otherwise run
      // after this handler, silently dropping the typed date.
      if (birthDatePicker && birthDatePicker.flush) birthDatePicker.flush();
      if (deathDatePicker && deathDatePicker.flush) deathDatePicker.flush();
      clearFieldError("name"); clearFieldError("birth"); clearFieldError("death");

      // A person needs a name in EITHER script — someone recording only in
      // Hindi shouldn't be forced to romanise. If the Latin name is blank we
      // resolve the Hindi one into `name` so every downstream reader (which
      // keys off `name`) still works.
      let name = (draft.name || "").trim();
      const nameHi = (draft.name_hi || "").trim();
      if (!name && nameHi) name = nameHi;
      if (!name) { fail("name", I18n.t("form.nameRequired")); return; }

      const birth = draft.birthDate ? FamilyStore.parseDate(draft.birthDate) : null;
      if (draft.birthDate && !birth) { fail("birth", I18n.t("form.dateInvalid")); return; }
      const death = draft.deathDate ? FamilyStore.parseDate(draft.deathDate) : null;
      if (draft.deathDate && !death) { fail("death", I18n.t("form.dateInvalid")); return; }

      // Sanity: birth can't come after death, and neither can be in the future.
      // Compare by year so a same-year birth/death (common when only years are
      // known) isn't flagged by the Jan-1 normalisation of a bare "YYYY".
      const nowYear = new Date().getFullYear();
      if (birth && birth.getFullYear() > nowYear) { fail("birth", I18n.t("form.dateFutureInvalid")); return; }
      if (death && death.getFullYear() > nowYear) { fail("death", I18n.t("form.dateFutureInvalid")); return; }
      if (birth && death && birth.getFullYear() > death.getFullYear()) {
        fail("death", I18n.t("form.dateOrderInvalid")); return;
      }

      const payload = {
        name,
        name_hi: draft.name_hi || "",
        photo: draft.photo || null,
        photoId: draft.photoId || null,
        photoCropAvatar: draft.photoCropAvatar || null,
        photoCropHero: draft.photoCropHero || null,
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
        spouses: draft.spouses.slice(),
        contact: {
          phone: (draft.contact.phone || "").trim(),
          email: (draft.contact.email || "").trim(),
          address: (draft.contact.address || "").trim(),
          privatePhone: !!draft.contact.privatePhone,
          privateEmail: !!draft.contact.privateEmail,
          privateAddress: !!draft.contact.privateAddress
        },
        isPet: !!draft.isPet
      };

      try {
        let saved;
        if (isEdit) saved = FamilyStore.updatePerson(draft.id, payload);
        else saved = FamilyStore.addPerson(payload);
        // Both add/updatePerson return null under read-only (and updatePerson
        // also returns null for a vanished id). Never claim success on a null —
        // otherwise a viewer, or an editor whose role was revoked mid-form, sees
        // a "Saved" toast for a write that never persisted.
        if (!saved) {
          toast(I18n.t("people.readOnly"), "warning");
          return;
        }
        // If we were asked to attach this new person as a parent of someone,
        // do that now that we have an id.
        if (!isEdit && draft.__addAsParentOf) {
          const child = FamilyStore.getPerson(draft.__addAsParentOf);
          if (child) {
            const parents = (child.parents || []).slice();
            if (!parents.includes(saved.id)) parents.push(saved.id);
            FamilyStore.updatePerson(child.id, { parents });
          }
        }
        // Persisted successfully — tell the onClose reconciler to keep the
        // saved blob and free the superseded ones. Must precede close(), which
        // fires onClose synchronously.
        committed = true;
        dlg.close();
        toast(I18n.t("form.saved"), "success");
        // After adding a NEW person, select them and pan the tree so the fresh
        // node is never left off-screen. revealPerson() selects via Inspector
        // and pans/zooms if the tree is showing; fall back to plain selection
        // when TreeView isn't available (e.g. selection from a minimal build).
        if (!isEdit && saved) {
          if (window.TreeView && TreeView.revealPerson) TreeView.revealPerson(saved.id);
          else if (window.Inspector && Inspector.show) Inspector.show(saved.id);
        }
      } catch (err) {
        toast(err.message || I18n.t("form.saveFailed"), "danger");
      }
    });

    setTimeout(() => nameInput.focus(), 50);
  }

  // ===== Delete =====

  async function deletePerson(id) {
    // Same hard gate as openForm — viewers can't delete. FamilyStore.deletePerson
    // no-ops under read-only, so without this a viewer would see a "Removed"
    // success toast for a delete that never happened.
    if (window.FamilyStore && FamilyStore.isReadOnly && FamilyStore.isReadOnly()) {
      toast(I18n.t("people.readOnly"), "warning");
      return;
    }
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
    // Blob cleanup (own photo + marriage photos + petOwners strip) is owned by
    // FamilyStore.deletePerson now — don't duplicate it here.
    FamilyStore.deletePerson(id);
    toast(I18n.t("form.removed"), "success");
  }

  if (window.I18n && I18n.onChange) I18n.onChange(() => { if (root) render(); });

  global.PeopleView = { mount, render, openForm, setSearch, setFilter, setMissingFilter };
})(window);
