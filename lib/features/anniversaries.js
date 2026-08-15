// @ts-check
/**
 * Anniversaries — turns the "coming up" data (FamilyStore.upcomingAnniversaries)
 * into two things a family can actually act on:
 *
 *   1. Calendar export (.ics) — always available, needs no permission. Every
 *      birthday and memorial in the year ahead becomes a yearly-recurring
 *      all-day event with a morning alarm, so the dates live in the phone/desktop
 *      calendar the family already checks. This is the reliable path.
 *
 *   2. Reminders (opt-in) — a local notification on the day. Where the browser
 *      supports scheduled notifications (TimestampTrigger, e.g. installed PWAs on
 *      Chromium), we schedule the whole year ahead through the service worker so
 *      the reminder fires even with the app closed. Everywhere else we fall back
 *      to firing the same-day events the next time Virasat is opened. Either way
 *      the calendar export above is the durable reminder; notifications are a
 *      convenience layered on top.
 *
 * Nothing here mutates the tree, and both paths read straight from FamilyStore,
 * so they cover the whole family regardless of any active Insights filter.
 *
 * Public:
 *   Anniversaries.exportIcs()      — build + download the .ics for the year ahead
 *   Anniversaries.remindersEnabled()  — current opt-in state (bool)
 *   Anniversaries.setReminders(on) — toggle; requests permission + (re)schedules
 *   Anniversaries.syncReminders()  — boot hook: reschedule if already opted in
 *   Anniversaries.eventTitle(ev)   — display title for an upcomingAnniversaries row
 *   Anniversaries.dateLabel(iso)   — localized "12 August" for a YYYY-MM-DD
 */
