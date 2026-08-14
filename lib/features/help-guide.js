// @ts-check
/**
 * HelpGuide — a "how this app works" modal. One scrollable sheet that lists
 * every feature grouped by what the user is trying to do (get around, build
 * the tree, find people, share/keep safe, account), each with a one-line
 * how-to. Content is data-driven off SECTIONS below; every string routes
 * through I18n so the guide is fully bilingual. The account section only
 * appears in a live cloud session (signed in), so a single-device user isn't
 * shown features they don't have.
 *
 * Public:
 *   HelpGuide.open()  — opens the guide modal.
 */
(function (global) {
  "use strict";

  // [sectionKey, items[]] — each item is [faIcon, termKey, howToKey]. Keys
  // resolve under the `help.` i18n namespace. `cloudOnly` sections are dropped
  // outside a signed-in cloud session.
  const SECTIONS = [
    {
      key: "secViews", icon: "fa-solid fa-compass",
      items: [
        ["fa-solid fa-sitemap", "tree", "treeHow"],
        ["fa-solid fa-user-group", "people", "peopleHow"],
        ["fa-solid fa-stream", "timeline", "timelineHow"],
        ["fa-solid fa-chart-simple", "insights", "insightsHow"]
      ]
    },
    {
      key: "secBuild", icon: "fa-solid fa-user-plus",
      items: [
        ["fa-solid fa-user-plus", "add", "addHow"],
        ["fa-regular fa-pen-to-square", "manage", "manageHow"],
        ["fa-solid fa-image", "photos", "photosHow"],
        ["fa-solid fa-book-open", "stories", "storiesHow"]
      ]
    },
    {
      key: "secFind", icon: "fa-solid fa-magnifying-glass",
      items: [
        ["fa-solid fa-magnifying-glass", "search", "searchHow"],
        ["fa-solid fa-sliders", "filter", "filterHow"],
        ["fa-solid fa-route", "relation", "relationHow"]
      ]
    },
    {
      key: "secShare", icon: "fa-solid fa-share-nodes",
      items: [
        ["fa-solid fa-print", "print", "printHow"],
        ["fa-solid fa-file-export", "backup", "backupHow"],
        ["fa-solid fa-clipboard", "collect", "collectHow"]
      ]
    },
    {
      key: "secAccount", icon: "fa-solid fa-cloud", cloudOnly: true,
      items: [
        ["fa-solid fa-folder-tree", "trees", "treesHow"],
        ["fa-solid fa-user-group", "invite", "inviteHow"],
        ["fa-solid fa-rotate", "sync", "syncHow"]
      ]
    },
    {
      key: "secTips", icon: "fa-solid fa-lightbulb",
      items: [
        ["fa-solid fa-language", "language", "languageHow"],
        ["fa-solid fa-circle-half-stroke", "theme", "themeHow"],
        ["fa-solid fa-wifi", "offline", "offlineHow"]
      ]
    }
  ];

  function inCloudSession() {
    return !!(global.Auth && Auth.isCloud && Auth.isCloud() && Auth.getUser && Auth.getUser());
  }

  function open() {
    if (!global.UI || !UI.openModal) return;
    const t = (k, p) => I18n.t("help." + k, p);
    const showCloud = inCloudSession();

    const body = UI.el("div", { class: "help-guide" });
    body.appendChild(UI.el("p", { class: "help-guide__intro" }, t("intro")));

    SECTIONS.forEach((sec) => {
      if (sec.cloudOnly && !showCloud) return;
      const section = UI.el("section", { class: "help-guide__section" });
      section.appendChild(UI.el("h3", { class: "help-guide__heading" }, [
        UI.el("i", { class: sec.icon + " help-guide__heading-icon", "aria-hidden": "true" }),
        UI.el("span", null, t(sec.key))
      ]));
      const list = UI.el("ul", { class: "help-guide__list" });
      sec.items.forEach(([icon, termKey, howKey]) => {
        list.appendChild(UI.el("li", { class: "help-guide__item" }, [
          UI.el("i", { class: icon + " help-guide__item-icon", "aria-hidden": "true" }),
          UI.el("div", { class: "help-guide__item-text" }, [
            UI.el("span", { class: "help-guide__term" }, t(termKey)),
            UI.el("span", { class: "help-guide__how" }, t(howKey))
          ])
        ]));
      });
      section.appendChild(list);
      body.appendChild(section);
    });

    const closeBtn = UI.el("button", {
      class: "btn btn--primary", type: "button",
      onclick: () => { if (handle) handle.close(); }
    }, [UI.el("span", null, t("close"))]);

    const handle = UI.openModal({
      title: t("title"),
      body: body,
      footer: [closeBtn],
      onEnter: () => { if (handle) handle.close(); }
    });
  }

  global.HelpGuide = { open };
})(window);
