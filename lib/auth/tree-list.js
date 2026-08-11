// @ts-check
/**
 * Tree list — the multi-tree switcher.
 *
 * A user can own, or be shared into, several family trees. This module renders
 * the "Your trees" modal: every tree with its role + an active marker, tap a
 * row to switch, plus create / rename / delete for trees the user may change.
 *
 * All the network + the careful store-repointing lives in CloudStore; this
 * file is purely the UI over CloudStore.listTrees / createTree / switchTree /
 * renameTree / deleteTree. Built on the shared UI.* modal helpers so it stacks
 * and traps focus like every other dialog.
 *
 * Inert when cloud is off — TreeList.open() then just toasts that trees need
 * sign-in (app.js only surfaces the entry point in cloud mode anyway).
 */
(function (global) {
  "use strict";

  function t(key, vars) {
    return global.I18n ? global.I18n.t(key, vars) : key;
  }
  function cloud() { return global.CloudStore; }
  function active() {
    const c = cloud();
    return !!(c && typeof c.isActive === "function" && c.isActive());
  }

  const ROLE_KEY = { owner: "tree.roleOwner", editor: "tree.roleEditor", viewer: "tree.roleViewer" };

  // A small single-field text modal, reused by create + rename. Resolves to the
  // trimmed value, or null if the user cancels. Stacks over the list modal.
  /**
   * @param {object} opts
   * @param {string} [opts.title]
   * @param {string} [opts.label]
   * @param {string} [opts.value]
   * @param {string} [opts.placeholder]
   * @param {string} [opts.confirmLabel]
   */
  function textPrompt({ title, label, value, placeholder, confirmLabel }) {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (v) => { if (!settled) { settled = true; resolve(v); } };

      const input = global.UI.el("input", {
        type: "text",
        class: "input",
        value: value || "",
        placeholder: placeholder || "",
        maxlength: "80"
      });
      const cancel = global.UI.cancelBtn();
      const save = global.UI.saveBtn(confirmLabel || t("actions.save"), { icon: "fa-solid fa-check" });

      const dlg = global.UI.openModal({
        title: title || "",
        body: global.UI.field(label || "", input),
        footer: [cancel, save],
        onClose: () => settle(null)
      });
      const submit = () => {
        const v = String(input.value || "").trim();
        if (!v) { input.focus(); return; }
        settle(v);
        dlg.close();
      };
      cancel.addEventListener("click", () => { settle(null); dlg.close(); });
      save.addEventListener("click", submit);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
    });
  }

  // Build one tree row: avatar-less, name + role pill, active marker, and
  // owner/editor-only rename/delete actions. Clicking the row body switches.
  function treeRow(tree, ctx) {
    const rolePill = global.UI.el("span", {
      class: "tree-row__role" + (tree.active ? " tree-row__role--active" : "")
    }, tree.active ? t("tree.active") : t(ROLE_KEY[tree.role] || "tree.roleViewer"));

    const name = global.UI.el("span", { class: "tree-row__name" }, tree.title);
    const main = global.UI.el("button", {
      type: "button",
      class: "tree-row__main" + (tree.active ? " is-active" : ""),
      title: tree.active ? t("tree.active") : t("tree.switchTo", { name: tree.title })
    }, [
      global.UI.el("i", { class: "fa-solid " + (tree.active ? "fa-circle-check" : "fa-sitemap") + " tree-row__icon", "aria-hidden": "true" }),
      global.UI.el("span", { class: "tree-row__label" }, [name, rolePill])
    ]);
    if (!tree.active) {
      main.addEventListener("click", () => ctx.switchTo(tree));
    }

    const actions = [];
    // Rename: owner or editor may change the tree's name.
    if (tree.role === "owner" || tree.role === "editor") {
      const rn = global.UI.el("button", {
        type: "button", class: "tree-row__action", "aria-label": t("tree.rename"), title: t("tree.rename")
      }, [global.UI.el("i", { class: "fa-solid fa-pen", "aria-hidden": "true" })]);
      rn.addEventListener("click", (e) => { e.stopPropagation(); ctx.rename(tree); });
      actions.push(rn);
    }
    // Share: owners manage members. Only shown if Sharing is present.
    if (tree.role === "owner" && global.Sharing && typeof global.Sharing.open === "function") {
      const sh = global.UI.el("button", {
        type: "button", class: "tree-row__action", "aria-label": t("share.title"), title: t("share.title")
      }, [global.UI.el("i", { class: "fa-solid fa-user-plus", "aria-hidden": "true" })]);
      sh.addEventListener("click", (e) => { e.stopPropagation(); global.Sharing.open(tree.id, tree.title); });
      actions.push(sh);
    }
    // Delete: owner only.
    if (tree.owned) {
      const del = global.UI.el("button", {
        type: "button", class: "tree-row__action tree-row__action--danger", "aria-label": t("tree.delete"), title: t("tree.delete")
      }, [global.UI.el("i", { class: "fa-solid fa-trash-can", "aria-hidden": "true" })]);
      del.addEventListener("click", (e) => { e.stopPropagation(); ctx.remove(tree); });
      actions.push(del);
    }

    return global.UI.el("div", { class: "tree-row" + (tree.active ? " tree-row--active" : "") }, [
      main,
      actions.length ? global.UI.el("div", { class: "tree-row__actions" }, actions) : null
    ]);
  }

  function open() {
    if (!active()) {
      if (global.UI && global.UI.toast) global.UI.toast(t("tree.needSignIn"), "warning");
      return;
    }

    const list = global.UI.el("div", { class: "tree-list" }, [
      global.UI.el("div", { class: "tree-list__loading" }, t("tree.loading"))
    ]);
    const createBtn = global.UI.el("button", { class: "btn btn--primary", type: "button" }, [
      global.UI.el("i", { class: "fa-solid fa-plus", "aria-hidden": "true" }),
      global.UI.el("span", null, t("tree.create"))
    ]);

    const dlg = global.UI.openModal({
      title: t("tree.yourTrees"),
      body: global.UI.el("div", null, [list]),
      footer: [createBtn]
    });

    const ctx = {
      switchTo: async (tree) => {
        dlg.close();
        try {
          await cloud().switchTree(tree.id);
          if (global.Inspector && global.Inspector.clear) global.Inspector.clear();
          if (global.UI.toast) global.UI.toast(t("tree.switched", { name: tree.title }), "success");
        } catch (e) {
          if (global.UI.toast) global.UI.toast(t("tree.switchError"), "danger");
          console.error("tree switch failed:", e);
        }
      },
      rename: async (tree) => {
        const name = await textPrompt({
          title: t("tree.renameTitle"),
          label: t("tree.nameLabel"),
          value: tree.title,
          confirmLabel: t("tree.rename")
        });
        if (!name || name === tree.title) return;
        try {
          // First word becomes the short family name (matches tree-view's rule).
          const family = name.split(/\s+/)[0] || tree.familyName;
          await cloud().renameTree(tree.id, name, family);
          if (global.UI.toast) global.UI.toast(t("tree.renamed"), "success");
          refresh();
        } catch (e) {
          if (global.UI.toast) global.UI.toast(t("tree.renameError"), "danger");
          console.error("tree rename failed:", e);
        }
      },
      remove: async (tree) => {
        const ok = await global.UI.confirm({
          title: t("tree.delete"),
          message: t("tree.deleteConfirm", { name: tree.title }),
          confirmLabel: t("tree.delete"),
          danger: true
        });
        if (!ok) return;
        try {
          const wasActive = tree.active;
          const res = await cloud().deleteTree(tree.id);
          if (wasActive && global.Inspector && global.Inspector.clear) global.Inspector.clear();
          if (global.UI.toast) global.UI.toast(t("tree.deleted"), "success");
          // Deleting the last tree returns us to the first-run state (no active
          // tree). Close the switcher and show the "create your first tree"
          // screen instead of leaving an empty, treeless app behind.
          if (res && res.emptied && global.FirstRun && typeof global.FirstRun.show === "function") {
            dlg.close();
            global.FirstRun.show().then(() => {
              if (global.location && global.location.reload) global.location.reload();
            });
            return;
          }
          refresh();
        } catch (e) {
          if (global.UI.toast) global.UI.toast(t("tree.deleteError"), "danger");
          console.error("tree delete failed:", e);
        }
      }
    };

    async function refresh() {
      try {
        const trees = await cloud().listTrees();
        global.UI.clear(list);
        if (!trees.length) {
          list.appendChild(global.UI.el("div", { class: "tree-list__empty" }, t("tree.empty")));
          return;
        }
        trees.forEach((tree) => list.appendChild(treeRow(tree, ctx)));
      } catch (e) {
        global.UI.clear(list);
        list.appendChild(global.UI.el("div", { class: "tree-list__empty" }, t("tree.loadError")));
        console.error("listTrees failed:", e);
      }
    }

    createBtn.addEventListener("click", async () => {
      const name = await textPrompt({
        title: t("tree.createTitle"),
        label: t("tree.nameLabel"),
        placeholder: t("tree.namePlaceholder"),
        confirmLabel: t("tree.create")
      });
      if (!name) return;
      dlg.close();
      try {
        const family = name.split(/\s+/)[0] || "Family";
        await cloud().createTree(name, family);
        if (global.Inspector && global.Inspector.clear) global.Inspector.clear();
        if (global.UI.toast) global.UI.toast(t("tree.created"), "success");
      } catch (e) {
        if (global.UI.toast) global.UI.toast(t("tree.createError"), "danger");
        console.error("tree create failed:", e);
      }
    });

    refresh();
  }

  global.TreeList = { open };
})(window);
