/**
 * PathFinder — modal that asks for two people and shows the shortest
 * relationship chain between them. Backed by FamilyStore.findRelationPath
 * (BFS over parent / child / spouse edges). Each hop is rendered as an
 * avatar + a small "father / wife / daughter" relation chip.
 *
 * Public:
 *   PathFinder.open(initialFromId?, initialToId?)
 */
(function (global) {
  "use strict";

  function open(initialFromId, initialToId) {
    if (!window.FamilyStore || !window.UI) return;
    const ppl = FamilyStore.getPeople().slice().sort((a, b) => {
      const an = FamilyStore.getField(a, "name") || a.name;
      const bn = FamilyStore.getField(b, "name") || b.name;
      return an.localeCompare(bn);
    });
    if (ppl.length < 2) {
      UI.toast("Add at least two people to find a relation.", "danger");
      return;
    }

    const state = {
      from: initialFromId || ppl[0].id,
      to: initialToId || ppl[Math.min(ppl.length - 1, 1)].id
    };

    const fromSelect = makePersonSelect(ppl, state.from, (v) => { state.from = v; refresh(); });
    const toSelect = makePersonSelect(ppl, state.to, (v) => { state.to = v; refresh(); });
    const swapBtn = UI.el("button", {
      class: "btn btn--icon btn--ghost", type: "button",
      title: "Swap", "aria-label": "Swap people",
      onclick: () => {
        const t = state.from; state.from = state.to; state.to = t;
        fromSelect.setValue(state.from);
        toSelect.setValue(state.to);
        refresh();
      }
    }, [UI.el("i", { class: "fa-solid fa-right-left", "aria-hidden": "true" })]);

    const result = UI.el("div", { class: "path-finder__result" });

    function refresh() {
      while (result.firstChild) result.removeChild(result.firstChild);
      if (state.from === state.to) {
        result.appendChild(UI.el("p", { class: "path-finder__empty" }, "Same person — pick someone different."));
        return;
      }
      const path = FamilyStore.findRelationPath(state.from, state.to);
      if (!path || path.length < 2) {
        result.appendChild(UI.el("p", { class: "path-finder__empty" },
          "No relation found through the family graph. They might be from separate branches that haven't been linked yet."));
        return;
      }
      // Header — N hops
      const hops = path.length - 1;
      result.appendChild(UI.el("div", { class: "path-finder__count" },
        hops === 1 ? "1 step" : hops + " steps"));

      const chain = UI.el("ol", { class: "path-finder__chain" });
      for (let i = 0; i < path.length; i++) {
        const personId = path[i];
        const person = FamilyStore.getPerson(personId);
        if (!person) continue;
        const li = UI.el("li", { class: "path-finder__hop" });
        const card = UI.el("button", {
          class: "path-finder__person", type: "button",
          "aria-label": "Open " + ((FamilyStore.getField(person, "name") || person.name)) + "'s profile",
          onclick: () => {
            if (window.Inspector) Inspector.show(personId);
          }
        }, [
          UI.avatar(person, "sm"),
          UI.el("span", { class: "path-finder__person-name" },
            FamilyStore.getField(person, "name") || person.name)
        ]);
        li.appendChild(card);
        chain.appendChild(li);

        if (i < path.length - 1) {
          const label = FamilyStore.relationLabel(path[i], path[i + 1]);
          const arrow = UI.el("li", { class: "path-finder__arrow" }, [
            UI.el("i", { class: "fa-solid fa-arrow-down-long", "aria-hidden": "true" }),
            UI.el("span", null, label)
          ]);
          chain.appendChild(arrow);
        }
      }
      result.appendChild(chain);
    }

    const body = UI.el("div", { class: "path-finder" }, [
      UI.el("p", { class: "path-finder__hint" },
        "Pick two relatives — Virasat will trace the shortest chain between them through parents, children, and spouses."),
      UI.el("div", { class: "path-finder__inputs" }, [
        UI.field("From", fromSelect.node),
        swapBtn,
        UI.field("To", toSelect.node)
      ]),
      result
    ]);

    const closeBtn = UI.el("button", { class: "btn", type: "button" }, [
      UI.el("i", { class: "fa-solid fa-xmark", "aria-hidden": "true" }),
      UI.el("span", null, "Close")
    ]);
    const dlg = UI.openModal({ title: "Find a relation", body, footer: [closeBtn] });
    closeBtn.addEventListener("click", () => dlg.close());

    refresh();
  }

  // Heritage-styled person picker — uses HeritageSelect when available so
  // dropdown styling matches the rest of the form. HeritageSelect returns
  // { el, getValue, setValue, ... } (not `.node`), so we adapt the shape
  // to match the fallback.
  function makePersonSelect(people, value, onChange) {
    const opts = people.map((p) => {
      const label = (FamilyStore.getField(p, "name") || p.name)
        + (p.birthDate ? "  · " + (FamilyStore.getYear(p.birthDate) || "") : "");
      return { value: p.id, label };
    });
    if (window.HeritageSelect && HeritageSelect.create) {
      const sel = HeritageSelect.create({ options: opts, value, onChange });
      return { node: sel.el, setValue: sel.setValue, getValue: sel.getValue };
    }
    // Fallback — plain native select. Used only when HeritageSelect hasn't
    // loaded (defensive); shouldn't happen in production.
    const sel = document.createElement("select");
    sel.className = "input";
    opts.forEach((o) => {
      const opt = document.createElement("option");
      opt.value = o.value; opt.textContent = o.label;
      sel.appendChild(opt);
    });
    sel.value = value;
    sel.addEventListener("change", () => onChange(sel.value));
    return { node: sel, setValue: (v) => { sel.value = v; }, getValue: () => sel.value };
  }

  global.PathFinder = { open };
})(window);
