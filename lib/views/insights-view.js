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
    const people = (FamilyStore.getPeople() || []).filter(isPerson);
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

    return { total, generations, avgLifespan, lifespanCount, male, female, other, living, deceased, decades, topNames };
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

  function render() {
    if (!root) return;
    if (titleAccentEl) titleAccentEl.textContent = familyAccent();
    const body = document.getElementById("insights-body");
    if (!body) return;
    clear(body);

    const s = computeStats();

    if (s.total === 0) {
      body.appendChild(UI.emptyState({
        icon: "fa-solid fa-chart-simple",
        title: I18n.t("insights.emptyTitle"),
        text: I18n.t("insights.emptyText")
      }));
      return;
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

    // Panels: gender ratio, born-by-decade, name trends.
    body.appendChild(el("div", { class: "insight-panels" }, [
      genderBar(s),
      decadeChart(s),
      namesPanel(s)
    ]));
  }

  global.InsightsView = { mount, render };
})(window);
