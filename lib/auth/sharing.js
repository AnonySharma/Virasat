// @ts-check
/**
 * Sharing — invite family by email + manage who has access.
 *
 * Model (see docs/CLOUD-SYNC-PLAN.md SQL):
 *   • tree_invites is the owner-readable directory of NON-owner access: one row
 *     per invited email, with role + claimed_at (null = invited, not signed in
 *     yet). Every non-owner member arrives through an invite (the on_tree_created
 *     trigger only adds the owner; claim_invites only acts on invite rows), so
 *     this table is a complete, email-labelled member list — which the client
 *     needs because it can't read auth.users.
 *   • Two SECURITY DEFINER, owner-checked RPCs do the writes atomically:
 *       invite_to_tree(tree, email, role)  — upsert invite; if the email already
 *                                            has an account + membership, re-role
 *                                            it live (also serves role changes).
 *       revoke_access(tree, email)         — delete invite + membership row.
 *     Both look the user up by email server-side, so no user_id ever crosses
 *     the wire and RLS + the owner check are the enforcement boundary.
 *
 * This file is only ever opened for a tree the caller owns (tree-list gates the
 * entry point on role === "owner"); it still re-checks defensively.
 */
(function (global) {
  "use strict";

  function t(key, vars) { return global.I18n ? global.I18n.t(key, vars) : key; }
  function db() {
    const a = global.Auth;
    return a && a.client && a.client();
  }
  function myEmail() {
    const a = global.Auth;
    const u = a && a.getUser && a.getUser();
    return (u && u.email) || "";
  }
  function emailValid(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim()); }
  // The app's own URL, minus any ?code=/hash — what an invited relative opens
  // to sign in. We don't email it (that's the point of the automatic invite),
  // but owners want to paste it into WhatsApp/SMS themselves.
  function appLink() {
    try { return global.location.origin + global.location.pathname; }
    catch (_) { return ""; }
  }
  function copyLink(text, btn) {
    const ok = () => {
      if (global.UI && global.UI.toast) global.UI.toast(t("share.linkCopied"), "success");
      if (btn) {
        const prev = btn.getAttribute("aria-label");
        btn.classList.add("is-copied");
        setTimeout(() => { btn.classList.remove("is-copied"); if (prev) btn.setAttribute("aria-label", prev); }, 1500);
      }
    };
    const nav = global.navigator;
    if (nav && nav.clipboard && nav.clipboard.writeText) {
      nav.clipboard.writeText(text).then(ok, () => fallbackCopy(text, ok));
    } else {
      fallbackCopy(text, ok);
    }
  }
  function fallbackCopy(text, ok) {
    try {
      const ta = global.document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "absolute"; ta.style.left = "-9999px";
      global.document.body.appendChild(ta);
      ta.select();
      global.document.execCommand("copy");
      global.document.body.removeChild(ta);
      if (ok) ok();
    } catch (_) {
      if (global.UI && global.UI.toast) global.UI.toast(t("share.linkCopyFail"), "warning");
    }
  }

  const ROLE_LABEL = { owner: "share.owner", editor: "share.editor", viewer: "share.viewer" };

  // One member row. The owner is passed with actions:false; invited emails get
  // a role dropdown + a remove/cancel button (label depends on claimed state).
  function memberRow(entry, ctx) {
    const pills = [
      global.UI.el("span", { class: "share-member__role" }, t(ROLE_LABEL[entry.role] || "share.viewer"))
    ];
    if (entry.pending) {
      pills.push(global.UI.el("span", { class: "share-member__pending" }, t("share.pending")));
    }

    const info = global.UI.el("div", { class: "share-member__info" }, [
      global.UI.el("span", { class: "share-member__email" }, entry.email
        + (entry.isSelf ? " (" + t("share.you") + ")" : "")),
      global.UI.el("div", { class: "share-member__pills" }, pills)
    ]);

    const controls = [];
    // Pending invites get a per-row "copy invite link" so the owner can nudge
    // this specific invitee through their own channel (the top-of-dialog link
    // is global; this attaches the same app link to the row you're looking at).
    // The invite itself is automatic on the invitee's sign-in — this is only a
    // delivery aid, so it's offered whenever the owner is managing (actions).
    if (entry.actions && entry.pending) {
      const link = appLink();
      if (link) {
        const copyRowBtn = global.UI.el("button", {
          type: "button",
          class: "btn btn--ghost btn--icon share-member__copy",
          "aria-label": t("share.copyInviteLink"),
          title: t("share.copyInviteLink")
        }, [global.UI.el("i", { class: "fa-solid fa-link", "aria-hidden": "true" })]);
        copyRowBtn.addEventListener("click", () => copyLink(link, copyRowBtn));
        controls.push(copyRowBtn);
      }
    }
    if (entry.actions) {
      // Role switcher — editor / viewer (owner role isn't reassignable here).
      const sel = global.UI.el("select", { class: "input share-member__select", "aria-label": t("share.roleLabel") }, [
        global.UI.el("option", { value: "editor" }, t("share.roleEditor")),
        global.UI.el("option", { value: "viewer" }, t("share.roleViewer"))
      ]);
      sel.value = entry.role === "editor" ? "editor" : "viewer";
      sel.addEventListener("change", () => ctx.changeRole(entry, sel.value));
      controls.push(sel);

      const rm = global.UI.el("button", {
        type: "button",
        class: "btn btn--ghost btn--icon share-member__remove",
        "aria-label": entry.pending ? t("share.cancelInvite") : t("share.remove"),
        title: entry.pending ? t("share.cancelInvite") : t("share.remove")
      }, [global.UI.el("i", { class: "fa-solid fa-user-minus", "aria-hidden": "true" })]);
      rm.addEventListener("click", () => ctx.remove(entry));
      controls.push(rm);
    }

    return global.UI.el("div", { class: "share-member" }, [
      info,
      controls.length ? global.UI.el("div", { class: "share-member__controls" }, controls) : null
    ]);
  }

  function open(treeId, treeTitle) {
    if (!treeId || !db()) {
      if (global.UI && global.UI.toast) global.UI.toast(t("tree.needSignIn"), "warning");
      return;
    }
    // Defensive: only the owner may manage sharing. tree-list already gates on
    // this, but a viewer/editor reaching here gets a read-only notice.
    const c = global.CloudStore;
    const activeOwner = c && c.activeTreeId && c.activeTreeId() === treeId
      && c.isOwner && c.isOwner();

    const emailInput = global.UI.el("input", {
      type: "email", class: "input", placeholder: t("share.emailPlaceholder"),
      autocomplete: "off", autocapitalize: "off", spellcheck: "false"
    });
    // View-only is the safe default — granting edit rights to a whole tree
    // shouldn't be the path of least resistance. Viewer is listed first so it
    // is the pre-selected option.
    const roleSelect = global.UI.el("select", { class: "input" }, [
      global.UI.el("option", { value: "viewer" }, t("share.roleViewer")),
      global.UI.el("option", { value: "editor" }, t("share.roleEditor"))
    ]);
    const sendBtn = global.UI.saveBtn(t("share.invite"), { icon: "fa-solid fa-user-plus" });

    const form = global.UI.el("form", { class: "share-form" }, [
      global.UI.field(t("share.emailLabel"), emailInput),
      global.UI.field(t("share.roleLabel"), roleSelect, t("share.roleHelp")),
      global.UI.el("div", { class: "share-form__actions" }, [sendBtn])
    ]);

    const memberList = global.UI.el("div", { class: "share-members" }, [
      global.UI.el("div", { class: "share-members__loading" }, t("share.membersLoading"))
    ]);

    const bodyChildren = [
      global.UI.el("p", { class: "share__subtitle" }, t("share.subtitle"))
    ];
    if (activeOwner) {
      bodyChildren.push(form);
      // Delivery aid: the app link + a copy button, so the owner can nudge the
      // invitee through their own channel ("here's the link — sign in with the
      // email I just added"). The invite itself is automatic on their sign-in.
      const linkText = appLink();
      if (linkText) {
        const linkInput = global.UI.el("input", {
          class: "input share-link__input", type: "text", readonly: "readonly", value: linkText,
          "aria-label": t("share.linkLabel")
        });
        linkInput.addEventListener("focus", () => linkInput.select());
        const copyBtn = global.UI.el("button", {
          type: "button", class: "btn btn--icon share-link__copy",
          "aria-label": t("share.copyLink"), title: t("share.copyLink")
        }, [global.UI.el("i", { class: "fa-solid fa-copy", "aria-hidden": "true" })]);
        copyBtn.addEventListener("click", () => copyLink(linkText, copyBtn));
        bodyChildren.push(global.UI.el("div", { class: "share-link" }, [
          global.UI.el("span", { class: "field__label" }, t("share.linkLabel")),
          global.UI.el("div", { class: "share-link__row" }, [linkInput, copyBtn]),
          global.UI.el("span", { class: "field__hint" }, t("share.linkHint"))
        ]));
      }
    } else {
      bodyChildren.push(global.UI.el("p", { class: "share__note" }, t("share.ownerOnly")));
    }
    bodyChildren.push(global.UI.el("h3", { class: "share__members-title" }, t("share.members")));
    bodyChildren.push(memberList);

    global.UI.openModal({
      title: t("share.title") + (treeTitle ? " — " + treeTitle : ""),
      body: global.UI.el("div", { class: "share" }, bodyChildren)
    });

    const ctx = {
      changeRole: async (entry, role) => {
        try {
          await db().rpc("invite_to_tree", { p_tree: treeId, p_email: entry.email, p_role: role });
          if (global.UI.toast) global.UI.toast(t("share.roleChanged"), "success");
          refresh();
        } catch (e) {
          if (global.UI.toast) global.UI.toast(t("share.roleChangeError"), "danger");
          console.error("role change failed:", e);
        }
      },
      remove: async (entry) => {
        const ok = await global.UI.confirm({
          title: entry.pending ? t("share.cancelInvite") : t("share.remove"),
          message: t("share.removeConfirm", { email: entry.email }),
          confirmLabel: entry.pending ? t("share.cancelInvite") : t("share.remove"),
          danger: true
        });
        if (!ok) return;
        try {
          await db().rpc("revoke_access", { p_tree: treeId, p_email: entry.email });
          if (global.UI.toast) global.UI.toast(t("share.removed"), "success");
          refresh();
        } catch (e) {
          if (global.UI.toast) global.UI.toast(t("share.removeError"), "danger");
          console.error("revoke failed:", e);
        }
      }
    };

    async function refresh() {
      const me = myEmail();
      const entries = [];
      // The owner (you) — always first, no actions on your own owner row.
      if (me) entries.push({ email: me, role: "owner", pending: false, isSelf: true, actions: false });
      try {
        const res = await db().from("tree_invites")
          .select("email, role, claimed_at")
          .eq("tree_id", treeId);
        if (res.error) throw res.error;
        (res.data || []).forEach((inv) => {
          // Skip an invite that echoes the owner's own email (shouldn't happen).
          if (me && String(inv.email).toLowerCase() === me.toLowerCase()) return;
          entries.push({
            email: inv.email,
            role: inv.role,
            pending: !inv.claimed_at,
            isSelf: false,
            actions: activeOwner
          });
        });
        global.UI.clear(memberList);
        entries.forEach((e) => memberList.appendChild(memberRow(e, ctx)));
      } catch (e) {
        global.UI.clear(memberList);
        memberList.appendChild(global.UI.el("div", { class: "share-members__empty" }, t("share.membersError")));
        console.error("member list failed:", e);
      }
    }

    async function submitInvite(ev) {
      if (ev) ev.preventDefault();
      const email = String(emailInput.value || "").trim();
      if (!emailValid(email)) {
        if (global.UI.toast) global.UI.toast(t("share.errEmail"), "warning");
        emailInput.focus();
        return;
      }
      const role = roleSelect.value === "editor" ? "editor" : "viewer";
      sendBtn.disabled = true;
      try {
        await db().rpc("invite_to_tree", { p_tree: treeId, p_email: email, p_role: role });
        if (global.UI.toast) global.UI.toast(t("share.invited", { email: email }), "success");
        emailInput.value = "";
        refresh();
      } catch (e) {
        if (global.UI.toast) global.UI.toast(t("share.inviteError"), "danger");
        console.error("invite failed:", e);
      } finally {
        sendBtn.disabled = false;
      }
    }

    if (activeOwner) {
      form.addEventListener("submit", submitInvite);
      sendBtn.addEventListener("click", submitInvite);
    }
    refresh();
  }

  global.Sharing = { open };
})(window);
