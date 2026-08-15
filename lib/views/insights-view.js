// @ts-check
/**
 * Insights view — a small, factual dashboard derived entirely from data already
 * on file. No new data entry, no data-model change: it only reads the tree.
 *
 * Exposes window.InsightsView = { mount(rootEl), render() }.
 * mount() builds the static view-head once; render() recomputes every stat and
 * repaints the body. render() runs on activate, on every store change, and on
 * language change (app.js drives all three), so I18n.t() re-resolves each time —
 * no data-i18n needed on the dynamic body.
 *
 * Metrics (all human-only; pets are excluded — see isPerson):
 *   • Generation depth   — max generation span from FamilyStore.buildGenerations
 *   • Average lifespan    — mean age-at-death over deceased with a computable age
 *   • Gender ratio        — m / f / other counts
 *   • Born-by-decade      — histogram of birth years bucketed to decades
 *   • Name trends          — most common first names
 *   • Roots / birthplaces  — distinct birthplaces + the most common ones
 *   • Eldest & youngest    — the oldest and youngest living members by age
 */
(function (global) {
  "use strict";

  const { el, clear } = UI;

  let root = null;
  let titleAccentEl = null;

  // First word of the family name — the accent word in the view title, matching
  // Timeline/Tree/People. Falls back to the localized "Family" if unset.
  function familyAccent() {
    const fam = FamilyStore.getFamilyName ? FamilyStore.getFamilyName() : "";
    return (String(fam || "").trim().split(/\s+/)[0]) || I18n.t("insights.titleFallback");
  }

  // Pets carry gender + generations too, but they'd skew human demographics.
  // Every human stat filters through this.
  function isPerson(p) { return !p.isPet; }

  function mount(rootEl) {
    root = rootEl;
    clear(root);

    titleAccentEl = el("span", { class: "view-head__title-accent" }, familyAccent());
    const head = el("div", { class: "view-head" }, [
      el("div", { class: "view-head__title-wrap" }, [
        el("span", { class: "view-head__eyebrow", "data-i18n": "insights.eyebrow" }, I18n.t("insights.eyebrow")),
        el("h2", { class: "view-head__title" }, [
          titleAccentEl,
          document.createTextNode(" "),
          el("span", { "data-i18n": "insights.titleWord" }, I18n.t("insights.titleWord"))
        ]),
        el("span", { class: "view-head__sub", "data-i18n": "insights.subtitle" }, I18n.t("insights.subtitle"))
      ])
    ]);

    const body = el("div", { class: "insights-body", id: "insights-body" });
    root.appendChild(head);
    root.appendChild(body);
    render();
  }

  // ===== Stat computation (pure over the current people snapshot) =====
  function computeStats() {
    const all = (FamilyStore.getPeople() || []).filter(isPerson);
    // Honour the shared faceted Filter (window.Filter) so the dashboard matches
    // what People/Tree/Timeline show. When a filter is active every stat below
    // reflects the narrowed set; totalAll keeps the unfiltered count so render()
    // can say "showing N of M" rather than silently reporting a partial figure.
    const filtered = !!(window.Filter && Filter.isActive && Filter.isActive());
    const match = (window.Filter && Filter.matches) ? Filter.matches : () => true;
    const people = filtered ? all.filter(match) : all;
    const total = people.length;

    // Generation depth: buildGenerations returns Map<id,gen> (0-based). The
    // human depth is (max human gen − min human gen) + 1. Pets are placed one
    // gen below their owner, so filter the map to humans before spanning.
    let generations = 0;
    if (total && FamilyStore.buildGenerations) {
      const genMap = FamilyStore.buildGenerations();
      let lo = Infinity, hi = -Infinity;
      people.forEach((p) => {
        const g = genMap.get(p.id);
        if (g == null) return;
        if (g < lo) lo = g;
        if (g > hi) hi = g;
      });
      if (hi >= lo) generations = (hi - lo) + 1;
    }

    // Average lifespan: deceased only, with a computable age (needs both a
    // parseable birth and death date). calcAge returns age-at-death for the
    // deceased. Living people are excluded — their "age so far" isn't a lifespan.
    let lifespanSum = 0, lifespanCount = 0;
    people.forEach((p) => {
      if (!FamilyStore.isDeceased(p)) return;
      const age = FamilyStore.calcAge(p);
      if (age != null && age >= 0) { lifespanSum += age; lifespanCount++; }
    });
    const avgLifespan = lifespanCount ? Math.round(lifespanSum / lifespanCount) : null;

    // Gender ratio.
    let male = 0, female = 0, other = 0;
    people.forEach((p) => {
      if (p.gender === "m") male++;
      else if (p.gender === "f") female++;
      else if (p.gender === "o") other++;
    });

    // Living vs deceased.
    let living = 0, deceased = 0;
    people.forEach((p) => { if (FamilyStore.isDeceased(p)) deceased++; else living++; });

    // Born-by-decade histogram.
    const decadeMap = new Map();
    people.forEach((p) => {
      const y = FamilyStore.getYear(p.birthDate);
      if (y == null) return;
      const decade = Math.floor(y / 10) * 10;
      decadeMap.set(decade, (decadeMap.get(decade) || 0) + 1);
    });
    const decades = [];
    if (decadeMap.size) {
      const keys = Array.from(decadeMap.keys()).sort((a, b) => a - b);
      // Fill gaps so the histogram reads as a continuous timeline, not a
      // gap-collapsed bar set (a missing decade is meaningful — show it as 0).
      for (let d = keys[0]; d <= keys[keys.length - 1]; d += 10) {
        decades.push({ decade: d, count: decadeMap.get(d) || 0 });
      }
    }

    // Name trends: most common first names (case-insensitive), display-language
    // aware via getField so Hindi mode groups Hindi names.
    const nameMap = new Map();
    people.forEach((p) => {
      const full = FamilyStore.getField(p, "name") || p.name || "";
      const first = String(full).trim().split(/\s+/)[0];
      if (!first) return;
      const key = first.toLocaleLowerCase();
      const rec = nameMap.get(key) || { name: first, count: 0 };
      rec.count++;
      nameMap.set(key, rec);
    });
    const topNames = Array.from(nameMap.values())
      .filter((r) => r.count > 1)          // a name shared by ≥2 people is a "trend"
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 6);

    // Roots: distinct birthplaces + the most common ones. Grouped case-
    // insensitively but display-language aware (getField), so Hindi mode
    // groups Hindi place names. Trimmed so "Delhi " and "Delhi" are one root.
    const placeMap = new Map();
    let placedCount = 0;
    people.forEach((p) => {
      const raw = FamilyStore.getField(p, "birthPlace") || p.birthPlace || "";
      const place = String(raw).trim();
      if (!place) return;
      placedCount++;
      const key = place.toLocaleLowerCase();
      const rec = placeMap.get(key) || { place: place, count: 0 };
      rec.count++;
      placeMap.set(key, rec);
    });
    const distinctPlaces = placeMap.size;
    const topPlaces = Array.from(placeMap.values())
      .sort((a, b) => b.count - a.count || a.place.localeCompare(b.place))
      .slice(0, 6);

    // Eldest & youngest living members by current age. calcAge falls back to
    // today for people with no death date, so this reads current age. Needs a
    // parseable birth date; the undated are simply not candidates.
    let eldest = null, youngest = null;
    people.forEach((p) => {
      if (!FamilyStore.isAlive(p)) return;
      const age = FamilyStore.calcAge(p);
      if (age == null || age < 0) return;
      const name = FamilyStore.getField(p, "name") || p.name || "";
      const cand = { id: p.id, name: name, age: age };
      if (!eldest || age > eldest.age) eldest = cand;
      if (!youngest || age < youngest.age) youngest = cand;
    });

    return { total, totalAll: all.length, filtered, generations, avgLifespan, lifespanCount, male, female, other, living, deceased, decades, topNames, distinctPlaces, placedCount, topPlaces, eldest, youngest };
  }

  // ===== Render helpers =====
  function statCard(icon, value, label, opts) {
    return el("div", { class: "insight-card" + (opts && opts.wide ? " insight-card--wide" : "") }, [
      el("div", { class: "insight-card__figure" }, [
        el("i", { class: icon + " insight-card__icon", "aria-hidden": "true" }),
        el("div", { class: "insight-card__value" }, String(value))
      ]),
      el("div", { class: "insight-card__label" }, label)
    ]);
  }

  function genderBar(s) {
    const totalGendered = s.male + s.female + s.other;
    const seg = (n, cls, labelKey) => {
      if (!n) return null;
      const pct = Math.round((n / totalGendered) * 100);
      return el("div", {
        class: "insight-gender__seg insight-gender__seg--" + cls,
        style: { width: pct + "%" },
        title: I18n.t(labelKey) + ": " + n
      });
    };
    const legendItem = (n, cls, labelKey) => el("span", { class: "insight-gender__legend-item" }, [
      el("span", { class: "insight-gender__dot insight-gender__seg--" + cls }),
      el("span", null, I18n.t(labelKey) + " · " + n)
    ]);
    return el("div", { class: "insight-panel" }, [
      el("h3", { class: "insight-panel__title" }, I18n.t("insights.genderTitle")),
      totalGendered === 0
        ? el("p", { class: "insight-empty" }, I18n.t("insights.genderNone"))
        : el("div", null, [
            el("div", { class: "insight-gender__bar" }, [
              seg(s.male, "m", "form.genderM"),
              seg(s.female, "f", "form.genderF"),
              seg(s.other, "o", "form.genderO")
            ]),
            el("div", { class: "insight-gender__legend" }, [
              s.male ? legendItem(s.male, "m", "form.genderM") : null,
              s.female ? legendItem(s.female, "f", "form.genderF") : null,
              s.other ? legendItem(s.other, "o", "form.genderO") : null
            ])
          ])
    ]);
  }

  function decadeChart(s) {
    const max = s.decades.reduce((m, d) => Math.max(m, d.count), 0);
    return el("div", { class: "insight-panel" }, [
      el("h3", { class: "insight-panel__title" }, I18n.t("insights.decadeTitle")),
      s.decades.length === 0
        ? el("p", { class: "insight-empty" }, I18n.t("insights.decadeNone"))
        : el("div", { class: "insight-decades" }, s.decades.map((d) => {
            const h = max ? Math.round((d.count / max) * 100) : 0;
            return el("div", { class: "insight-decades__col", title: d.decade + "s · " + d.count }, [
              el("div", { class: "insight-decades__bar-wrap" }, [
                el("div", {
                  class: "insight-decades__bar",
                  style: { height: Math.max(h, d.count ? 6 : 0) + "%" }
                }, d.count ? el("span", { class: "insight-decades__count" }, String(d.count)) : null)
              ]),
              el("div", { class: "insight-decades__label" }, "'" + String(d.decade).slice(2))
            ]);
          }))
    ]);
  }

  function namesPanel(s) {
    return el("div", { class: "insight-panel" }, [
      el("h3", { class: "insight-panel__title" }, I18n.t("insights.namesTitle")),
      s.topNames.length === 0
        ? el("p", { class: "insight-empty" }, I18n.t("insights.namesNone"))
        : el("div", { class: "insight-names" }, s.topNames.map((r) =>
            el("span", { class: "insight-name-chip" }, [
              el("span", { class: "insight-name-chip__name" }, r.name),
              el("span", { class: "insight-name-chip__count" }, "×" + r.count)
            ])
          ))
    ]);
  }

  function rootsPanel(s) {
    return el("div", { class: "insight-panel" }, [
      el("h3", { class: "insight-panel__title" }, I18n.t("insights.rootsTitle")),
      s.topPlaces.length === 0
        ? el("p", { class: "insight-empty" }, I18n.t("insights.rootsNone"))
        : el("div", null, [
            // A quiet lead line naming the spread, then the places themselves.
            el("p", { class: "insight-panel__lead" },
              I18n.t(s.distinctPlaces === 1 ? "insights.rootsOne" : "insights.rootsCount",
                { n: s.distinctPlaces, people: s.placedCount })),
            el("div", { class: "insight-names" }, s.topPlaces.map((r) =>
              el("span", { class: "insight-name-chip" }, [
                el("i", { class: "fa-solid fa-location-dot insight-name-chip__pin", "aria-hidden": "true" }),
                el("span", { class: "insight-name-chip__name" }, r.place),
                r.count > 1 ? el("span", { class: "insight-name-chip__count" }, "×" + r.count) : null
              ])
            ))
          ])
    ]);
  }

  function eldersPanel(s) {
    const line = (labelKey, rec) => el("div", { class: "insight-elders__row" }, [
      el("span", { class: "insight-elders__label" }, I18n.t(labelKey)),
      el("span", { class: "insight-elders__name" }, rec.name),
      el("span", { class: "insight-elders__age" }, I18n.t("insights.years", { n: rec.age }))
    ]);
    // Only meaningful when there are ≥2 distinct living members; with a single
    // living person eldest === youngest and the pairing reads as a bug.
    const distinct = s.eldest && s.youngest && s.eldest.id !== s.youngest.id;
    return el("div", { class: "insight-panel" }, [
      el("h3", { class: "insight-panel__title" }, I18n.t("insights.eldersTitle")),
      !s.eldest
        ? el("p", { class: "insight-empty" }, I18n.t("insights.eldersNone"))
        : el("div", { class: "insight-elders" }, distinct
            ? [line("insights.eldest", s.eldest), line("insights.youngest", s.youngest)]
            : [line("insights.eldest", s.eldest)])
    ]);
  }

  // "Coming up" — the year's birthdays and memorials, plus the two ways to keep
  // them: a calendar (.ics) export that works everywhere and an opt-in same-day
  // reminder. Deliberately whole-family (never filtered): a reminder you'd want
  // shouldn't disappear because a facet is active. Absent if the Anniversaries
  // feature module didn't load (e.g. a minimal build).
  const COMING_UP_MAX = 6;
  // Sticky across re-renders (store change, language switch) so an expanded list
  // doesn't silently snap shut when the panel repaints.
  let comingUpExpanded = false;
  function comingUpPanel() {
    if (!global.Anniversaries) return null;
    const evs = Anniversaries.events();
    const head = el("h3", { class: "insight-panel__title" }, I18n.t("insights.comingUpTitle"));

    if (!evs.length) {
      return el("div", { class: "insight-panel" }, [
        head,
        el("p", { class: "insight-empty" }, I18n.t("insights.comingUpNone"))
      ]);
    }

    // Each row opens its person: reveal on the tree canvas AND open the profile,
    // the same seam Timeline/People use. A row is a real button for keyboard +
    // screen-reader access; falls back to a bare Inspector open if the reveal
    // seam throws.
    const openPerson = (person) => {
      if (!person || !person.id) return;
      try {
        window.dispatchEvent(new CustomEvent("virasat:reveal-in-tree", { detail: { id: person.id } }));
        return;
      } catch (_) {}
      if (window.Inspector && Inspector.show) Inspector.show(person.id);
    };
    const rowFor = (ev) => {
      const meta = Anniversaries.eventMeta(ev);
      const row = el("button", {
        class: "coming-up__row",
        type: "button",
        title: I18n.t("insights.comingUpOpen", { name: Anniversaries.eventTitle(ev) })
      }, [
        el("i", {
          class: (ev.kind === "death" ? "fa-solid fa-feather" : "fa-solid fa-cake-candles")
            + " coming-up__icon coming-up__icon--" + ev.kind,
          "aria-hidden": "true"
        }),
        el("div", { class: "coming-up__body" }, [
          el("div", { class: "coming-up__title" }, Anniversaries.eventTitle(ev)),
          el("div", { class: "coming-up__meta" },
            Anniversaries.dateLabel(ev.date) + (meta ? " · " + meta : ""))
        ]),
        el("span", { class: "coming-up__when" }, Anniversaries.relLabel(ev.daysAway))
      ]);
      row.addEventListener("click", () => openPerson(ev.person));
      return row;
    };

    const hiddenCount = Math.max(0, evs.length - COMING_UP_MAX);
    const shown = (comingUpExpanded || !hiddenCount) ? evs : evs.slice(0, COMING_UP_MAX);
    const rows = shown.map(rowFor);

    // "+N more" is a real toggle: expands the full year ahead in place, collapses
    // back to the first COMING_UP_MAX. aria-expanded tracks the state.
    if (hiddenCount) {
      const moreBtn = el("button", {
        class: "coming-up__more",
        type: "button",
        "aria-expanded": comingUpExpanded ? "true" : "false"
      }, comingUpExpanded
        ? I18n.t("insights.comingUpLess")
        : I18n.t("insights.comingUpMore", { n: hiddenCount }));
      moreBtn.addEventListener("click", () => { comingUpExpanded = !comingUpExpanded; render(); });
      rows.push(moreBtn);
    }

    // Calendar export — always shown; needs no permission.
    const icsBtn = el("button", { class: "btn btn--sm coming-up__action", type: "button" }, [
      el("i", { class: "fa-regular fa-calendar-plus", "aria-hidden": "true" }),
      el("span", null, I18n.t("anniv.addToCalendar"))
    ]);
    icsBtn.addEventListener("click", () => Anniversaries.exportIcs());

    const actions = [icsBtn];

    // Reminder opt-in — only where notifications exist at all. A pressed pill
    // reflects the saved opt-in; clicking requests permission + (re)schedules.
    if ("Notification" in global) {
      const on = Anniversaries.remindersEnabled();
      const remindBtn = el("button", {
        class: "btn btn--sm coming-up__action coming-up__remind" + (on ? " is-on" : ""),
        type: "button",
        "aria-pressed": on ? "true" : "false"
      }, [
        el("i", { class: (on ? "fa-solid fa-bell" : "fa-regular fa-bell"), "aria-hidden": "true" }),
        el("span", null, I18n.t("anniv.remindMe"))
      ]);
      remindBtn.addEventListener("click", async () => {
        remindBtn.disabled = true;
        try { await Anniversaries.setReminders(!Anniversaries.remindersEnabled()); }
        finally { remindBtn.disabled = false; render(); }
      });
      actions.push(remindBtn);
    }

    return el("div", { class: "insight-panel insight-panel--wide" }, [
      head,
      el("div", { class: "coming-up__list" }, rows),
      el("div", { class: "coming-up__actions" }, actions),
      el("p", { class: "coming-up__hint" }, I18n.t("anniv.remindHint"))
    ]);
  }

  function render() {
    if (!root) return;
    if (titleAccentEl) titleAccentEl.textContent = familyAccent();
    const body = document.getElementById("insights-body");
    if (!body) return;
    clear(body);

    const s = computeStats();

    if (s.total === 0) {
      // Distinguish "no people at all" from "a filter is hiding everyone" —
      // otherwise an active filter that matches nobody looks like an empty tree.
      body.appendChild(s.filtered && s.totalAll > 0
        ? UI.emptyState({
            icon: "fa-solid fa-filter-circle-xmark",
            title: I18n.t("insights.filterEmptyTitle"),
            text: I18n.t("insights.filterEmptyText")
          })
        : UI.emptyState({
            icon: "fa-solid fa-chart-simple",
            title: I18n.t("insights.emptyTitle"),
            text: I18n.t("insights.emptyText")
          }));
      return;
    }

    // When a filter is narrowing the set, say so up top — the numbers below are
    // deliberately partial, and this note is the only cue that they aren't the
    // whole tree.
    if (s.filtered) {
      body.appendChild(el("div", { class: "insight-filter-note" }, [
        el("i", { class: "fa-solid fa-filter", "aria-hidden": "true" }),
        el("span", null, I18n.t("insights.filteredNote", { n: s.total, total: s.totalAll }))
      ]));
    }

    // Headline stat cards.
    const cards = el("div", { class: "insight-cards" }, [
      statCard("fa-solid fa-users", s.total, I18n.t("insights.people")),
      statCard("fa-solid fa-layer-group", s.generations, I18n.t("insights.generations")),
      statCard("fa-solid fa-hourglass-half",
        s.avgLifespan != null ? I18n.t("insights.years", { n: s.avgLifespan }) : "—",
        s.avgLifespan != null
          ? I18n.t("insights.avgLifespanFrom", { n: s.lifespanCount })
          : I18n.t("insights.avgLifespan")),
      statCard("fa-solid fa-seedling", s.living, I18n.t("insights.living")),
      statCard("fa-solid fa-feather", s.deceased, I18n.t("insights.remembered"))
    ]);
    body.appendChild(cards);

    // Panels: gender ratio, born-by-decade, name trends, roots, elders, and the
    // whole-family "coming up" (last; it spans wide and carries its own actions).
    body.appendChild(el("div", { class: "insight-panels" }, [
      genderBar(s),
      decadeChart(s),
      namesPanel(s),
      rootsPanel(s),
      eldersPanel(s),
      comingUpPanel()
    ]));
  }

  // Called by the shared Filter (window.Filter) whenever any facet changes.
  // Insights recomputes every stat from scratch, so a full repaint IS the
  // filter response — same idiom as PeopleView.setFilter.
  function setFilter() { render(); }

  global.InsightsView = { mount, render, setFilter };
})(window);