(function (global) {
  "use strict";

  const PREF_KEY = "virasat.anniversaryReminders";
  const TAG_PREFIX = "virasat-anniv-";
  const HORIZON_DAYS = 365;   // how far ahead both the .ics and reminders reach
  const REMIND_HOUR = 9;      // fire/alarm at 09:00 local on the day

  function store() { return global.FamilyStore; }

  // === Shared labels ========================================================

  function personName(person) {
    const fs = store();
    const n = (fs && fs.getField ? fs.getField(person, "name") : null) || (person && person.name);
    return String(n || "").trim() || I18n.t("anniv.someone");
  }

  // Title used everywhere a single event is named: panel row, notification,
  // .ics SUMMARY. Distinguishes a living person's birthday from a departed
  // one's birth anniversary, and from a death anniversary (memorial).
  function eventTitle(ev) {
    const name = personName(ev.person);
    if (ev.kind === "death") return I18n.t("anniv.memorial", { name: name });
    const fs = store();
    if (fs && fs.isDeceased && fs.isDeceased(ev.person)) return I18n.t("anniv.birthAnniv", { name: name });
    return I18n.t("anniv.birthday", { name: name });
  }

  // Secondary line: "turns 30" for a living birthday, "20 years" otherwise.
  // Skipped when the year count isn't trustworthy (year-only source dates give 0).
  function eventMeta(ev) {
    if (!ev.ageOrYears || ev.ageOrYears < 1) return "";
    const fs = store();
    if (ev.kind === "birth" && fs && fs.isDeceased && !fs.isDeceased(ev.person)) {
      return I18n.t("anniv.turns", { n: ev.ageOrYears });
    }
    return I18n.t("anniv.yearsOn", { n: ev.ageOrYears });
  }

  function relLabel(daysAway) {
    if (daysAway <= 0) return I18n.t("highlights.today");
    if (daysAway === 1) return I18n.t("highlights.tomorrow");
    return I18n.t("highlights.inDays", { n: daysAway });
  }

  function dateLabel(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return "";
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    const locale = I18n.getLang && I18n.getLang() === "hi" ? "hi-IN" : "en-GB";
    try { return d.toLocaleDateString(locale, { day: "numeric", month: "long" }); }
    catch (_) { return iso; }
  }

  function events() {
    const fs = store();
    return fs && fs.upcomingAnniversaries ? fs.upcomingAnniversaries(HORIZON_DAYS) : [];
  }

  // === Shared UI builders (Insights band + inspector sidebar) ===============
  // The Insights "Coming up" band and the empty-inspector Family Highlights show
  // the same anniversary rows and month calendar. These builders live here,
  // beside the event data, so neither view has to duplicate the markup — each
  // host just wraps them in its own section chrome (a panel title, an eyebrow).

  // Reveal a person on the tree AND open their profile — the seam Timeline/
  // People use. Falls back to a bare inspector open if the reveal event throws.
  function reveal(person) {
    if (!person || !person.id) return;
    try {
      global.dispatchEvent(new CustomEvent("virasat:reveal-in-tree", { detail: { id: person.id } }));
      return;
    } catch (_) {}
    if (global.Inspector && Inspector.show) Inspector.show(person.id);
  }

  // One clickable person row: type icon + title/meta + relative "when". Shared
  // by the Coming-up list, the "+N more" modal, and a calendar day tap. onClick
  // defaults to revealing the person; the modal passes a variant that closes
  // itself first so the tree reveal is visible.
  function renderEventRow(ev, onClick) {
    const meta = eventMeta(ev);
    const row = UI.el("button", {
      class: "coming-up__row", type: "button",
      title: I18n.t("insights.comingUpOpen", { name: eventTitle(ev) })
    }, [
      UI.el("i", {
        class: (ev.kind === "death" ? "fa-solid fa-feather" : "fa-solid fa-cake-candles")
          + " coming-up__icon coming-up__icon--" + ev.kind,
        "aria-hidden": "true"
      }),
      UI.el("div", { class: "coming-up__body" }, [
        UI.el("div", { class: "coming-up__title" }, eventTitle(ev)),
        UI.el("div", { class: "coming-up__meta" }, dateLabel(ev.date) + (meta ? " · " + meta : ""))
      ]),
      UI.el("span", { class: "coming-up__when" }, relLabel(ev.daysAway))
    ]);
    row.addEventListener("click", onClick || (() => reveal(ev.person)));
    return row;
  }

  // The calendar-export (.ics) + same-day-reminder controls, plus their hint.
  // These live on the events modal (the one home for "keep these dates") — a
  // calendar file that works everywhere and an opt-in reminder that needs this
  // device's permission. `rerender` repaints the host so a toggled reminder pill
  // reflects its new state. Returns [actionsRow, hintPara].
  function renderReminderActions(rerender) {
    const repaint = typeof rerender === "function" ? rerender : function () {};

    // Calendar export — always shown; needs no permission.
    const icsBtn = UI.el("button", { class: "btn btn--sm coming-up__action", type: "button" }, [
      UI.el("i", { class: "fa-regular fa-calendar-plus", "aria-hidden": "true" }),
      UI.el("span", null, I18n.t("anniv.addToCalendar"))
    ]);
    icsBtn.addEventListener("click", () => exportIcs());
    const actions = [icsBtn];

    // Reminder opt-in — only where notifications exist at all. A pressed pill
    // reflects the saved opt-in; clicking requests permission + (re)schedules.
    if ("Notification" in global) {
      const on = remindersEnabled();
      const remindBtn = UI.el("button", {
        class: "btn btn--sm coming-up__action coming-up__remind" + (on ? " is-on" : ""),
        type: "button",
        "aria-pressed": on ? "true" : "false"
      }, [
        UI.el("i", { class: (on ? "fa-solid fa-bell" : "fa-regular fa-bell"), "aria-hidden": "true" }),
        UI.el("span", null, I18n.t("anniv.remindMe"))
      ]);
      remindBtn.addEventListener("click", async () => {
        remindBtn.disabled = true;
        try { await setReminders(!remindersEnabled()); }
        finally { remindBtn.disabled = false; repaint(); }
      });
      actions.push(remindBtn);
    }

    return [
      UI.el("div", { class: "coming-up__actions" }, actions),
      UI.el("p", { class: "coming-up__hint" }, I18n.t("anniv.remindHint"))
    ];
  }

  // Modal listing a set of events as clickable rows — the Coming-up "+N more"
  // (whole year ahead) and a calendar day both overflow into this scrollable
  // sheet instead of stretching their panel. Each row closes the modal first.
  // The footer carries the "keep these dates" controls: a calendar (.ics)
  // export and an opt-in same-day reminder.
  function renderEventsModal(title, evs) {
    if (!global.UI || !UI.openModal || !evs || !evs.length) return;
    let handle = null;
    const rows = evs.map((ev) => renderEventRow(ev, () => { if (handle) handle.close(); reveal(ev.person); }));
    const keep = UI.el("div", { class: "coming-up__keep" });
    // Rebuild the keep-these-dates controls in place so a toggled reminder pill
    // reflects its new state without tearing down the open modal.
    function paintKeep() {
      while (keep.firstChild) keep.removeChild(keep.firstChild);
      renderReminderActions(paintKeep).forEach((n) => keep.appendChild(n));
    }
    paintKeep();
    const closeBtn = UI.el("button", { class: "btn btn--primary", type: "button" }, I18n.t("actions.close"));
    handle = UI.openModal({
      title: title,
      body: UI.el("div", null, [
        UI.el("div", { class: "coming-up__list coming-up__list--modal" }, rows),
        keep
      ]),
      footer: [closeBtn]
    });
    if (handle) closeBtn.addEventListener("click", () => handle.close());
  }

  // A capped list of event rows plus an opener that reveals the full set in a
  // modal — the panel/section stays a fixed-height glance. The opener is always
  // present so the modal's "add to calendar / remind me" controls stay reachable
  // even when nothing's truncated: it reads "+N more" when events are hidden, and
  // "add to calendar & reminders" when all fit. `moreTitle` is the modal heading.
  // Returns the list container (never null; may be empty).
  function renderComingUpList(evs, max, moreTitle) {
    const cap = max || 6;
    const rows = evs.slice(0, cap).map((ev) => renderEventRow(ev));
    const hidden = Math.max(0, evs.length - cap);
    const moreBtn = UI.el("button", { class: "coming-up__more", type: "button" }, [
      UI.el("span", null, hidden
        ? I18n.t("insights.comingUpMore", { n: hidden })
        : I18n.t("insights.comingUpManage")),
      UI.el("i", { class: "fa-solid fa-chevron-right coming-up__more-caret", "aria-hidden": "true" })
    ]);
    moreBtn.addEventListener("click", () => renderEventsModal(moreTitle, evs));
    rows.push(moreBtn);
    return UI.el("div", { class: "coming-up__list" }, rows);
  }

  // Compact, mac-style month grid marking every birthday & memorial from the
  // whole-family event set. A marked day carries a small type icon and opens the
  // shared events modal for that day. Prev/next walk months (offset sticky across
  // re-renders); `rerender` repaints the host after nav. Returns the widget with
  // no outer title — the host supplies its own section heading.
  let calMonthOffset = 0;
  function calPad2(n) { return String(n).padStart(2, "0"); }
  function renderCalendar(rerender) {
    const evs = events();
    const repaint = typeof rerender === "function" ? rerender : function () {};

    // Bucket every anniversary by month-day. events() spans the next 365 days,
    // so each recurring date appears once — bucketing by MM-DD covers any month.
    const byKey = {};
    evs.forEach((ev) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ev.date || ""));
      if (!m) return;
      const key = m[2] + "-" + m[3];
      (byKey[key] = byKey[key] || []).push(ev);
    });

    const now = new Date();
    const shown = new Date(now.getFullYear(), now.getMonth() + calMonthOffset, 1);
    const year = shown.getFullYear();
    const month = shown.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstWeekday = shown.getDay();
    const isCurrentMonth = calMonthOffset === 0;
    const todayDate = now.getDate();
    const monthKey = calPad2(month + 1);

    const locale = I18n.getLang && I18n.getLang() === "hi" ? "hi-IN" : "en-GB";
    let monthLabel;
    try { monthLabel = shown.toLocaleDateString(locale, { month: "long", year: "numeric" }); }
    catch (_) { monthLabel = monthKey + "/" + year; }

    const prevBtn = UI.el("button", { class: "cal-nav__btn", type: "button", "aria-label": I18n.t("insights.calendarPrev") },
      [UI.el("i", { class: "fa-solid fa-chevron-left", "aria-hidden": "true" })]);
    const nextBtn = UI.el("button", { class: "cal-nav__btn", type: "button", "aria-label": I18n.t("insights.calendarNext") },
      [UI.el("i", { class: "fa-solid fa-chevron-right", "aria-hidden": "true" })]);
    prevBtn.addEventListener("click", () => { calMonthOffset--; repaint(); });
    nextBtn.addEventListener("click", () => { calMonthOffset++; repaint(); });
    const navChildren = [prevBtn, UI.el("span", { class: "cal-nav__label" }, monthLabel), nextBtn];
    if (!isCurrentMonth) {
      const todayBtn = UI.el("button", { class: "cal-nav__today", type: "button" }, [
        UI.el("i", { class: "fa-solid fa-rotate-left cal-nav__today-icon", "aria-hidden": "true" }),
        UI.el("span", null, I18n.t("insights.calendarThisMonth"))
      ]);
      todayBtn.addEventListener("click", () => { calMonthOffset = 0; repaint(); });
      navChildren.push(todayBtn);
    }
    const nav = UI.el("div", { class: "cal-nav" }, navChildren);

    const weekdays = I18n.t("insights.calendarWeekdays");
    const wdRow = UI.el("div", { class: "cal-weekdays" },
      (Array.isArray(weekdays) ? weekdays : ["S", "M", "T", "W", "T", "F", "S"])
        .map((w) => UI.el("span", { class: "cal-weekday" }, w)));

    const cells = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(UI.el("span", { class: "cal-cell cal-cell--blank" }));
    for (let d = 1; d <= daysInMonth; d++) {
      const key = monthKey + "-" + calPad2(d);
      const dayEvs = byKey[key] || [];
      const isToday = isCurrentMonth && d === todayDate;
      const inner = [UI.el("span", { class: "cal-cell__num" }, String(d))];

      if (dayEvs.length) {
        const icons = [];
        if (dayEvs.some((e) => e.kind !== "death"))
          icons.push(UI.el("i", { class: "fa-solid fa-cake-candles cal-cell__icon cal-cell__icon--birth", "aria-hidden": "true" }));
        if (dayEvs.some((e) => e.kind === "death"))
          icons.push(UI.el("i", { class: "fa-solid fa-feather cal-cell__icon cal-cell__icon--death", "aria-hidden": "true" }));
        inner.push(UI.el("span", { class: "cal-cell__icons" }, icons));

        const dayLabel = dateLabel(year + "-" + key);
        const cell = UI.el("button", {
          class: "cal-cell cal-cell--marked" + (isToday ? " is-today" : ""),
          type: "button",
          title: I18n.t("insights.calendarDayMarked", { date: dayLabel, n: dayEvs.length })
        }, inner);
        cell.addEventListener("click", () => renderEventsModal(dayLabel, byKey[key] || []));
        cells.push(cell);
      } else {
        cells.push(UI.el("span", { class: "cal-cell" + (isToday ? " is-today" : "") }, inner));
      }
    }
    const grid = UI.el("div", { class: "cal-grid" }, cells);

    const legend = UI.el("div", { class: "cal-legend" }, [
      UI.el("span", { class: "cal-legend__item" }, [
        UI.el("i", { class: "fa-solid fa-cake-candles cal-cell__icon cal-cell__icon--birth", "aria-hidden": "true" }),
        UI.el("span", null, I18n.t("insights.calendarBirthdayLegend"))
      ]),
      UI.el("span", { class: "cal-legend__item" }, [
        UI.el("i", { class: "fa-solid fa-feather cal-cell__icon cal-cell__icon--death", "aria-hidden": "true" }),
        UI.el("span", null, I18n.t("insights.calendarMemorialLegend"))
      ])
    ]);

    return UI.el("div", { class: "cal" }, [nav, wdRow, grid, legend]);
  }

  // === Calendar export (.ics) ===============================================

  function pad2(n) { return String(n).padStart(2, "0"); }

  // UTC timestamp in iCalendar basic format (DTSTAMP must be UTC).
  function icsStamp(dt) {
    return dt.getUTCFullYear() + pad2(dt.getUTCMonth() + 1) + pad2(dt.getUTCDate())
      + "T" + pad2(dt.getUTCHours()) + pad2(dt.getUTCMinutes()) + pad2(dt.getUTCSeconds()) + "Z";
  }

  function icsEsc(s) {
    return String(s == null ? "" : s)
      .replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,")
      .replace(/\r?\n/g, "\\n");
  }

  // RFC 5545 line folding: no content line over 75 octets. Kept simple —
  // folds on character count (our text is ASCII-ish enough for calendars).
  function fold(line) {
    if (line.length <= 74) return line;
    let out = line.slice(0, 74);
    let rest = line.slice(74);
    while (rest.length > 73) { out += "\r\n " + rest.slice(0, 73); rest = rest.slice(73); }
    return out + "\r\n " + rest;
  }

  function slug(s) {
    return String(s || "family").toLowerCase().normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "family";
  }

  function buildIcs() {
    const evs = events();
    const stamp = icsStamp(new Date());
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Virasat//Family Anniversaries//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH"
    ];
    evs.forEach((ev) => {
      const iso = String(ev.date || "");
      const dm = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
      if (!dm) return;
      const dateBasic = dm[1] + dm[2] + dm[3];
      const title = eventTitle(ev);
      const uid = ev.kind + "-" + (ev.person && ev.person.id ? ev.person.id : dateBasic) + "@virasat";
      lines.push(
        "BEGIN:VEVENT",
        fold("UID:" + uid),
        "DTSTAMP:" + stamp,
        "DTSTART;VALUE=DATE:" + dateBasic,
        "RRULE:FREQ=YEARLY",
        fold("SUMMARY:" + icsEsc(title)),
        fold("DESCRIPTION:" + icsEsc(I18n.t("anniv.icsDescription"))),
        "TRANSP:TRANSPARENT",
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        fold("DESCRIPTION:" + icsEsc(title)),
        "TRIGGER:PT" + REMIND_HOUR + "H",
        "END:VALARM",
        "END:VEVENT"
      );
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n") + "\r\n";
  }

  function exportIcs() {
    const evs = events();
    if (!evs.length) { UI.toast(I18n.t("anniv.none"), "info"); return; }
    const fs = store();
    const fam = fs && fs.getFamilyName ? fs.getFamilyName() : "family";
    const filename = slug(fam) + "-anniversaries.ics";
    UI.downloadFile(filename, buildIcs(), "text/calendar;charset=utf-8");
    UI.toast(I18n.t("anniv.icsExported"), "success");
  }

  // === Reminders ============================================================

  function remindersEnabled() {
    try { return localStorage.getItem(PREF_KEY) === "1"; } catch (_) { return false; }
  }
  function setPref(on) {
    try { localStorage.setItem(PREF_KEY, on ? "1" : "0"); } catch (_) {}
  }

  function notifyBody(ev) {
    const name = personName(ev.person);
    if (ev.kind === "death") return I18n.t("anniv.notifyMemorial", { name: name });
    const fs = store();
    if (fs && fs.isDeceased && fs.isDeceased(ev.person)) return I18n.t("anniv.notifyBirthAnniv", { name: name });
    return I18n.t("anniv.notifyBirthday", { name: name });
  }

  function occurrenceAt(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], REMIND_HOUR, 0, 0, 0).getTime();
  }

  // True where the browser can schedule a notification for a future instant
  // (Notification Triggers). Elsewhere we degrade to same-day-on-open.
  function canSchedule() {
    return "serviceWorker" in navigator && typeof global.TimestampTrigger !== "undefined";
  }

  function notifOptions(ev, at) {
    /** @type {any} */
    const opts = {
      tag: TAG_PREFIX + ev.kind + "-" + (ev.person && ev.person.id),
      body: notifyBody(ev),
      icon: "assets/apple-touch-icon.png",
      badge: "assets/apple-touch-icon.png",
      renotify: false,
      data: { url: (location.pathname || "./") + "#tree" }
    };
    if (at != null && typeof global.TimestampTrigger !== "undefined") {
      opts.showTrigger = new global.TimestampTrigger(at);
    }
    return opts;
  }

  // Schedule the whole year ahead. Stable per-person tags mean re-running on the
  // next boot replaces each pending notification rather than duplicating it, so
  // newly-added people get covered and the rolling window stays fresh.
  function scheduleTriggers(evs) {
    navigator.serviceWorker.ready.then((reg) => {
      const now = Date.now();
      evs.forEach((ev) => {
        const at = occurrenceAt(ev.date);
        if (at == null || at < now) return;
        try { reg.showNotification(eventTitle(ev), notifOptions(ev, at)); }
        catch (_) { /* a single bad event shouldn't sink the batch */ }
      });
    }).catch(() => {});
  }

  // Fallback path: fire only today's events, once per day, deduped by a
  // last-fired stamp so reopening the app the same day doesn't re-notify.
  function fireTodays(evs) {
    const today = new Date();
    const key = today.getFullYear() + "-" + pad2(today.getMonth() + 1) + "-" + pad2(today.getDate());
    let fired = {};
    try { fired = JSON.parse(localStorage.getItem(PREF_KEY + ".fired") || "{}") || {}; } catch (_) {}
    const due = evs.filter((ev) => ev.daysAway === 0);
    if (!due.length) return;

    const emit = (reg) => {
      due.forEach((ev) => {
        const id = ev.kind + "-" + (ev.person && ev.person.id);
        if (fired[id] === key) return;
        fired[id] = key;
        try {
          if (reg) reg.showNotification(eventTitle(ev), notifOptions(ev, null));
          else new Notification(eventTitle(ev), notifOptions(ev, null));
        } catch (_) {}
      });
      try { localStorage.setItem(PREF_KEY + ".fired", JSON.stringify(fired)); } catch (_) {}
    };

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready.then(emit).catch(() => emit(null));
    } else {
      emit(null);
    }
  }

  function scheduleAll() {
    const evs = events();
    if (canSchedule()) scheduleTriggers(evs);
    else fireTodays(evs);
  }

  // Best-effort teardown when the user opts out: close our shown + pending
  // notifications so a scheduled reminder doesn't fire after opt-out.
  function clearScheduled() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.ready.then((reg) => {
      if (!reg.getNotifications) return;
      // includeTriggered surfaces still-pending scheduled notifications (not in
      // the standard DOM lib types) so opt-out can cancel them too.
      reg.getNotifications(/** @type {any} */ ({ includeTriggered: true })).then((list) => {
        list.forEach((n) => { if (n.tag && n.tag.indexOf(TAG_PREFIX) === 0) n.close(); });
      }).catch(() => {});
    }).catch(() => {});
  }

  async function setReminders(on) {
    if (!on) {
      setPref(false);
      clearScheduled();
      UI.toast(I18n.t("anniv.remindersOff"), "info");
      return false;
    }
    if (!("Notification" in global)) {
      UI.toast(I18n.t("anniv.unsupported"), "danger");
      return false;
    }
    let perm = Notification.permission;
    if (perm === "default") {
      try { perm = await Notification.requestPermission(); }
      catch (_) { perm = Notification.permission; }
    }
    if (perm !== "granted") {
      setPref(false);
      UI.toast(I18n.t("anniv.permissionDenied"), "danger");
      return false;
    }
    setPref(true);
    scheduleAll();
    UI.toast(I18n.t("anniv.remindersOn"), "success");
    return true;
  }

  // Called once on boot: if the user already opted in and permission still
  // holds, refresh the schedule for the current tree.
  function syncReminders() {
    if (!remindersEnabled()) return;
    if (!("Notification" in global) || Notification.permission !== "granted") return;
    scheduleAll();
  }

  global.Anniversaries = {
    exportIcs, buildIcs,
    remindersEnabled, setReminders, syncReminders,
    eventTitle, eventMeta, relLabel, dateLabel, events,
    reveal, renderEventRow, renderEventsModal, renderComingUpList, renderCalendar,
    HORIZON_DAYS
  };
})(window);
