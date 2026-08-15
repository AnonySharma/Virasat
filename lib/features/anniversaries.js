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
    HORIZON_DAYS
  };
})(window);
