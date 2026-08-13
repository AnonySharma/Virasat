# Virasat — UX audit backlog

Source: an 8-agent max-effort UX audit (2026-08-11) across accessibility/i18n,
header/nav/IA, onboarding/empty states, the person form, the tree canvas,
sharing/collaboration/account, mobile/responsive, and timeline/people views.
**59 findings total** (16 high, 32 medium, 11 low).

Each finding is verifiable against source at the cited `file:line`. Effort tags:
**S** = small (one rule / a few lines), **M** = medium (new copy + a component
change), **L** = large (broad sweep).

> **Progress:** every finding from the original 8-agent audit has now shipped on
> `feat/cloud-sync` (batches 1–5, below). **The original backlog is fully
> cleared.** Everything is collected in **[✅ Shipped](#-shipped)** at the bottom
> of this file. **CACHE_VERSION is deliberately not yet bumped** — held until the
> rest of the queued changes land. A fresh deep UX + usability review is being
> run to surface anything new; net-new findings will be appended under
> **[Follow-up review](#follow-up-review-2026-08-12)** as they come in.

---

## Original audit — fully cleared ✅

All 59 findings across the eight audit areas (Accessibility & i18n, Header/nav/IA,
Onboarding & empty states, Person form, Tree canvas, Sharing/collaboration/account,
Mobile & responsive, Timeline & people) have shipped. See **[✅ Shipped](#-shipped)**
for the per-batch record. The final tranche (Batch 5) closed the last open items:
inline person-form validation, birth<death / no-future date checks, name-or-name_hi,
Essentials/More-details grouping, labelled/conditional date-precision, kebab &
hamburger `aria-expanded`/focus/arrow-keys, debounced header search + phone Search
row, kebab Add-person, timeline pinch-to-zoom, and the "Focus bloodline" ancestor walk.

---

## Follow-up review (2026-08-12)

*A fresh deep UX + usability review (multi-agent) is running now that the original
audit is cleared. Net-new findings — anything not already covered above — are
consolidated here, ranked by impact, each with a `file:line` anchor and an effort
tag. Except where marked ✅, nothing below is committed to yet; this is a triage
surface. A first round (data-integrity, onboarding, wayfinding, person-form,
sharing) has landed; a second round of deep UX + usability agents is running now,
and net-new items from it will be appended here as they report.*

### Data integrity (fix-now, not triage)

- **✅ [FIXED c4aed6d] A sole female/ungendered parent was silently dropped from
  the person form.** Editing someone whose only recorded parent was a mother (or an
  ungendered parent) mis-slotted her into Father positionally; the male-only Father
  filter then hid her from her own picker and the Mother filter excluded her too, so
  she showed in neither dropdown and any later edit dropped her from `parents`. Now
  slotted by actual gender, and each slot's filter always keeps its current
  occupant. `people-view.js:940-974`.
- **✅ [FIXED c4cabb6] English leaked at boot / first-run / sample moments.** The
  storage-persistence-denied toast, cloud-unreachable toast, the whole "Try sample
  family" confirm dialog + its toasts, `offerSampleData`'s not-loaded toast, and the
  first-run sample-not-loaded error were all raw English in an otherwise fully
  bilingual app — surfacing exactly when a Hindi-first user hits a failure. All now
  routed through I18n (new `sync.persistDenied/cloudUnreachable`, `rail.sample*`,
  `firstRun.sampleNotLoaded`, EN+HI). `app.js`, `first-run.js`, `i18n.js`.

### Onboarding, sign-in & empty states

- **✅ [FIXED c4cabb6] Timeline empty state was a dead end.** Unlike People and Tree,
  Timeline's empty state offered no CTA. Now shows the same "Add first person" button
  — but only when the tree is truly empty; with people-but-no-dates it keeps the "add
  birth dates" nudge. `timeline-view.js:328`.
- **✅ [FIXED — Batch 6] First-run now detects the local tree already in this browser.**
  When `familyTree.v1` holds a non-empty tree, the create-your-first-tree screen shows a
  recommended "We found a tree on this device — bring the N-person tree in" button as the
  first alt (above Import / Sample). One tap runs the existing import path (`commit` →
  `createTree` → `replaceAll` → push) with the local blob as the seed, so a returning
  local user's data becomes their first cloud tree without any file shuffling; the local
  blob is left untouched as a fallback. Reads the legacy key directly — no new
  Supabase/migration surface. `first-run.js`, `components.css`, `i18n.js`.
  *Photo backfill for imported trees is logged as a separate follow-up below.*
- **✅ [FIXED 4e06bf3] Password sign-in had no recovery path.** No "Forgot password?" link; a wrong
  password just said "doesn't match. Try again." with no next step, even though the
  magic-link ("Email me a sign-in link") button right there IS the recovery path. No
  new Supabase call needed — just cross-link them (append "…or use 'Email me a sign-in
  link' below" to the invalid-login message, or highlight that button on that error).
  `sign-in.js:136-146, 311-319, 96-99`.
- **✅ [FIXED 4e06bf3] Rail "Preserve your legacy" CTA always said data is "saved on your device"** —
  even for signed-in cloud users whose data is synced to Supabase. Unlike its siblings
  `#rail-trees-block` / `#share-btn` (gated by `CloudStore.isActive()`), this block had
  no visibility/copy gating, so a cloud user permanently saw a local-only pitch + a
  "Get started" button that just opened Export. Now gated like `refreshTreesRail()` and
  swaps to a "synced & backed up" message when signed in. `index.html:169-172`,
  `app.js:261-278`.

### Wayfinding & tree orientation

- **[M design] Generation rows have no on-canvas orientation label.** The dead
  `.tree-gen-label` CSS has been deleted (it was an HTML overlay pinned to the
  stage's left edge — it could never have tracked the SVG `viewBox` pan/zoom, so it
  would have drifted off its rows the moment you panned). A *correct* version is an
  SVG `<text>` placed in tree coordinates per generation row (`computeLayout()`
  already buckets by generation, `tree-view.js`), so it pans/zooms with the nodes.
  Open question that makes this a design call, not a mechanical fix: **what does the
  label say?** We have no semantic generation names — "Generation 1/2/3" is noise,
  and the root generation isn't necessarily the eldest. Options: a subtle left-edge
  "◆" tick per row, or a decade/era hint derived from each row's median birth year.
  Deferred pending a copy decision.
- **✅ [FIXED — Batch 6] Header/People search now has an explicit clear button.**
  Both search boxes gained a `×` button (hidden until there's text), the native
  WebKit cancel affordance is suppressed to avoid a double ×, and the People one
  stays in sync with programmatic `setSearch`/`setMissingFilter` via `syncClearBtn()`.
  `app.js`, `people-view.js`, `index.html`, `base.css`, `components.css`, `i18n.js`.

### Sharing, roles & account

- **✅ [FIXED b574759] A viewer got fake "Saved" / "Removed" feedback for writes
  that never happened.** Under read-only, `FamilyStore.add/updatePerson` return
  `null` and `deletePerson` no-ops, but the person-form save handler set
  `committed=true` + toasted "Saved" unconditionally, and the tree node-menu
  offered Edit / Add-relative / Marriage / Delete with no role check — so a viewer
  (or an editor whose role was revoked mid-form) believed a write landed when
  nothing persisted. Now: hard read-only guards at the top of `openForm()` and
  `deletePerson()`; the save handler bails with a view-only toast on a `null`
  return; the node-menu hides every mutating item behind a `canEdit` check (Focus
  actions stay for all roles); person-card Edit/Delete carry `.js-edit-only`.
  `people-view.js:467-473,1327-1334,1370-1376`, `tree-view.js:1561-1687`.
- **[S] The "Private" contact chip hides a field from *exports* but still shows it
  to in-app viewers — and its scope was implied, not stated.** With whole-blob LWW,
  viewers receive the full `data` JSONB, so a field marked private is redacted from
  JSON/PNG/poster exports yet remains visible to every member in the inspector. The
  chip's i18n leak is ✅ fixed (b574759 — title now reads "Hidden from exports (still
  visible to people with access)", EN+HI), which makes the export-only scope
  explicit. *Open product call (not a defect): whether "private" should also redact
  the value in the in-app inspector for non-owner/non-self viewers — that needs the
  viewer-redaction RPC the cloud plan deferred as a fast-follow, so it stays a
  decision, not a fix.* `inspector.js:535-547`.
- **✅ [FIXED — Batch 6, desktop] No visible offline / syncing indicator.**
  `cloud-store.js` tracked the full sync lifecycle but none of it surfaced. Added a
  derived `CloudStore.syncState()` ("synced" | "pending" | "offline") + a
  `virasat:sync-state` event (reads existing `pendingPush`/`pushing`/`navigator.onLine`
  — no new network) and a header pip that repaints off it: green *Saved*, pulsing
  gold *Saving…*, red *Offline*, `aria-live`. `cloud-store.js`, `app.js`, `index.html`,
  `components.css`, `i18n.js`. *Remaining: the pip lives in `.app-header__actions`,
  which collapses into the kebab on phone (`base.css:240`), so there's no phone
  affordance yet — see follow-up below.*
- **[S] Sync pip has no phone surface.** The Batch-6 pip is desktop-only because the
  header action row is hidden ≤768px. Phone users (the flaky-connection persona) get
  no sync cue. Options: a compact dot in the phone header (next to the kebab), or a
  "will sync when you reconnect" line in the kebab menu. No new backend — reuses
  `CloudStore.syncState()` + the `virasat:sync-state` event.
- **[M] Imported-tree photos aren't backfilled to the cloud bucket.** Surfaced while
  shipping the Batch-6 "found a tree on this device" import (and true of the existing
  file-Import path too): `commit(seed)` runs `replaceAll` + a JSON push, so the tree's
  text crosses to other devices, but the photos live only in this device's IDB. Nothing
  walks the imported `photoId`s and calls `PhotoStore.uploadPhoto()`, so a second device
  paints initials for every face until each photo is re-saved. Photos uploaded *after*
  import (via `fileToPhotoId`) sync fine — it's only the pre-existing blobs that strand.
  Fix = after a seed import, iterate `people[].photoId` (+ marriage `photoId`s), `getBlob`
  each from IDB, `uploadPhoto` any that resolve (best-effort, mirrors `fileToPhotoId`).
  **⚠ Touches Supabase Storage (the deferred Phase-4 migration surface) — do NOT action
  without explicit user direction.** `first-run.js` (commit), `photo-store.js:312,264`.
- **[M] A revoked / demoted member keeps their old access until a full reload.**
  Role is fetched once by `loadRole()` at tree load and pushed into the read-only
  guard via `applyRole()`; the realtime handler `onRemoteChange()` only ever
  re-loads the tree *data*, never the caller's role. So an editor demoted to viewer
  (or removed) mid-session keeps editing — and only hits the RLS wall on their next
  push, landing in the conflict path. Fix = re-run `loadRole()`+`applyRole()` on the
  realtime tick / poll, or subscribe to `tree_members`. **⚠ Touches Supabase realtime
  wiring — do NOT action without explicit user direction.** `cloud-store.js:140-150,
  85-93,260-268`.
- **[S] No "leave this tree" for a shared-in member.** A viewer/editor can't remove
  themselves from someone else's tree — only the owner can revoke (`revoke_access`
  is owner-checked). A relative who no longer wants access is stuck. Needs a new
  owner-independent `leave_tree()` SQL RPC + a button in the account/tree UI.
  **⚠ Requires a new SQL RPC — do NOT action without explicit user direction.**
  `sharing.js:202-218`, `tree-list.js`.
- **✅ [FIXED — Batch 6] A pending invite couldn't have its link re-copied per-row.**
  Pending rows now carry an owner-only "copy invite link" button (reuses
  `copyLink()` + `appLink()`, with the same `.is-copied` feedback as the global one);
  no backend change. New `share.copyInviteLink` (EN+HI). *(Automatic re-send of the
  invite email would need a Supabase call and is out of scope for this no-backend
  pass.)* `sharing.js`, `components.css`, `i18n.js`.
- **✅ [FIXED — Batch 6] An invitee who signs up with the wrong email landed on the
  blank create-tree screen with no clue an invite exists.** `claim_invites` matches
  by `auth.email()` (citext); a mismatch claims nothing and first-run shows "Create
  your first family tree" with the shared tree invisible. There's no reliable signal
  to *detect* the mismatch (their email matches no invite precisely because it's the
  wrong one, and the app link carries no invite marker), so rather than a false "we
  found your invite" we added a quiet footnote stating the email-matching rule and
  showing which address they're on — the topbar already carries the sign-out escape
  hatch. New `firstRun.inviteHint` / `inviteHintNoEmail` (EN+HI). `first-run.js`,
  `components.css`, `i18n.js`.

### Person form (net-new, post-rework)

- **✅ [FIXED a53426a] The date picker was 100% hardcoded English — never routed through I18n.**
  Every string in `HeritagePicker` was a literal: input/trigger/dialog aria-labels
  (`heritage-datepicker.js:81,89,92`), prev/next month (`97-98`), the MONTHS /
  WEEKDAYS arrays (`15-16`, which drive the calendar title *and* each day's
  aria-label at `205`), "Year only" (`109`), "Today" (`113`), "Clear" (`117`). A
  Hindi user opened this 2×/person and saw English chrome + month names. Now all
  nine literals + localized month/weekday names route through I18n (`datePicker.*`).
- **✅ [FIXED 7bda118] No "Save & add another".** After each add the modal closed and the tree
  panned / Inspector opened (`people-view.js:1323-1326`), forcing a full context
  switch per person — painful for the 30-relatives-in-one-sitting persona. A
  footer "Save & add another" now saves then reopens a blank form, skipping the
  reveal/pan for that path.
- **✅ [FIXED — Batch 6] Every twin (EN+HI) field paid the two-column card cost even
  when Hindi was never used.** `pair()` now starts the Hindi half collapsed behind a
  "+ हिन्दी" toggle that expands in place, unless it already holds a value (editing)
  or the UI is in Hindi — mirroring `moreDetails`' content-keyed disclosure. Solo
  mode drops the dashed-card chrome so an English-only field reads as a plain field.
  `people-view.js`, `components.css`, `i18n.js`.
- **✅ [FIXED 33c9905] Enter never submitted the form.** The modal body is a plain `<div>`, not a
  `<form>` (`dom.js:189-198`), and `openModal` only handled Escape/Tab (`157-186`);
  single-line inputs had only `oninput` (the `required` on `nameInput` was inert).
  A new `openModal({onEnter})` hook now clicks Save when focus is in a single-line
  input (excluding textareas and the date popover's own Enter-commit).
- **✅ [FIXED 33c9905] Hidden death-precision picker left a dead 130 px gutter.** The row was a
  fixed `grid-template-columns: 1fr 130px` (`people-view.js:742`); hiding the
  precision child via `display:none` (`734-738`) didn't collapse the track, so
  every living person showed an empty 130 px hole beside the death-date input.
  The row now collapses to a single column when the picker is hidden.

---

## Round 2 review (2026-08-12) — 10-agent deep sweep, triaged

A second, larger review pass (10 agents: onboarding/auth, tree canvas, sync/trust,
mobile-a11y, data-entry, content/tone, wayfinding, first-run journey, person-form,
nav-sharing). Every item below was **re-verified against current source** before
logging; a few agent claims were **rejected** (noted inline) as already-shipped or
factually wrong. Grouped by actionability. Nothing here is committed yet except where
marked ✅.

**Rejected on verification (logged so they aren't re-raised):**
- *"PathFinder is 100% hardcoded English / zero I18n calls"* (ux-forms, ux-content-tone)
  — **false.** `path-finder.js` has 11 `I18n.t` calls; every string routes through the
  `path.*` namespace (shipped in `e075b47`). Only the *distinct* valid part —
  `FamilyStore.relationLabel` returning hardcoded English relation words
  (`data-store.js:821-845`) — is logged below.
- *"Password sign-in has no recovery path"* re-raised — already ✅ `4e06bf3` (magic-link
  cross-link). The **separate** net-new ask (an actual `resetPasswordForEmail` flow) is
  logged under Supabase below.

### i18n leaks (confirmed defects — no backend, no design judgment)

Several agents independently found large untranslated surfaces in an otherwise
bilingual-first app. All confirmed by direct `grep`/read. This is a mechanical sweep
(route literals → `I18n.t`, add EN+HI keys), the same treatment already applied to the
date picker / PathFinder / person form.

**✅ CLUSTER CLEARED (Batch 7).** Every confirmed leak below is shipped. The one
remaining sub-item is the collect-form questionnaire *titles* (⚠ PARTIAL) — deferred
because they double as CSV import headers, so it's a data-contract decision, not a
mechanical sweep.

- **✅ [FIXED 319cb76] Marriage / wedding-details modal — 0 `I18n.t` calls across ~325 lines.**
  `showMarriageModal` (`tree-view.js:1215-1539`): title, empty-state copy, Date/Place/Story
  labels + placeholders, Edit/Add-details/Close, edit-mode labels, Add/Replace/Remove photo,
  Cancel/Save, the "Forget this marriage record?" delete-confirm, and both toasts. Confirmed
  0 matches. The node-menu entry that opens it *is* translated, so the mismatch is jarring.
  **Most-cited finding (4 agents).** New `marriage.*` keys (EN+HI, incl. interpolated title).
- **✅ [FIXED 2633348] Story editor — 0 `I18n.t`.** `openStoryEditor` (`inspector.js:609-681`):
  titles, placeholders, Title/Story/Tags labels+hints, the delete-confirm (which splices a
  person's name into a raw English sentence), validation + success toasts. New `inspector.story*`
  (Cancel/Save/Delete reuse `actions.*`).
- **✅ [FIXED 2633348] Inspector "Family highlights" empty panel — hardcoded.** `renderHighlights`
  (`inspector.js:88-199`): "Welcome", the add-first-relative copy, "Family highlights",
  the 4 card labels (Oldest ancestor / Latest addition / Most stories / Next memorial),
  their interpolated footers (Born {year} / Added {when} / {n} story/stories / today/tomorrow/
  in {n} days), "Family archive" + its 3 legend counts. This is the **default first-paint panel**
  and what reappears after every deselect. New `highlights.*` namespace.
- **✅ [FIXED 19f2461] Crop / reframe modal chrome — 0 `I18n.t`.** `crop-editor.js`: "Avatar
  (round)", "Hero (wide)" (each built twice — initial + reset-rebuild — now via one `I18n.t`),
  the instructional hint, per-frame zoom aria-label, "Reset both", "Save crops", "Reframe photo"
  title, Cancel. New `crop.*` namespace.
- **✅ [FIXED 19f2461] PrintBook — 0 `I18n.t`.** `print-book.js`: guard toast, cover eyebrow,
  "Printed {date}", per-person section headers (About/Achievements/Education/Stories/Notes), and
  the "Born in {place}" / "Died in {place}" lifespan lines. New `print.*` (kept independent of
  `inspector.sec*` so the heirloom export can be worded/styled on its own). *(The photo-`await`
  race the cloud plan flagged for this file was already fixed — `open()` preloads every
  `getUrl` before `window.print()`.)*
- **⚠ [PARTIAL 19f2461] Collect-via-form questionnaire — English-only.** `collect-form.js`: the
  two file-local error toasts ("Copy failed" / "Read failed") are now i18n'd (`collect.copyFailed`
  / `readFailed`). **Deferred:** the 13 `formQuestions()` titles (`:98-115`). They double as the
  Google-Form question titles **and** the CSV column headers `importCsvText` matches on
  (`row["birth date"]`, `row["father's name"]`, …, exact-match after `normalizeHeader`).
  Localizing the titles without expanding the importer's header-alias sets in lockstep would
  break the CSV round-trip — a data-contract change, **not** a mechanical i18n sweep. Needs a
  design decision: either (a) keep the machine-facing headers English + add a separate localized
  *display* label per question, or (b) add HI aliases to every `row[...]` lookup. Logged for the
  user to decide.
- **✅ [FIXED 2633348] Inspector date-precision reimplemented in English + hardcoded " yrs".**
  `buildPersonalInfo`'s local `withPrecision()` now routes the c./before/after prefixes through
  the existing `date.circa/before/after` keys (passing the formatted date as `{year}`); the
  hardcoded `" yrs"` lifespan suffix became `inspector.years` "{n} yrs".
- **✅ [FIXED 2633348] Inspector "Contact" section title was a bare literal** (`inspector.js:324`)
  while every sibling section uses `I18n.t("inspector.secXxx")`. Added `inspector.secContact`.
- **✅ [FIXED 319cb76] Tree-rename dialog hardcoded** (`tree-view.js:149-177`) — title, body,
  "Tree title" label, placeholder, Cancel/Save (with explicit English overrides), "Renamed"
  toast. Reused the tree-switcher's existing `tree.renameTitle/nameLabel/namePlaceholder/renamed`
  + `actions.cancel/save`; added only `tree.renameBody` for the explanatory paragraph the
  switcher's compact prompt lacks.
- **✅ [FIXED 5762bab] Kebab menu mixes hardcoded rows** (`app.js:443,468,470,473`): "Light/Dark
  mode", "Collect via form", "Import", "Export" sat among already-i18n'd rows. Routed through
  `actions.*` — reused `collectVia/import/export`; added `actions.lightMode/darkMode`.
- **✅ [FIXED 5762bab] Rail "Needs attention" nudges hardcoded** (`app.js:930-932`): Missing
  birth date / photo / description. The `people.missing*` keys turned out to be sentence
  fragments ("a birth date") built for the People banner, so they read wrong as standalone
  labels — added dedicated `rail.needsBirth/needsPhoto/needsDescription` instead.
- **✅ [FIXED e5a586c] `relationLabel` returns hardcoded English** (`data-store.js:821-845`) —
  father/wife/daughter etc.; surfaces in PathFinder hops. New `relation.*` namespace (EN+HI)
  with an English fallback if I18n hasn't loaded (matches the adjacent `dateT()` idiom). The
  hop chips are standalone (avatar → word → avatar), so bare HI nouns fit without grammar. (The
  real, deduped remainder of the rejected "PathFinder i18n" claim.)
- **✅ [FIXED e5a586c] Generic "X failed: {raw error}" toasts** at 5 sites (`app.js` reset +
  sign-out; `export-import.js` PNG/JSON/backup/import) spliced the raw network-/lib error into a
  relative's toast — same defect class as the `friendly()` leak. Each now shows a localized
  friendly message (`exp.exportFailed/backupFailed`, `imp.importFailed`, `rail.resetFailed`,
  `auth.signOutFailed`) and `console.warn`s the raw error.
- **✅ [FIXED 5762bab] `friendly()` leaks raw Supabase strings.** `sign-in.js:327` — the
  fall-through `return msg || t("auth.errGeneric", …)` showed the **raw** error for anything not
  matching its 4 substrings (e.g. "For security purposes, you can only request this after 46
  seconds", "Password should be at least 6 characters") to a non-technical relative. Inverted:
  always prefer the friendly generic; `console.warn` the raw. Also matched the "for security
  purposes" rate-limit phrasing.
- **✅ [FIXED 5762bab] No "email not confirmed" branch in `friendly()`** (`sign-in.js:311-319`) —
  signing in before confirming funnelled into the generic catch-all with no "check your inbox"
  hint. Added a branch (new `auth.errUnconfirmed`) mirroring the invalid-login/rate-limit/network
  ones.

### Accessibility (mostly no-backend; a couple need a design nod)

- **✅ [FIXED a426446] Tree per-node menu is keyboard-inoperable.** `showNodeMenu`/`dismissMenu`
  (`tree-view.js`) never `.focus()` into the `role="menu"`, had no Arrow/Home/End roving, and
  didn't restore focus on close; menu items sit in DOM *after* the whole SVG, so Tab had to
  cross every node/knot to reach them. Ported the header-kebab pattern: `dismissMenu(restoreFocus)`
  tracks `menuReturnFocus`, `showNodeMenu` focuses the first item on open, `onDocKey` roves
  Arrow/Home/End over `.tree-node-menu__item`, and Escape closes + restores focus to the trigger.
  **(2 agents.)**
- **✅ [FIXED e98fa72] Mobile `#rail` / `#inspector` drawers bypass `openModal`.** Plain
  `<aside>`s toggled by class from several sites (`app.js` hamburger / person-select /
  lineage-focus / view-switch): no Escape-to-close, no `role="dialog"`/`aria-modal`, no focus
  move-in when opened from a tree-node tap. Rather than touch each toggle site, a
  `MutationObserver` reconciles dialog semantics off the live classes — a drawer is modal exactly
  while `.is-open` **and** the scrim `.app-overlay.is-on` is up (raised only by the mobile open
  paths, so desktop's persistent columns are untouched). Adds `role`/`aria-modal`/`aria-label`,
  moves focus in, restores it to the opener on close; one capture-phase keydown does Escape +
  Tab-trap and yields when an `openModal` dialog is stacked on top. New `actions.menuDialog` /
  `detailsDialog` (EN+HI). **(use-mobile-a11y.)**
- **✅ [FIXED 167e2d7] SVG viewBox never follows keyboard focus.** Tabbing to an off-screen
  `.t-node` (focusable in DOM order, not screen order) moved focus outside the visible viewBox
  with no pan and no cue. New `panIntoView(personId)` on the node's `onfocus` scrolls the viewBox
  minimally to bring an out-of-view node in while preserving the current zoom; no-ops when the
  node is already visible or a pointer gesture is active. Reuses `lastPositions` (the same map
  `revealPerson` pans from). **(use-mobile-a11y, ux-wayfinding.)**
- **✅ [FIXED a426446] `revealPerson()` pans/selects but never focuses the node**
  (`tree-view.js`) — a keyboard user bounced to Tree via reveal-in-tree landed with DOM focus
  elsewhere. `revealPerson` now `.focus()`es the node `g` at the end; infra was already there.
- **✅ [FIXED 3bc6b32] Crop drag surface is a keyboard dead-end.** `.crop-frame__inner`
  (`crop-editor.js`) had no `tabindex`/`role`/`keydown` — the zoom slider worked, but the
  focal point could never be moved by keyboard. Now `tabindex=0` + `role="application"` +
  `aria-label` (new `crop.dragAria`, EN+HI), with an arrow-key nudge (2%, ×5 on Shift) wired
  into the existing `apply()`/`onChange()` pipeline.
- **✅ [FIXED b0ddf31] SVG hit targets under 44px on coarse pointers.** `.t-couple-knot__hit`
  (r14≈28px) and `.t-node-add-bg` (r11≈22px) — the two most-common tree-editing gestures — never
  entered the `@media (pointer: coarse)` 44px bump (which only covers `.tree-controls .btn`). Not
  a CSS fix (r is an inline SVG attr): a memoized `isCoarsePointer()` (`matchMedia`) now grows the
  knot's existing transparent hit circle to r22 and prepends a separate invisible r22 hit circle
  behind the visible add disc (glyph unchanged). Both live inside `.t-couple-knot` / `.t-node-add`,
  so the PNG-export strip removes them with their groups. **(ux-tree, use-mobile-a11y.)**
- **✅ [FIXED a426446] Marriage-knot `:focus-visible` pulse ignores `prefers-reduced-motion`.**
  The reduced-motion block (`views.css`) silenced only `:hover`, not `:focus-visible` — a
  keyboard user with reduced-motion got an infinite scale-pulse. The block now silences both.
- **✅ [FIXED a426446] Date-picker year strip has no roving tabindex** (`heritage-datepicker.js`)
  — ~155 sequential Tab stops to reach a distant birth year; the adjacent day-grid already did
  roving-tabindex. Year buttons now carry `tabindex="-1"` with one `tabindex="0"` tab-stop, and
  `onDocKey` handles year-strip Arrow/Home/End nav (before the grid early-return) mirroring the
  grid pattern.
- **✅ [FIXED 3bc6b32] Onboarding secondary copy still on `--text-3`** (~3.95:1, below AA 4.5).
  Batch 4 moved `.field__label/hint` to `--text-2` but missed the pre-auth screens. Swapped all
  seven (`.signin__tagline`, `.app-splash__msg`, `.firstrun__subtitle`, `.signin__back`,
  `.firstrun__greeting/__signout/__alt-body`) to `--text-2`. Verified in node before shipping:
  light-theme `--ink-3` was 3.68–4.16:1 (below AA); `--ink-2` clears at 8.1–9.2:1; dark theme
  both clear.

### Wayfinding & navigation (mix of fix-now and design)

- **✅ [FIXED 5007f40] "Reveal in tree" reached only 2 of 6 open-a-person paths.** `e075b47`
  wired the Inspector action-row button + PathFinder hops; the far more common Family-block
  relationship chips + Family-Highlights cards (`inspector.js`, via a new `revealInTree()` helper),
  People cards (`people-view.js` `openProfile`), and Timeline rows (`timeline-view.js` `openPerson`)
  still called bare `show()`. All four now dispatch `virasat:reveal-in-tree` first with a `show()`
  fallback. (Also covers ux-tree's "expose revealPerson as a general action.")
- **✅ [FIXED 3bc6b32] Switching trees carries stale People search/filter into the new tree.**
  `tree-list.js` `switchTo` never touched `PeopleView`'s module-level filters; no
  `PeopleView.reset()` existed. Added `reset()` (clears `searchTerm`/`filterMode`/`missingFilter`
  + the input + card cache, no render) and call it in `switchTo` **before** `switchTree()` so the
  hydrate's `notifyAll`→render paints once with cleared filters.
- **[M design] Lineage-focus mode has no representation outside Tree view.** `lineageFocusId`
  is local to `tree-view.js`; switching to People/Timeline silently drops the mental model with
  no banner/cue. Design call (how should other views reflect an active lineage focus?).
- **[S copy] "Fit view" vs "Reset view" name-collide** (worse in Hindi: "पूरा वृक्ष" vs "पूरा
  दिखाएँ") though they do different things (viewport reset vs. clear lineage-focus dim). Rename
  the lineage one ("Clear focus" / "Show everyone"). Copy decision.
- **✅ [FIXED e3d8583] People grid shows no "currently open in Inspector" indicator** — Tree
  toggles `is-selected` via `Inspector.getSelected()` but `personCard` (`people-view.js`) had no
  equivalent. Cards now carry `data-person-id`; a new `applySelection()` toggles `.is-selected`
  off `Inspector.getSelected()`, wired to run after each render and (once) on `Inspector.onSelect`.
- **✅ [FIXED e3d8583] PathFinder From/To pickers have no substring search** — `HeritageSelect`
  only did leading-character typeahead, so finding "Sunita" among a dozen S-names meant repeated
  "s" presses. Replaced with native-`<select>`-style buffered typeahead (800 ms window; prefix
  match then substring, both wrap-around; same-char repeat still cycles) + `scrollIntoView` on the
  hovered option (which was missing entirely, also affecting existing arrow nav). Benefits the
  parent/spouse pickers too.

### Data entry (mix of fix-now and design)

- **✅ [FIXED 5cccd60] Picking a spouse loses keyboard focus every time.** `HeritageSelect.pick()`
  focused the control then fired `onChange` → `rebuildSpouseRows()` whose first act is
  `clear(spouseRowsHost)`, destroying the just-focused select; focus fell to `<body>`.
  `rebuildSpouseRows(focusRow)` now collects the rebuilt pickers and refocuses the one at the
  passed index (clamped) on the next tick; every caller (pick / add / remove) passes its row index.
- **✅ [FIXED 5cccd60] A person can be set as both spouse and parent with no warning.**
  `fatherFilter`/`motherFilter` and the spouse filter didn't exclude each other's picks;
  `data-store.js` does no cross-field validation. Parent filters now exclude current spouses
  (via a live `spouseIdsNow()` to avoid a TDZ on `spouseList`) and the spouse filter excludes
  current parents; each side keeps its own current occupant, and cross-refresh helpers re-run the
  opposite side's `setOptions` on change.
- **✅ [FIXED 5cccd60] "Save & add another" from the addParent path can add an orphan 3rd parent.**
  The button reopened with the same `__addAsParentOf` seed; a 2nd/3rd "parent" was pushed onto the
  same child's `parents` (dedupe-only, no length cap) while the child's form had no 3rd slot — an
  invisible, orphaned link. `commitDraft` now caps at 2 (toasts new `form.parentsFull`, EN+HI, and
  adds without the link) and "Save & add another" drops `__addAsParentOf` from the next seed once
  the child has ≥2 parents.
- **[M design] No "create new person" from inside a relation picker.** Every parent/spouse must
  pre-exist; entering a branch "as remembered" forces abandoning the current form. Feature/design.
- **[S design] Removing a spouse / clearing a parent has no confirm and no undo** (unlike
  `deletePerson`), and the whole-form discard guard doesn't cover a single stray `×`. Design call
  (confirm vs. undo affordance).
- **✅ [FIXED a426446] Tab-trap popover exemption references a non-existent class.** `dom.js`
  checked `.hdp__pop` but the real class is `.hdp__popover`. Was a no-op (the popover's buttons
  are in-modal so the fallback scan still found them) — but a latent trap if either popover is
  ever portaled to `body` as the comment intends. Fixed the selector to the real class (also
  covers `.hsel__menu` and a `.modal-portal-exempt` escape hatch).

### Design / product calls (log, don't action — user decides)

- ✅ [FIXED a2d4ee4] **[L] Landing page has zero product visuals** for a fundamentally visual product — three
  generic FA icon tiles, no tree/photo imagery. Needs new assets. (ux-onboarding-2.)
  Rebuilt into a full intro: hero + decorative SVG family-tree mock, "How it works" 3-step
  band, "What you can capture" icon chips, kept the 3 tiles + footer. No new asset files
  (SVG mock is inline, themed via avatar tokens).
- **[M] Magic-link is buried last** below the full password form — arguably the lowest-friction
  path for the elder audience should have equal-or-higher weight. (ux-onboarding-2.)
- ✅ [FIXED f9293a4] **[S] No password-visibility (eye) toggle** on the sign-in password field; the icon-swap idiom
  already exists (`themeBtn`). Standard affordance but a UI choice.
  Added an in-field eye button (`.input-affix`) that flips type password↔text +
  swaps icon/aria-pressed/aria-label (`auth.showPassword/hidePassword`, EN+HI); tabindex=-1
  keeps the tab order field→Submit.
- ✅ [FIXED f9293a4] **[S] First-run tree-name placeholder hardcodes "Sharma"** (`first-run.js:82`,
  `i18n.js:143`) — a single-family-origins artifact now that it's multi-tenant. Neutralize
  ("e.g. Our Family Tree") or derive from the user's name. Copy call.
  Neutralized to "e.g. Our family tree" / "हमारा परिवार वृक्ष" across the tree + firstRun
  placeholders (EN+HI) and the first-run.js fallback.
- **[S] Crop tool is invisible until after upload** — auto-open `CropEditor` right after a fresh
  upload (still cancel-able) instead of requiring the easy-to-miss "Reframe" tap. (usability-newuser.)
- ✅ [FIXED e68cfba] **[S copy] "Focus descendants" vs "Focus bloodline"** offered with no inline explanation for a
  non-technical audience — add a one-line hint under each, or collapse to one with a sub-choice.
  Verified the modes are NOT duplicated (bloodline adds an upward ancestor walk); the confusion
  was jargon + roots having no ancestors to light. Relabelled "Focus bloodline" →
  "Focus ancestors & descendants" (EN+HI). Logic unchanged.
- ✅ [FIXED f9293a4] **[S] Default a new person's name to `Auth.getFirstName()`** when the tree is empty and the
  draft is unseeded — the user just typed it at sign-up. Small, friendly. (usability-newuser.)
  Guarded to the genuinely-empty case (not edit, no seeded name, `getPeople().length===0`) so
  it can't clobber a later add; no-op in local mode (`getFirstName()` → "").
- ✅ [FIXED f9293a4] **[S maintenance] `profile-view.js` (261 lines) is unreachable dead code** — both call sites are
  `else if` after an always-mounted `Inspector`; the registry never references it. It also has a
  latent date-formatting bug. Delete, or wire it up as a distinct full-page profile. (ux-forms.)
  Deleted the file (357 LOC as shipped) + its 4 references (index.html, sw.js, smoke.mjs ×2) +
  the 2 dead call-site branches.
- ✅ [FIXED c04c72e] **[S maintenance] Dead `.crop-frame__hint` CSS** (`views.css:1081-1094`) — styled, never
  instantiated (same pattern as the deleted `.tree-gen-label`). Wire the hint element or delete.
  Deleted (the live crop hint is `.crop-editor__hint`, a different class).

### ⚠ Supabase / SQL / realtime / boot-gate — do NOT action without explicit user direction

Per standing rule: these touch the live backend, auth sequencing, or the boot/sync
semantics and are logged for a decision, not fixed in this no-backend pass.

- **[High] Offline sign-out falsely promises "your tree stays saved in the cloud."**
  `signOutFlow` (`app.js:477-493`) `await`s `CloudStore.flush()`, but `push()`'s offline path
  (`cloud-store.js:190-197`) *returns* on transport failure (never rejects), so `flush()`
  resolves as if it succeeded; `stop()` then clears `pendingPush`/`treeId`, discarding all
  memory the edit was unsynced — while the confirm dialog (`i18n.js:288`) says the opposite.
  Fix needs `flush`/`push` to report whether the push actually **landed**, then block/double-warn
  sign-out when `pendingPush` persists. **Touches push/flush semantics.** (usability-collab.)
- **[High] `claim_invites` race can drop a freshly-invited relative on "create your first tree."**
  `auth-store.js`'s `onAuthStateChange` fires `notify()` (→ resolves `SignIn.show()` → boots →
  `resolveTree`) **before** the fire-and-forget `claimInvites()` inserts the `tree_members` row.
  If `resolveTree`'s "shared with me" SELECT wins the race it returns null → FirstRun. Fix: await
  `claimInvites()` before resolving sign-in / before `resolveTree`, or have FirstRun re-poll once.
  **Auth sequencing.** (usability-collab.)
- **[High] No forgot-password / reset flow exists.** No `resetPasswordForEmail` wrapper in
  `auth-store.js`; distinct from the shipped magic-link cross-link (`4e06bf3`). Needs a Supabase
  auth call + a "check your email" screen. (ux-onboarding-2, ux-firstrun.)
- **[High] Cloud/SDK-load failure silently masquerades as a normal empty tree.**
  `auth-store.js:124-130` swallows a config/SDK failure → `{cloud:false}`; `app.js:1039` then
  boots plain local-only with no toast/gate — indistinguishable from real data loss for a cloud
  user, and a new visitor never sees sign-in. Fix: when `VirasatConfig.isConfigured()` but
  `Auth.ready()` still resolves `cloud:false`, warn before `bootApp()`. **Boot-gate + auth.**
  (ux-onboarding-2.)
- **[M] Revoked/lost access is never surfaced.** `pollOnce` (`cloud-store.js:295-308`) does
  `if (res.error) return;`, swallowing the RLS-empty result identically to a network blip — the
  removed member's tab shows a stale snapshot forever. Distinguish RLS-empty from network error →
  banner + route to sign-in/TreeList. **Extends the already-logged "revoked member keeps access"
  item (reader side).** (usability-collab.) **⚠ realtime/RLS.**
- **[M] Being added to a new tree mid-session never surfaces** — `subscribe()` only watches the
  active tree's row; no channel on `tree_members` for the user's id. Even a light `listTrees()`
  poll with a toast on growth would close it. **⚠ realtime.** (usability-collab.)
- **[M] Conflict banner never attributes who/what overwrote the edit, and reuses "another
  device" wording for a same-device multi-tab collision.** Two paths
  (`data-store.js:376-400` storage event; `cloud-store.js:228-245` version-guard) fire the
  identical `sync.conflict` copy. Word them distinctly; attribution is a fast-follow needing
  editor identity. (usability-collab.)
- **[M] `CloudStore.start()` has no timeout** (unlike the 12s SDK-load guard) — a hung first REST
  fetch leaves the splash spinning forever with no retry/escape for a low-bandwidth first-timer.
  Needs a timeout→local-fallback or retry affordance. **Boot/sync.** (ux-firstrun.)
- **[S] Google OAuth cancel/error (`?error=access_denied`) is unread on boot** — nothing reads
  `location.search`; a user who declines at Google's consent screen bounces back to a pristine
  landing page with no feedback. Reading the param + a toast needs no backend but is auth-flow
  logic — grouping here for a decision alongside the other auth items. (ux-firstrun.)
- **[S] "Private" contact fields render in plain view to viewers** (not just via DevTools as the
  plan implies) — `buildContactBlock` (`inspector.js:520-549`) has no role check. **Corroborates
  the already-logged inspector-redaction item;** the safe half (relabel / disclose in the Share
  dialog that viewers see all fields) could ship without the deferred redaction RPC. (usability-collab.)

---

## ✅ Shipped

All on `feat/cloud-sync`, verified per commit (`node -c` each file, smoke green,
tsc 5.9.3 = 0 errors). `CACHE_VERSION` is now bumped once per shipped commit
(currently `v27`).

### Batch 10 — user-reported dark-mode + declutter + polish (2026-08-13)

- **[c897eb7] Dark-mode landing was hard on the eyes (user-reported).** Two defects: the jali
  lattice backdrop rendered as high-contrast noise (bright gold at 0.16/0.22 on near-black read
  far louder than light mode's olive on ivory — the dark values had been bumped the wrong way),
  and the hero gradient had been lightened to a flat mid-sage slab lighter than the rest of the
  dark UI. Calmed the lattice to 0.07/0.10 and deepened the hero to a forest jewel
  (`#1E3A2E/#162B22/#0E1C16`). Diagnosed + A/B'd live via CDP screenshots; light mode untouched.
  `components.css`, `tokens.css`.
- **[c04c72e] Decluttered the busy workspace chrome (user-reported "duplicate options").** ROADMAP
  §P3.9. Folded Collect/Import/Export into one header "Data ▾" overflow (reusing the `.kebab-menu`
  popover), leaving Share the lone primary; hid the rail "Overview" view-switcher on desktop (it
  duplicated the header tabs — kept in the phone drawer where it's the only nav); demoted "Tree
  statistics" from two number tiles to one quiet line; split the destructive tools (Try sample,
  Reset everything) below a hairline divider. Also fixed a latent header-overflow bug this
  surfaced (actions ran ~90px off-screen ~1024–1360px, clipping the new menu) — verified
  overflow-free 860–1440px via CDP. `index.html`, `base.css`, `components.css`, `app.js`, `i18n.js`.
  Deferred: folding the All/Living/Deceased Filter into per-view toolbars (a 3-view redesign of
  the global `window.Filter` API) — tracked separately.
- **[f9293a4] Approved frontend polish batch + dead-code cleanup.** Four items — see the flipped
  "Design / product calls" entries above: password reveal (eye) toggle on sign-in; default a new
  person's name to `Auth.getFirstName()` in an empty tree; deleted the unreachable
  `profile-view.js` (357 LOC) + its 4 references + 2 dead branches; neutralized the "Sharma"
  tree-name placeholder → "Our family tree" (EN+HI). `sign-in.js`, `people-view.js`,
  `timeline-view.js`, `i18n.js`, `first-run.js`, `components.css`, `index.html`, `sw.js`, `smoke.mjs`.

### Batch 8 — round-2 a11y / wayfinding / data-entry (2026-08-12)

- **[a426446] Tree node-menu keyboard nav + two more a11y fixes.** The per-node menu now
  follows the header-kebab pattern: `dismissMenu(restoreFocus)` tracks the trigger, `showNodeMenu`
  focuses the first item on open, `onDocKey` roves Arrow/Home/End over `.tree-node-menu__item`,
  Escape closes + restores focus. Same commit: `revealPerson()` now focuses the node `g`;
  the date-picker **year strip** gets roving-tabindex (year-strip Arrow/Home/End nav added to
  `onDocKey` before the grid early-return); the reduced-motion block silences the marriage-knot
  `:focus-visible` pulse (not just `:hover`); and `dom.js`'s tab-trap exemption points at the real
  `.hdp__popover` class (was `.hdp__pop`, a latent trap). `tree-view.js`, `heritage-datepicker.js`,
  `views.css`, `dom.js`.
- **[3bc6b32] Crop keyboard nudge + onboarding contrast + People reset-on-switch.** The crop
  focal point is now keyboard-movable — `.crop-frame__inner` gets `tabindex=0`/`role=application`/
  `aria-label` (new `crop.dragAria`, EN+HI) and arrow-key nudge (2%, ×5 on Shift) into the existing
  `apply()`/`onChange()`. Seven pre-auth onboarding selectors moved from `--text-3` (3.68–4.16:1,
  below AA) to `--text-2` (8.1–9.2:1) — ratios verified in node first. And `PeopleView.reset()`
  (new) is called on tree switch **before** `switchTree()`, so stale search/filter don't leak into
  the next tree. `crop-editor.js`, `styles/components.css`, `people-view.js`, `tree-list.js`,
  `i18n.js`.
- **[5cccd60] Person-form relation integrity — three fixes.** Picking/adding/removing a spouse no
  longer drops keyboard focus (`rebuildSpouseRows(focusRow)` refocuses the rebuilt picker at the
  passed index). A person can no longer be silently set as both spouse and parent — parent filters
  exclude current spouses (live `spouseIdsNow()` dodges a TDZ), the spouse filter excludes current
  parents, each keeps its own occupant, and cross-refresh helpers re-`setOptions` the opposite side.
  And "Save & add another" from the add-parent path can't add an orphan 3rd parent — `commitDraft`
  caps `parents` at 2 (toasts new `form.parentsFull`, EN+HI) and drops the `__addAsParentOf` seed
  once the child has two. `people-view.js`, `i18n.js`.
- **[5007f40] "Reveal in tree" wired into all four remaining person-open paths.** The Inspector
  relationship chips + Family-Highlights cards (new `revealInTree()` helper), People cards
  (`openProfile`), and Timeline rows (`openPerson`) now dispatch `virasat:reveal-in-tree` (with a
  `show()` fallback) instead of bare `show()`, so a name opened anywhere can land on the canvas.
  `inspector.js`, `people-view.js`, `timeline-view.js`.
- **[e3d8583] People "open in Inspector" indicator + substring typeahead in every picker.** People
  cards carry `data-person-id` and a new `applySelection()` toggles `.is-selected` off
  `Inspector.getSelected()` (after render + once on `Inspector.onSelect`), matching Tree. And
  `HeritageSelect` gains native-`<select>`-style buffered typeahead (800 ms window; prefix then
  substring, wrap-around; same-char repeat still cycles) plus `scrollIntoView` on the hovered
  option (previously missing, also fixing arrow nav) — benefiting the PathFinder, parent, and
  spouse pickers alike. `people-view.js`, `heritage-select.js`.
- **[167e2d7] SVG viewBox follows keyboard focus.** Tabbing to an off-screen node (focusable in
  DOM order, not screen order) moved focus off-screen with no pan and no cue. New
  `panIntoView(personId)` on node `onfocus` scrolls the viewBox minimally to reveal an out-of-view
  node while preserving zoom; no-ops when already visible or during a pointer gesture. Reuses
  `lastPositions`. `tree-view.js`.
- **[b0ddf31] 44px touch targets for the knot + add-relative disc.** The couple-knot hit circle
  (r14≈28px) and the add-relative disc (r11≈22px) never entered the `pointer:coarse` 44px bump
  (radius is an inline SVG attr, not CSS). A memoized `isCoarsePointer()` now grows the knot's
  transparent hit circle to r22 and prepends a separate invisible r22 hit circle behind the
  visible add disc (glyph unchanged); both are stripped from PNG export with their parent groups.
  `tree-view.js`.
- **[e98fa72] Mobile rail/inspector drawers get modal-dialog semantics.** The two panels become
  overlay drawers on phone/tablet but were plain `<aside>`s toggled by class from several sites,
  with none of the dialog behaviour every other overlay has. A `MutationObserver` reconciles
  `role=dialog`/`aria-modal`/`aria-label` + focus move-in/restore off the live classes (modal
  exactly while `.is-open` and the scrim is up — desktop columns untouched); one capture-phase
  keydown does Escape + Tab-trap, yielding to any stacked `openModal`. New `actions.menuDialog` /
  `detailsDialog` (EN+HI). `app.js`, `i18n.js`.

### Batch 9 — user-reported polish (2026-08-12)

- **[b623260] Forms-template page couldn't scroll.** `forms/family-tree-template.html` is a plain
  long document but inherited the SPA app-shell lock (`base.css`: `body{height:100dvh;overflow:hidden}`).
  Scoped override in its own `<style>` restores native page scroll. `family-tree-template.html`.
- **[5d3db7a] Timeline avatars showed broken-image icons.** `buildBarAvatar` left `src=""` on a
  `getUrl` miss → the browser's broken-image glyph. Added a `showInitials()` fallback so a failed
  async photo resolve removes the `<img>` and paints initials, matching `UI.avatar`. `timeline-view.js`.
- **[a2d4ee4] Landing page rebuilt into a full product intro.** Hero + decorative inline SVG
  family-tree mock (aria-hidden, themed via avatar pastel tokens), "How it works" 3-step band,
  "What you can capture" icon chips, kept the 3 feature tiles + privacy footer. New `landing.*`
  keys (EN+HI). `sign-in.js`, `components.css`, `i18n.js`.
- **[dea5e2b] Inspector action-row glyphs disambiguated.** Show-in-tree & Save-as-image both read
  as node graphs; share-nodes was the wrong (Share) glyph for image export; Add-note & Edit were
  two pens. Now five distinct glyphs reusing app idioms: `fa-sitemap` (tree), `fa-note-sticky`,
  `fa-regular fa-image` (matches export/photo), `fa-user-pen`, `fa-trash-can`. `inspector.js`.
- **[e68cfba] "Focus bloodline" relabelled.** Confirmed the two focus modes are NOT duplicated
  (bloodline adds an upward ancestor walk); the confusion was jargon + roots having no ancestors
  to light. Renamed to "Focus ancestors & descendants" (EN+HI); logic unchanged. `tree-view.js`,
  `i18n.js`.

### Batch 7 — round-2 10-agent review, i18n defect cluster (2026-08-12)

- **[5762bab] Auth-error hardening + kebab/rail localization.** `sign-in.js`'s `friendly()`
  no longer surfaces raw Supabase English (inverted fall-through → friendly generic +
  `console.warn` the raw); added an "email not confirmed" branch (`auth.errUnconfirmed`) and
  the "for security purposes" rate-limit phrasing. Phone kebab rows (Light/Dark mode, Collect
  via form, Import, Export) routed through `actions.*` (reused `collectVia/import/export`;
  added `lightMode/darkMode`). Rail "Needs attention" rows got dedicated
  `rail.needsBirth/needsPhoto/needsDescription` (the `people.missing*` keys are sentence
  fragments, not reusable as labels). `sign-in.js`, `app.js`, `i18n.js`.
- **[319cb76] Marriage/wedding-details modal + tree-rename dialog i18n'd.** The round-2
  most-cited leak (4 agents): `showMarriageModal` ran ~325 lines with 0 `I18n.t` calls — every
  string (interpolated title, empty state, field labels + placeholders, photo alt, all buttons,
  the delete-confirm, both toasts) now routes through a new `marriage.*` namespace (EN+HI). The
  tree-rename dialog, which duplicated the tree-switcher's flow but hardcoded its copy, reuses
  the existing `tree.renameTitle/nameLabel/namePlaceholder/renamed` + `actions.cancel/save`,
  adding only `tree.renameBody`. `tree-view.js`, `i18n.js`.
- **[2633348] Inspector i18n sweep — 4 leaks.** The story editor (`openStoryEditor`: titles,
  placeholders, labels+hints, the name-splicing delete-confirm, validation + toasts → new
  `inspector.story*`); the "Family highlights" default empty panel (`renderHighlights`: Welcome,
  eyebrow, the 4 interpolated cards + Family-archive legend → new `highlights.*`); date-precision
  `withPrecision()` (reused `date.circa/before/after`; `" yrs"` → `inspector.years`); and the
  bare "Contact" section title (`inspector.secContact`). Also routed the save-image catch's raw-
  error `"Failed"` fallback through `inspector.imageFailed` + `console.warn`. `inspector.js`,
  `i18n.js`.
- **[19f2461] Crop editor + print book + collect toasts i18n'd.** Crop/reframe modal chrome
  (frame labels, hint, zoom aria, Reset/Save/title/Cancel → new `crop.*`); the print "family
  book" export (guard, cover eyebrow, "Printed {date}", Born/Died-in lines, 5 section headers →
  new `print.*`); and collect-form's two file-local error toasts (`collect.copyFailed/readFailed`).
  Collect's `formQuestions()` titles were left English — they double as CSV headers the importer
  matches on; localizing needs a data-contract decision (logged above). `crop-editor.js`,
  `print-book.js`, `collect-form.js`, `i18n.js`.
- **[e5a586c] Relation labels + failure-toast raw-error leaks.** `FamilyStore.relationLabel`'s
  10 hardcoded relation words (PathFinder hop chips) → new `relation.*` (EN+HI, English
  fallback). The five "X failed: {raw}" toasts (export PNG/JSON/backup, import, reset, sign-out)
  now show localized friendly messages + `console.warn` the raw — closing the same leak class as
  the sign-in `friendly()` fix. This clears the **entire round-2 i18n defect cluster.**
  `data-store.js`, `export-import.js`, `app.js`, `i18n.js`.

### Batch 6 — follow-up review, round 1 (2026-08-12)

- **[c4aed6d] Sole female/ungendered parent dropped from the person form.** Slotted
  by actual gender; each slot's filter always keeps its current occupant.
  `people-view.js`.
- **[c4cabb6] Boot / first-run / sample strings routed through I18n.** The
  persistence-denied + cloud-unreachable toasts, the whole "Try sample family"
  confirm + its toasts, and the first-run sample error were raw English; all now
  bilingual (new `sync.*`, `rail.sample*`, `firstRun.sampleNotLoaded`).
  `app.js`, `first-run.js`, `i18n.js`.
- **[c4cabb6] Timeline empty state gained the "Add first person" CTA** (only when
  truly empty; the add-dates nudge stays otherwise). `timeline-view.js`.
- **[b574759] Viewers no longer get fake "Saved"/"Removed" feedback.** Every edit
  path (person-form save, tree node-menu Edit/Add/Marriage/Delete) is role-gated;
  the inspector contact block is fully i18n'd. `people-view.js`, `tree-view.js`,
  `inspector.js`.
- **[e075b47] "Open in tree" wayfinding.** New all-roles inspector action + every
  PathFinder hop now fire a `virasat:reveal-in-tree` event → `activate("tree")` +
  `TreeView.revealPerson`, so a name found anywhere can be located on the canvas.
  PathFinder is also fully i18n'd (was hardcoded English). `inspector.js`,
  `path-finder.js`, `app.js`, `i18n.js`.
- **[33c9905] Person form: Enter submits** from any single-line input (not
  textareas / popovers / the date picker), via a new `openModal({onEnter})` hook;
  the empty death-date precision gutter now collapses instead of leaving a blank
  column. `dom.js`, `people-view.js`.
- **[a53426a] Heritage date picker i18n'd** — was 100% hardcoded English (month /
  weekday names, all labels, the title, day aria-labels); now driven by a
  `datePicker.*` namespace with EN + HI, incl. localized MONTHS/WEEKDAYS arrays.
  `heritage-datepicker.js`, `i18n.js`.
- **[4e06bf3] Sign-in recovery cross-link + cloud-aware rail CTA.** A wrong password
  now points at the magic-link button (message append + a one-time pulse on that
  button); the "Preserve your legacy" rail CTA swaps to a "synced & backed up"
  message for signed-in cloud users instead of the local-only pitch. `sign-in.js`,
  `app.js`, `index.html`, `components.css`, `i18n.js`.
- **[7bda118] Person form: "Save & add another."** A third footer button commits the
  current person and reopens a blank form (shared `commitDraft()` so it can't drift
  from Save), for fast bulk entry. `people-view.js`, `i18n.js`.
- **[8678481] Long-press node-menu touch cue.** A coarse-pointer-only,
  localStorage-gated one-time toast tells phone users press-and-hold opens the node
  menu; the desktop pan-hint already mentions right-click. `tree-view.js`, `i18n.js`.
- **[this batch] Dead `.tree-gen-label` CSS deleted** — a never-wired HTML overlay
  that could never have tracked the SVG viewBox. A correct SVG-space version is
  logged as a design item above. `views.css`.
- **[this batch] Search clear (×) button** on both the header search and the People
  searchbar — hidden until there's text, suppresses the native WebKit cancel to
  avoid a double ×, stays in sync with programmatic `setSearch`. `app.js`,
  `people-view.js`, `index.html`, `base.css`, `components.css`, `i18n.js`.
- **[this batch] Hindi twin fields collapse behind a "+ हिन्दी" toggle.** English-only
  entry no longer pays the padded two-column card cost on every twinned field; the
  Hindi half expands in place, and starts open when it has a value or the UI is
  Hindi. `people-view.js`, `components.css`, `i18n.js`.
- **[this batch] Per-row copy-invite-link on pending invites.** Owner-only, pending-
  only link button on each invited-but-not-signed-in row, so the owner can nudge that
  specific invitee; reuses `copyLink()`+`appLink()`. `sharing.js`, `components.css`,
  `i18n.js`.
- **[this batch] Header sync pip (desktop).** `CloudStore.syncState()` +
  `virasat:sync-state` event drive a Saved / Saving… / Offline chip in the header —
  reads existing dirty/push/online flags, no new backend. Phone surface logged as a
  follow-up. `cloud-store.js`, `app.js`, `index.html`, `components.css`, `i18n.js`.
- **[this batch] Wrong-email invitee first-run footnote.** A quiet note on the
  create-your-first-tree screen stating that invites open only for the exact invited
  email and showing which address the user is on — so a mismatched invitee has a clue
  instead of an invisible shared tree. `first-run.js`, `components.css`, `i18n.js`.
- **[this batch] First-run detects a tree already on this device.** A returning
  local-only user (used Virasat before making an account) now sees a recommended
  "We found a tree on this device — bring the N-person tree in" button on the
  create-your-first-tree screen, placed first among the alts. It reuses the exact
  file-import path (`commit` → `createTree` → `replaceAll` → push) reading the legacy
  `familyTree.v1` key directly, and leaves the local blob in place as a fallback. No
  new Supabase/migration surface — it's the shipped import path with a local seed.
  `first-run.js`, `components.css`, `i18n.js`. *(Photo backfill for imported trees is
  a separate follow-up — see below.)*

### Batch 5 — final backlog clear (2026-08-12)

- **[a3538bd] Person form — inline validation + aria.** Save errors are no longer
  a transient polite toast: each renders into a `role="alert"` `.field__error`
  span tied to its control via `aria-describedby`, with `aria-invalid` +
  `.is-invalid` styling that clears as you edit. `people-view.js`, `components.css`.
- **[a3538bd] Person form — accept a Hindi-only name.** A record saves when
  *either* `name` or `name_hi` is set; a blank Latin field resolves `name_hi` into
  the stored name, so Hindi-only recorders aren't forced to romanise. `people-view.js`.
- **[a3538bd] Person form — date sanity checks.** Birth can't follow death, and
  neither can be in the future (compared by year so a bare "YYYY" isn't
  falsely flagged); new `form.dateOrderInvalid` / `dateFutureInvalid`. `people-view.js`.
- **[a3538bd] Person form — Essentials vs More details.** The ~15 fields split into
  an always-visible Essentials block (photo, name, dates, gender) and a collapsible
  `<details>` "More details" (auto-open on edit when it holds data); a death-date
  error opens it before focusing. `people-view.js`.
- **[a3538bd] Person form — labelled + conditional date precision.** The precision
  dropdowns carry `aria-label`s (`form.datePrecisionLabel`) and the death-precision
  control hides beside a blank/"living" death date. `people-view.js`.
- **[a3538bd] Kebab & hamburger a11y.** Both toggle `aria-expanded` on every
  open/close route; the kebab moves focus to the first item on open, restores to
  the anchor on Escape, and has ArrowUp/Down/Home/End roving focus, all funnelled
  through one `closeKebabMenu()`. `lib/app.js`.
- **[a3538bd] Softer header search + phone fallbacks.** The auto-switch to People
  is debounced 400 ms and re-checks text still remains (a stray keystroke no
  longer yanks you off your view; filtering stays live); the phone kebab gains
  the two actions that vanish on small screens — **Add person** (edit-gated) and
  **Search people** (switches to People and focuses its searchbar). `lib/app.js`.
- **[225692a] Timeline pinch-to-zoom.** Two fingers scale px/year like the +/-
  buttons, anchored on the gesture midpoint so the year under your fingers stays
  put; rAF-throttled, persisted on release; `touch-action:pan-x pan-y` keeps
  one-finger scroll native. `timeline-view.js`, `views.css`.
- **[803b00a] Tree "Focus bloodline".** A second node-menu focus item that walks
  *up* the direct ancestor line as well as down (descendants-only stays the
  default for taps + transient selection). `tree-view.js`, `i18n.js`.

### Batch 1–2 (2026-08-11 → 08-12)

- **[11f433d] Timeline** — square/open right-end for living bars + a
  living/deceased legend.
- **[1a03083] Self-profile editor** — update your display name from the account
  menu; the account avatar now uses your name, not email initials.
- **[375c659] Header Share** — a real owner-only invite button promoted into the
  header, Export demoted from primary, and the misleading "Share as image"
  renamed to "Save as image" (EN+HI).
- **[11f433d] 6 verified bugs** — dead living/deceased chip classes; typed dates
  silently lost unless you press Enter; sign-up "check your email" note wiped
  instantly; no discard-guard on the person form; timeline bars clipped under the
  sticky name column; the translated view-only banner never rendered.
- **[5f9de57] 5 top gaps** — invisible add-child/spouse/parent (per-node
  add-relative "+" affordance, stripped from PNG/print exports); no active-tree
  name in the shell (now in the header sub-line); Hindi leaks (i18n sweep of the
  person form — placeholders, hints, empty states, precision options, toasts); the
  invisible keyboard focus ring (solid `--olive` ring + halo, meets 3:1); invites
  with no delivery path (app-link row + copy button in the sharing dialog).

### Batch 4 — a11y / i18n / responsive sweep (2026-08-12)

- **Contrast (SC 1.4.3).** `.field__label` / `.field__hint` moved from `--text-3`
  (3.95:1) to `--text-2` (8.7:1). `styles/components.css`.
- **Inspector disclosure `aria-expanded`.** Each collapsible section head now sets
  `aria-expanded` at creation and updates it on toggle, and `aria-controls` points
  at the body (`id`ed per section). `lib/components/inspector.js`.
- **Tree control i18n.** Zoom in/out, View options, Fit view, and the Rename-tree
  pen route their `aria-label`/`title` through `I18n` (new `tree.viewOptions`,
  `tree.fitView`). `lib/views/tree-view.js`.
- **Header icon-button names i18n.** Hamburger, theme, language group, Collect,
  kebab, and inspector-close carry `data-i18n-title` / `data-i18n-aria-label` so
  their tooltips/accessible names translate (new `actions.openMenu`,
  `moreActions`, `closeDetails`, `searchPeople`, `collectVia`). `index.html`.
- **Icon-only collapse for the 769–1100 px band.** `.btn__label-md` hides and the
  header search shrinks to 180 px in the existing `≤1100 px` media block, so the
  header stops crowding before the ≤768 kebab takes over. `styles/base.css`.
- **Phone kebab scroll + safe area.** `max-height` bounded to the space under the
  header minus the bottom inset, `overflow-y:auto`. `styles/components.css`.
- **Tree overlay buttons ≥44 px on touch.** `.tree-controls .btn` gets a 44 px
  min hit area under `@media (pointer:coarse)` (halo/glyph unchanged). `views.css`.
- **Header top safe-area inset.** A derived `--header-total` (bar + `env(safe-area
  -inset-top)`) drives the header height/padding and every fixed panel offset
  (body height, rail/inspector `top`, overlay inset, kebab cap), so content clears
  the notch in the installed PWA with the offsets kept in sync. `tokens.css`,
  `base.css`, `components.css`.
- **Date popover fits + flips.** Width clamped to `min(320px, 100vw - 32px)`; a
  measured `.hdp--up` opens it upward when it would clip at the bottom of the
  phone bottom-sheet. `styles/components.css`, `lib/components/heritage-datepicker.js`.
- **Timeline TODAY label i18n.** The now-line marker is a real localized span
  (`timeline.today`) instead of a CSS `content:"TODAY"`; the px/year chip uses
  `timeline.pxPerYearShort`. `lib/views/timeline-view.js`, `styles/views.css`.
- **Add child/spouse/parent modal titles** — verified already routed through
  `I18n.t(inspector.add*)` with HI keys present; no change needed.

### Batch 3 (2026-08-12)

- **[cdefb5d] Timeline & people — lifespan i18n + clickable name.** "present" and
  the date-precision markers (`common.present`, `date.circa/before/after`) now go
  through I18n in the shared `data-store` lifespan formatter, so Hindi
  timelines/cards no longer read "1950–present" / "c. 1950". The timeline's sticky
  name column is now a real button (`role=button`, `tabindex=0`, keyboard) so
  off-screen bars are still openable.
- **[c2d73ca] People view — filter-aware search, result count, i18n finish.**
  Search now respects the active Living/Deceased filter (shared `matchesFilter`);
  the header sub-line reports a live result count while searching or filtering
  (`people.result{One,Many,None}`); the last hardcoded English (search + story-card
  aria-labels, untitled-story title, Reframe, remove-spouse) routes through I18n.
- **[c1e1692] Sharing — safe default + explained roles.** Invites default to
  view-only (viewer option listed first), and a one-line `share.roleHelp` explains
  the two roles under the select.
- **[b716722] Tree canvas — menu clamp, marriage entry, pet gating, collisions.**
  Node menu measures and flips/clamps within the stage so bottom/edge nodes keep
  all items (incl. Delete); a "Marriage details" node-menu item + a focusable knot
  (Enter/Space, `inspector.marriageDetails`) make the wedding editor discoverable
  and keyboard-reachable; "Focus this lineage" relabelled to "Focus descendants"
  to match what it does; colliding first names get a surname initial ("Ram S.");
  pet nodes no longer offer add-relative.
- **[86c89da] Reveal a newly added relative.** After a successful add, the new node
  is selected (`Inspector.show`) and panned/zoomed into view
  (`TreeView.revealPerson`) so it can't land off-screen.
- **[9cb1d62] Labelled multi-tree home in the rail.** A "Your trees" rail entry
  (`tree.yourTrees`) calls `TreeList.open()`, revealed only in cloud mode — no
  longer hidden behind the account-menu avatar.
- **[15eff36] Onboarding chrome, boot splash, first-run busy fix.** Landing /
  sign-in / first-run get a shared lang + theme cluster (`UI.onboardChrome()`)
  since the header's toggles are occluded pre-app, with live re-translation via
  `data-i18n` + `I18n.onChange`; a "Loading your tree…" splash (`sync.loadingTree`)
  covers the sign-in→first-paint gap; the sign-up first-name field gains an
  "optional" tag + rationale hint (`auth.firstNameHint`) and an example-name
  placeholder; a "Back" link (`auth.backToIntro`) returns from the auth card to the
  landing; first-run Import/Sample now show busy on the button actually pressed.

---

*Generated from the audit journal; ranked most-impactful-first within each area.
When picking up an item, re-verify the `file:line` — the codebase moves.*
