# Virasat — issues

> **This file tracks core-app bugs & tech-debt only.** The live, day-to-day backlog
> — including all cloud-sync / auth / sharing work — is [`UX-BACKLOG.md`](UX-BACKLOG.md).
> This file predates the cloud work and intentionally makes no mention of it.

Bugs, regressions, and tech-debt found across four audit rounds plus user-reported issues. **Open items at the top, ranked by impact priority.** Solved items live in [Resolved](#resolved) at the bottom for traceability.

Use the priority tier as the order to work through; within a tier, ordered by impact.

---

## Open issues

### Tier B — High (broken feature / WCAG fail / discoverability)

*(Tier-A items are all currently resolved — see [Resolved](#resolved).)*

- 🟡 **Tree-node Tab order — every node a tab stop.** A 50-person tree forces 50 tab presses to traverse. Roving tabindex with arrow-key navigation between siblings / parent / child would match the WAI-ARIA tree-grid pattern.

### Tier C — Medium (degraded UX / future tech-debt)

- 🟡 **Tree-view zoom buttons icon-only with no visible text label.** `aria-label` covers screen readers; sighted low-vision keyboard users get only a glyph. Add a tooltip on focus or a visually-hidden label.
- 🟡 **Inspector mobile close polish.** The `.inspector-close` exists at `≤ 1100 px` and works; the small × in the top corner could be more obvious.
- 🟡 **Photo migration first-load re-renders.** `migrateLegacy` runs N updates; each fires a notification (now muted, but the legacy code path could still cascade in some edge cases). Verify and tighten.
- 🟡 **`zoomBy` doesn't clamp the anchor.** Wheeling over canvas padding lets the tree slide off-screen.
- 🟡 **Butter pastel + small text fails AA.** `--av-butter` (`#ECE0AE`) on ivory is 1.15:1 contrast.
- 🟡 **`buildGenerations` spouse-pull is symmetric.** Two orphan partners both at gen 0 stay at gen 0. No observed bug; gate the pull on `Math.max > 0`.
- 🟡 **`gapBefore` indexing fragile when `indexOfRight === 0`.** Defensive only.
- 🟡 **No progress UI on long PNG exports.** Currently only the button label flips to "Rendering…". A small "Inlining 12/30 photos…" chip would help.
- 🟡 **Hardcoded UI strings that bypass i18n** (found in the 2026-08 subagent audit; all should route through `lib/core/i18n.js` so both EN + HI resolve — the new `tests/i18n-parity.mjs` guards the label file, but not string *usage*). Ranked by user impact:
  - **Exported "Family Tree" text doesn't localise.** In HI, a Hindi user's exported PNG poster (`image-export.js:577` header default, `:855` bottom-right wordmark), the JSON backup's default family name (`export-import.js:614`), and the PNG filename all read English "Family Tree". Highest-impact of this group because it ships in a file the user shares. Fix: add an `exp.defaultFamilyName` key and thread it through, or fall back to `insights.titleFallback` ("परिवार"). This is the separable "export surface" cluster — do it as one change.
  - **`people-view.js:1219` contact email placeholder** is a literal `"name@example.com"` — an existing `auth.emailPlaceholder` key holds the same string; reuse it.
  - **`insights-view.js:239` decade tooltip** builds `d.decade + "s · " + d.count` — the `"s"` decade-plural suffix is English-only (HI has no `titleFallback`-style key for it). Low: it's a hover `title`, and `:246` already renders the visible label as `'XXs`-free (`'80`). Add an `insights.decadeTooltip` template if localising.
  - **`tree-view.js:201` `"Family tree"`** fallback when `FamilyStore.getFamilyTitle` is absent — unreachable in practice (the method always exists), defensive only.
  - **`dom.js:208/210/247` + `:255`** — `openModal` `aria-label` default `"Dialog"`, and `UI.confirm` defaults `"Are you sure?"` / `"Confirm"`. Verified **every** `UI.confirm` caller passes `title` + `confirmLabel` from i18n, so these are unreachable fallbacks — but `:313/:322` already use the `window.I18n ? I18n.t(…) : "English"` idiom, so routing these three through it would be consistent. Lowest priority.
  - **`export-import.js:562` `"JSON"` field label + `:460` `"JSON ≈ {size}"` readout + `formatSize` `" KB"`/`" MB"`/`" B"` units** — debatable whether "JSON"/"KB"/"MB" are translatable at all; left as-is intentionally, noted for completeness.
  - **Devanagari `_hi` field placeholders** (`people-view.js:1021/1146/1157/1191/1240`, e.g. `"पूरा नाम"`, `"नगर, देश"`) are hardcoded Hindi *on purpose* — they cue Hindi-script entry regardless of UI language, so a current-language `I18n.t()` would wrongly show English when the UI is EN. If moved to i18n at all, they need a language-pinned lookup (`I18n.t(key, {lang:"hi"})`, which doesn't exist yet). Not a bug; documented so a future sweep doesn't "fix" it wrong.
  - ✅ **`inspector.js:472` hardcoded English month array.** *(resolved this commit)* `formatDateLong` built `["Jan"…"Dec"][mo-1]`, so every date the inspector rendered ("14 Aug 2026", the most-seen date surface in the app) showed English month abbreviations even in Hindi UI. Rewritten to `toLocaleDateString(locale, {day,month:"short",year})` with the locale derived hi-IN/en-GB — the exact idiom `anniversaries.js` `dateLabel` already used. EN output is byte-identical to the old array ("14 Aug 2026", "5 Jan 1935"); HI now renders Devanagari months ("14 अग॰ 2026"). No new i18n keys (parity untouched).

### Tier D — Low (nits)

- 🟡 **Sample-data id collisions on re-load.** "Try sample family" overwrites silently if the user has the same fixed ids. Currently behind a destructive confirm; documented.
- 🟡 **Triple flush listeners on `flushPersist`** (beforeunload + pagehide + visibilitychange). Idempotent; redundant CPU at unload time only.
- 🟡 **Crop editor 404-tolerates silently** when `photoUrl` 404s. Drag still applies to a 0×0 broken image. Add an `<img>.onerror` that aborts with a toast.
- 🟡 **Generation labels clip on 360 px viewports.** Polish.
- 🟡 **PWA uninstall recovery story.** Browser keeps localStorage + IDB after uninstall on most platforms. Document: "Uninstall removes the icon, not the data. Use Tools → Reset everything before uninstalling for a clean wipe."
- 🟡 **First-time tooltips for hidden affordances.** The tree long-press menu (phone) and the desktop right-click pan-hint are now covered; what's still unhinted on first run is the **gold-knot click** and the **crop-editor drag**. One-shot tooltips gated by `localStorage.getItem("virasat.tip.knot")` etc.
- 🟡 **Date-input placeholder doesn't update with precision.** When the user picks "About", the input still says `YYYY-MM-DD`.
- 🟡 **Timeline name column truncates Hindi names at 120 px.** Polish — accept truncation, consider line-wrap on `(pointer: coarse)`.
- 🟡 **Inspector "Add child" success doesn't expand the Family section.** If collapsed, the new child is invisible until the user clicks the section header.
- 🟡 **Storage.persist() toast may race the toast-root mount.** Defer inside `DOMContentLoaded`.
- 🟡 **Landscape phone (667×375) is functionally tight.** Inherent constraint; consider a more compact tree layout when `(orientation: landscape) and (max-height: 480px)`.

---

## Tech stack & free hosting

> Superseded by [`ROADMAP.md`](ROADMAP.md) §P3.5, which is the source of truth for the
> stack and hosting decisions (Supabase + GitHub Pages, since implemented on
> `feat/cloud-sync`). The earlier survey that lived here — comparing static hosts and
> weighing a Gist-backup vs. real auth — has been overtaken by that work and removed to
> avoid two conflicting records. For scale: the app is ~18 k JS lines across 26 `window`
> modules, still no-build (`just-open-index.html`), which remains a deliberate
> 30-year-heirloom property.

---

## Resolved

Fixed items (✅) tagged with the resolving commit hash. Verified-false / closed-won't-fix items (⛔) kept here for traceability so future audits don't re-flag them.

### Tier A — Critical / data-loss / iOS-broken

- ✅ **Date-picker calendar clipped inside the modal — top rows (month nav + weekday header) unreachable.** The `.hdp__popover` was `position:absolute` inside `.modal__body`, which is `overflow-y:auto`; an absolutely-positioned descendant is clipped to that scroll box. For a field mid-modal the calendar flipped upward (the earlier `.hdp--up` fix) and its top slid above the body's visible area — and scroll can't go negative, so the month-nav + weekday row were simply gone. Fixed by **portaling the popover to `<body>` with `position:fixed`** while open (`heritage-datepicker.js` `open()`/`close()`), replacing `flipIfNeeded()` with a `position()` that pins it to the input and **clamps into the viewport** so neither top nor bottom is ever cut; re-pins on scroll (capture, to catch the modal body) + resize + year-only toggle. CSS gained a `max-height: calc(100dvh - 16px)` + internal scroll safety net for landscape phones, and z-index raised just above the modal. Two portal-consequences handled: the outside-click test (`onDocDown`) and the blur-commit guard now check `popover.contains()` too, since the popover is no longer a descendant of the field's `wrap`. `.hdp--up` fully retired. `CACHE_VERSION` → v109. (this commit)
- ✅ **`claim_invites()` crashed on every call — email invites could never be claimed.** The RPC's `INSERT ... SELECT` read `t.tree_id / t.role / t.invited_by` from a CTE that was named `taken`, so Postgres raised `missing FROM-clause entry for table "t"` (SQLSTATE `42P01`, which PostgREST surfaces as a confusing HTTP 404). This is the function that promotes a pending email invite into a live `tree_members` row when the invited person first signs in, so sharing-by-email was silently broken end-to-end since the schema landed (`dbb1a56`). Fixed by aliasing the CTE `from taken t`. Server-side only — re-run `supabase/schema.sql`. (this commit)
- ✅ **`genId` collisions.** Math.random + Date.now produced same-millisecond dupes. Now uses `crypto.randomUUID` with a per-process counter fallback. (`655b493`)
- ✅ **PhotoStore IDB races + transaction promise resolution race.** Id is picked inside the transaction (with retry-on-collision); the rewritten `txValue` resolves the captured value on `t.oncomplete`, not `null`. (`655b493`)
- ✅ **`importPreservingIds` opening a second IDB connection.** Reuses the wrapped connection via `db.putWithKey`. (`655b493`)
- ✅ **`state.marriages` dropped on JSON export.** `buildRedactedState{Sync,Async}` now include marriages and respect the same toggles. (`655b493`)
- ⛔ **`syncSpouses` mutating partner records without `persist()`.** Verified false — `addPerson`/`updatePerson` call `persist()` *after* `syncSpouses`, so it's already covered.
- ✅ **No `env(safe-area-inset-bottom)` anywhere — iOS home bar covered controls.** Tree zoom cluster + toasts now use `bottom: calc(… + env(safe-area-inset-bottom))`. (`07516dd`)
- ✅ **Mobile tree had no add-relative path.** Bottom-line resolution: every empty-state has an inline "Add your first relative" CTA; on devices with a populated tree, the People view's add path covers it. The right-click context menu is desktop-only by design.
- ✅ **Photo crop reset on photo replace.** Re-uploading a photo resets `photoCropAvatar` and `photoCropHero` so the old frame doesn't apply to the new image. (`7bad5ef`)
- ✅ **Corrupt-localStorage parse-fail orphans IDB photos.** `load()` calls `PhotoStore.clearAll()` on parse failure before resetting. (`7bad5ef`)
- ✅ **Marriage photos never migrated to IDB.** `migrateLegacy` now iterates `state.marriages` too. (`7bad5ef`)

### Tier B — High

- ✅ **CI standing-red on `feat/cloud-sync` — `tests` + `typecheck` both failing on every push.** Three independent pre-existing root causes, none introduced by recent feature work: **(1)** `i18n.js` read `navigator.language` at module load *outside* the try/catch. `navigator` only became a Node global in v21, so CI's node-20 threw `ReferenceError` the moment any test booted i18n — killing `i18n-parity`, `kin-terms`, and `self-anchor` (the other 8 tests passed). Guarded with `typeof navigator !== "undefined"`, preserving the `"en"` fallback. **(2)** `SelfAnchor` and `KinTerms` are shipped `window` globals but were never declared in `types/window-globals.d.ts`, and the file carried a stale `HelpGuide` (nothing exports it — the real global is `HelpPage`), producing ~38 `TS2304/TS2339` errors across app/inspector/tree-view/path-finder. Added the three real globals, removed the stale one. **(3)** four genuine intra-file type nits behind `// @ts-check`: `kin-terms.js:363` (`key` string-coercion), `image-export.js:445` (`Element`→`HTMLElement` cast for `.style`), `help-page.js:177/183` (`root` null-narrowing) and `:308` (`FrameRequestCallback` arity). Verified locally: 11/11 tests pass, the 3 formerly-failing tests pass with `navigator` deleted (faithful node-20 sim), and `tsc@5.9.3 --noEmit -p jsconfig.json` is clean. (`f3fb238`)
- ✅ **"How this app works" kebab row was a dead no-op.** The phone overflow menu's Help row called `openOverlayRoute("help", false)`, but help had already been extracted to its own `help.html` page — the overlay route it targeted no longer had an opener, so tapping it did nothing. Repointed the row to `openHelpPage()` (the same entry the desktop help affordance uses). (`7683598`)
- ✅ **Mobile UI sweep — calendar unreachable, toolbar wrap, Share buried, People search layout, dark-mode card icons.** Five user-reported/screenshot-caught phone issues fixed in one pass: **(1) Family calendar was desktop-only.** Its only home was the inspector empty-state, which becomes an off-screen drawer ≤1100px that opens only on person-select — so phones never saw it. Surfaced as a folded panel in the mobile-reachable Insights view (`insights-view.js` `calendarPanel()`, folded by default, whole-family, reusing `Anniversaries.renderCalendar`). **(2) Tree toolbar wrapped to two lines on phone.** CSS specificity bug: `.tree-controls .btn{display:inline-grid}` (0-2-0) beat the unscoped `.tree-controls__hist{display:none}` (0-1-0), so undo/redo never hid on phone and the cluster overflowed. Scoped the hide selector to `.tree-controls .tree-controls__hist`. **(3) Share was buried in the three-dots menu.** Promoted to a top-level phone header button (`#share-btn-phone`) beside the sync pip / kebab — inviting family is the highest-value action in the multi-user app; removed the kebab Share row so it isn't duplicated. Both share buttons kept in lockstep by `refreshShareButton()` behind the same owner gate. **(4) People search scope toggle looked detached** — the searchbar stayed at its 240px min-width while Add grew, leaving the in-bar sliders floating in the gap. `flex:1 1 auto; min-width:0` on the pill, `flex:0 0 auto` on the button. **(5) Person-card edit/delete icons wrong colour in dark mode** — hardcoded `rgba(255,255,255,.85)` fill had no dark variant, glaring as a pale disc with a near-invisible (~1.3:1) glyph; switched to `--bg-elev` + `--text-2` tokens that flip per theme. Plus two taste fixes caught in the same audit: collect-form buttons carried an `📄` emoji + bare-text labels (now FA icons), and the spouse empty-avatar used a `♥` dingbat (now `fa-heart`, matching the pet-owner sibling's `fa-paw`). (this commit)
- ✅ **Pets could not be linked to an owner from the UI.** `isPet` had a working toggle, but `petOwners[]` — the anchor that seats a pet one generation below its humans — was only ever written by sample/seed data. A user marking a person as a companion animal got a node that floated rootless at the tree's top row, with no affordance to tether it. The person form now reveals an **Owners** picker whenever the pet toggle is on: a dynamic multi-row list (a pet can belong to a couple) mirroring the spouse rows, excluding self and other pets from candidates, with inline "add a new person" and unlink-confirm. Persists `petOwners` on save; the existing delete-strip already clears dangling owner ids. (this commit)
- ✅ **Service worker `SHELL` array out of sync with `index.html`.** `path-finder.js` and `print-book.js` were loaded by the page but missing from `SHELL`, so offline mode broke for those features. Both added; `CACHE_VERSION` bumped to `v3` to invalidate stale caches. (this commit)
- ✅ **Timeline bar avatar ignored `photoCropAvatar`.** Real bug — couples-photo crops showed the wrong face on the timeline because the bar avatar didn't honour the user-chosen focal point. `buildBarAvatar` now mirrors `UI.avatar`'s crop application. (this commit)
- ✅ **Service worker bypass — `sw.js` was being cached.** `sw.js` is now bypass-cached; `CACHE_VERSION = v2`. (`655b493`)
- ✅ **Google Fonts CSS / Font Awesome CSS not in `SHELL`.** Added `CDN_SHELL` precached on install. (`655b493`)
- ✅ **Crop editor drag math divided by `state.scale`.** Removed; mapped by per-axis slack. Then a final pass switched to manual `<img>` sizing + `transform: translate` + a `MIN_SCALE = 1.05` floor so drag works on both axes regardless of frame aspect. (`655b493`, `319a01f`, `ceb3dde`)
- ✅ **Lineage-export bbox returned null for single-node lineage.** Falls back to focus-node `getBoundingClientRect` → SVG viewBox. (`655b493`)
- ✅ **Synchronous `persist()` per keystroke.** Debounced 250 ms with eager flush on `beforeunload` + `pagehide` + `visibilitychange=hidden`. (`655b493`, `7bad5ef`)
- ✅ **Modal had no focus trap or return-focus.** `Tab`/`Shift+Tab` traps; opens at first focusable; restores previous focus on close. (`655b493`)
- ✅ **HeritageSelect missing `aria-activedescendant`.** Each `<li>` gets a per-instance unique id; combobox attribute updates on hover. (`7bad5ef`)
- ✅ **Pinch-zoom conflicting with browser viewport zoom.** `.tree-svg { touch-action: none; }`. (`655b493`)
- ⛔ **Minimal-JSON export leaks new fields.** Verified false — `applyMinimal` builds the output from a fresh `{}` with an explicit allowlist. Allowlist later expanded to include `gender`, `createdAt`, `updatedAt`. (`7bad5ef`)
- ✅ **`cssAttrEscape` incomplete.** Uses `CSS.escape` when available; regex covers `[`, `]`, `"`, `\`, whitespace as fallback. (`7bad5ef`)
- ✅ **`txValue` didn't catch sync throws inside async callbacks.** Each IDB callback is wrapped via `safe(cb, fail)` so sync throws abort the transaction. (`7bad5ef`)
- ✅ **`pagehide` not wired alongside `beforeunload`.** Wired. (`7bad5ef`)
- ✅ **`replaceAll` racing pending debounce.** `flushPersist()` is called at the start of `replaceAll`. (`7bad5ef`)
- ✅ **No cross-tab sync.** `storage` event listener reloads state and notifies subscribers. (`7bad5ef`)
- ✅ **Photo-migration cascade re-rendered N times on first load.** `setMute()`/`notifyAll()` so one notification fires at the end. (`7bad5ef`)
- ✅ **Tree nodes not keyboard-focusable.** `tabindex=0`, `role=button`, `aria-label`, `keydown` (Enter/Space → inspector), gold focus halo on the photo ring. (`7bad5ef`)
- ✅ **`navigator.storage.persist()` rejection silently swallowed.** Logs the result + one-shot toast on denial. (`7bad5ef`)
- ✅ **README claim that story search is in the header.** Now accurate — header search routes through `PeopleView.setSearch`, which calls `searchStories(q)` and renders dedicated story-result cards. (`07516dd`)
- ✅ **iOS PWA icon was SVG-only.** Apple-touch-icon links updated. (`655b493`)
- ✅ **`.view-head__title` clipping on phones.** `@media (max-width: 640px)` shrinks title 38 → 26 px and stacks actions on their own row. (`07516dd`)
- ✅ **Tree empty-state had no inline CTA.** Inline *Add your first relative* primary button. (`07516dd`)
- ✅ **Reframe button broke on `photoUrl`-only people.** Resolves `draft.photoUrl` directly. (`f4dea50`-era follow-up)
- ⛔ **Cross-tab `storage` listener calling `load()` could clear IDB on parse failure.** Re-evaluated; the parse-failure clear is correct for single-tab corruption. The cross-tab path runs the same `load()`, which is acceptable: if the payload is unparseable everywhere, every tab's photos are already orphan candidates.
- ✅ **`exportFullProfile` poster ignored `photoCropHero`.** Updated poster path to use the hero crop for the round portrait clip with cover-fit + clamp identical to the on-screen render. (`655b493`)

### Tier C — Medium

- ✅ **Timeline `startYear === endYear` bar.** Death-only people render as a 6-px point marker. (`655b493`)
- ✅ **Reduced-motion not gating story-card / modal / toast / lineage banner.** Now gated. (`655b493`, `7bad5ef`)
- ✅ **Touch targets < 44 px.** `@media (pointer: coarse)` bumps `.btn--icon` and `.hsel__opt`. (`7bad5ef`)
- ✅ **Modal focus trap interfering with portaled popovers.** Exempts focus inside `.hdp__pop`, `.hsel__menu`, `.modal-portal-exempt`. (`7bad5ef`)
- ✅ **`inlineSvgImages` no per-export memoisation.** One `Map<href, Promise<dataUrl>>` per `exportTreePng` call. (`7bad5ef`)
- ✅ **`SCHEMA_VERSION` still 1.** Bumped to `2`. (`7bad5ef`)
- ✅ **Marriage keys not normalised on import.** `replaceAll` re-keys via `marriageKey`. (`7bad5ef`)
- ✅ **Inspector accordion focus halo touches the icon.** Inset gold outline on `:focus-visible`. (`6625fba`)
- ✅ **Section body glued to header on hover.** 8 px top padding on the open body. (`6625fba`)
- ✅ **Reframe modal overflowed horizontally; one shared zoom slider for both frames.** Manual layout that fits inside the modal max-width; per-frame zoom slider; the avatar shrinks to 180 px so both fit on one row. (`c548494`)
- ✅ **Crop editor — no keyboard reframe.** The focal-point surface is now `tabindex=0` + `role`/`aria-label`; a `keydown` handler nudges the focal point (arrows, Shift = larger step) and each frame's zoom slider is keyboard-operable, so reframing no longer requires a pointer.
- ✅ **People grid stretched single result to full height.** `align-content: start` + per-card `align-self: start`. (`07516dd`)
- ✅ **Search returned people-only when matching stories.** Story-result cards now appear above person-result cards; clicking opens the inspector + scrolls to the matched story + flashes a gold halo. (`07516dd`)
- ✅ **Emojis everywhere instead of icons.** Sweep replaced 📍 / ⏳ / ❓ / ✦ / ↗ / ✕ / − / ＋ / { } / 🌳 / 🌱 / 🔎 / ← / ✎ / 🗑 with FA equivalents. (`07516dd`, plus a follow-up sweep across modal-button labels.)
- ✅ **Pet placement on top row + diagonal tether across the canvas.** Pets now sit one generation below their owners, connected with a dashed gold riser (same trunk + rail as their humans' children). When all of a couple's children are pets, the whole connector dashes. (`bfcb5bc`)
- ✅ **Pets not in lineage focus.** Lineage walker now pulls every pet whose owner is in lineage. (`bfcb5bc`)
- ✅ **Edge corners showed visible "steps" at thicker stroke widths.** Switched `.t-edge` to `stroke-linecap: butt` + `linejoin: miter`. (`bfcb5bc`)
- ✅ **Hamburger toggle ghost button on desktop.** Hamburger is `display: none` everywhere except `≤ 768 px`. Documented; closed.
- ✅ **Tools rail had no view-options.** New View Options popover (sliders icon in the tree-controls cluster) with *Show pets / Show story count / Show dates* — each persists per-device via `localStorage`. (`c26cf62`)
- ✅ **Family Highlights cards clipping in narrow inspector.** Stack one-per-row. (`017fd68`)
- ✅ **"Coming up" duplicated in rail and inspector.** Removed from the rail since Family Highlights already surfaces the next anniversary. (`bfcb5bc`)
- ✅ **Path-finder From/To pickers showed empty.** HeritageSelect returns `{ el, ... }`; adapter returns the right shape. (`d403bc5`)
- ✅ **Path-finder hop tooltip floating mid-modal.** Replaced with an `aria-label` that names the person. (`d403bc5`)
- ✅ **Photo uploader buttons inconsistent.** Upload / Reframe / Remove all carry icons. (`07516dd` + follow-ups)
- ✅ **Bare-text dialog buttons across modals.** Sweep covered Cancel / Save / Close / Remove / Forget / Today / Clear and the story-editor footer. (`de8e6be`)
- ✅ **Full SVG re-render on every store mutation.** Topology-signature gate: when the structural bits (parents / spouses / petOwners / isPet / deathDate / story-count presence / photo presence / marriages keys / view toggles) haven't changed, render() skips layout + DOM rebuild and patches cosmetic bits (name / dates / density-chip number) on existing nodes. (`51d2f8c`)
- ✅ **People-view search re-renders the entire grid per keystroke.** Debounced 120 ms + person cards cached in `Map<id, {sig, node}>`. Cache reuses DOM when name/date/place/photo are stable; pruned once size > 2× population. (`51d2f8c`)
- ✅ **Header search hidden on phones.** Resolved with a different shape than the originally-suggested modal/drawer: the phone kebab menu carries a *Search people* row (`app.js` `openKebabMenu`) that routes into the People view's search, so discoverability is restored without a second search surface.
- ✅ **No way to preview a shared tree as a viewer.** The viewer read-only machinery (`setReadOnly` + `body.is-viewer` + every `.js-edit-only` guard) shipped with cloud sync but only ever activated for real viewer-role members — an owner had no way to see it, so "how does this look to the family I shared with?" was unanswerable. Added **preview-as-viewer**: `CloudStore.setPreview()` folds a `previewing` flag into `applyRole()`, a gold banner (with Exit) replaces the olive viewer note, and a header `#preview-btn` (desktop) / kebab row (phone) toggles it (owner/editor only; pure view state, never persists). The Share button hides during preview too, so the imitation is faithful.
- ✅ **No way to share a tree without making the recipient sign in.** Sharing was invite-only — a family member had to create a Supabase account and be added as a viewer/editor before they could see anything, which is a wall for the grandparent-with-a-link case. Added an **unlisted, no-login read path**: an owner toggles link-sharing in the Share modal (`sharing.js` — `set_tree_share`/`rotate_share_token` RPCs), which flips `trees.visibility` to `'unlisted'` and mints a random `share_token`; the resulting `?v=<treeId>&k=<token>` URL boots `lib/auth/public-view.js`, which reads the tree anonymously via the new `get_shared_tree` SECURITY DEFINER RPC (anon key, no session) and drops straight into the existing read-only viewer (`setReadOnly` + `body.is-viewer`). Server-side redaction is wired through the pre-existing `redact_person`, so link visitors never receive private phone/email/address (stricter than signed-in viewer-members, whose initial blob is still raw — deferred). Photos resolve via one additive `photos_read_shared` storage policy gated on `is_tree_shared`. Deliberately **unlisted-only** — no fully-public/indexable mode — to keep the "no public pages" privacy promise (`noindex` stays); the token is the secret, `referrerpolicy="no-referrer"` keeps it out of the Referer header, and rotating it instantly revokes every old link. Requires the `supabase/schema.sql` migration (2 columns + 4 functions + 1 storage policy) to be run once.
- ✅ **Read-only viewer mode leaked several edit affordances (found via preview).** The store no-ops every mutation under read-only, but four UI surfaces still *offered* editing and showed a misleading green "saved" toast on the silent no-op: (1) the **tree "+" add-relative disc** — built only when `!isReadOnly`, but `topoSignature` didn't include read-only, so toggling preview skipped the cached SVG rebuild and stranded the disc in the DOM (now folded into the signature); (2) the **wedding-details modal** — always opened editable (Edit button now hidden for viewers; the record stays viewable); (3) the **story editor** — a story card is also its read surface, so it opened the full editor with Save/Delete (now readonly inputs + Close-only + a "Story" view title, mirroring the notes textarea); (4) **CSV/JSON import** — `openImport`/`importCsvText` mutate + toast success, and CSV even *crashed* under read-only (`addPerson`→null→`.name`); both now guarded (menu entries were already `js-edit-only`, so this is defensive depth). The store-layer guards were already correct and centralized — these were all presentation leaks.
- ✅ **Archive-completion stats stranded on mobile.** The family-archive completion bar (% of births/photos/descriptions filled across the tree) rendered only in the inspector's empty-state, which becomes an off-screen drawer ≤1100px that opens *only* on person-select — so a phone user never saw the tree's completion progress. Same trap the family calendar was in; same fix. Added `completionPanel()` to `insights-view.js` (rail-reachable on mobile) as a full-width band beside coming-up/calendar, reading the same `FamilyStore.maintenanceStats()` and the same `.completion` CSS as the inspector twin, so they stay in numeric + visual lockstep. Whole-tree (never filtered), matching both its inspector meaning and its band-neighbours; hidden together with them when the tree is empty or a filter hides everyone. No new i18n keys. (this commit)
- ✅ **Heritage date-picker popover overflows narrow modals.** The popover is now `width: min(320px, calc(100vw - 32px))` (`components.css`) and flips above the field via a `.hdp--up` class when there's more room above than below (`heritage-datepicker.js`), so it never pushes past a narrow modal's edge. *(Superseded — the flip approach still clipped the calendar's TOP inside the modal body's `overflow:auto`; see the Tier A "date-picker calendar clipped inside the modal" entry for the portal fix.)*
- ✅ **Insights dashboard was demographic-only — silent on memory, depth, and time.** The view shipped 11 panels, all headcount/dates/places, and never touched the qualitative archive it exists to celebrate (a gap `inspector.js`'s own "most stories / latest addition / oldest ancestor" comment had flagged as unbuilt intent). Added four additions computed from data already on file — no schema change: **Living generations** (living-only span, the number a family actually feels), **Years documented** (earliest–latest birth year, free off the decade pass), **Stories preserved** (count + recurring story-tag chips — the one qualitative stat, on-brand for a heritage app), and **Then & now** (earliest-born ancestor + newest-added member, filling two of the unbuilt inspector intents). All reuse the existing card/masonry/chip CSS (zero new CSS); cards/panels omit themselves when their data is absent so a sparse tree never shows a "0 · 1990–1990" span. A `>=` tie-break on `createdAt` keeps "newest addition" from colliding with "earliest ancestor" on the all-at-once-seeded sample tree. (this commit)
- ✅ **Clipboard + blob-download logic reimplemented per-caller.** Three separate clipboard routines (`sharing.js` copy-link, `collect-form.js` copy-JSON, `help-page.js` copy-tile-link) each carried their own `navigator.clipboard` → hidden-`textarea`/`execCommand` fallback, and `image-export.js` had its own blob→anchor→`revokeObjectURL` download. Folded into two shared primitives: a new `UI.copyText(text) → Promise<boolean>` (async clipboard with the legacy fallback, resolves false on total failure) and a generalised `UI.downloadFile` that now accepts a `Blob` as well as a string/JSON payload. Each caller keeps its own success/fail UX (toast copy, `.is-copied` button flash, `helpToast`, `window.prompt` last-resort) but no longer reimplements the mechanics. Net −6 lines; the win is one code path to get right. (this commit)

### Tier D — Low

- ⛔ **`__addAsParentOf` seed leaking into saved record.** Verified false — the save handler builds the payload explicitly with named fields.
- ⛔ **CDN_SHELL opaque-response concerns.** Verified false — Google Fonts + Font Awesome serve glyph files with permissive CORS, so `mode: "no-cors"` precaching of the CSS works.
- ⛔ **In-memory PhotoStore fallback cross-tab sync.** Closed — the fallback runs only when IndexedDB is unavailable, essentially never on shipped browsers.
- ✅ **Density chip overlapping the photo at deep zoom-out.** Hard-pinned at fixed coordinates relative to the photo ring; never overlaps the photo itself, only floats outside the ring at any zoom.

---

*Last updated 2026-08-18. Tiers reflect impact priority across all four audit rounds + user-reported issues.*
