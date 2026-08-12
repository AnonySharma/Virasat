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
- **[M] First-run never detects the local tree already in this browser.** An existing
  local user signing up for cloud gets a generic "import a Virasat export" file picker
  with no awareness that a `familyTree.v1` blob may sit in this very localStorage — so
  the user most likely to have pre-existing data is the one most likely to lose track
  of it. *Note: the cloud plan deliberately scoped out a migration script, so this is a
  product call — but the one-tap "We found a tree on this device — bring it in?" is a
  cheap, high-trust win.* `first-run.js:164-181`, `data-store.js:16,52`.
- **[S] Password sign-in has no recovery path.** No "Forgot password?" link; a wrong
  password just says "doesn't match. Try again." with no next step, even though the
  magic-link ("Email me a sign-in link") button right there IS the recovery path. No
  new Supabase call needed — just cross-link them (append "…or use 'Email me a sign-in
  link' below" to the invalid-login message, or highlight that button on that error).
  `sign-in.js:136-146, 311-319, 96-99`.
- **[S] Rail "Preserve your legacy" CTA always says data is "saved on your device"** —
  even for signed-in cloud users whose data is synced to Supabase. Unlike its siblings
  `#rail-trees-block` / `#share-btn` (gated by `CloudStore.isActive()`), this block has
  no visibility/copy gating, so a cloud user permanently sees a local-only pitch + a
  "Get started" button that just opens Export. Gate it like `refreshTreesRail()` and
  swap to a "synced & backed up" message when signed in. `index.html:169-172`,
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
- **[S] Header/People search has no explicit clear button.** Both use bare
  `<input type="search">` (`app.js:137-157`, `people-view.js:45-56`) with no custom
  clear and no `::-webkit-search-cancel-button` styling, so on several browsers the
  only way to clear is backspacing. Add an `×` inside `.searchbar`/`.header-search`.
  *(Low priority.)*

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
- **[M] No visible offline / syncing indicator.** `cloud-store.js` already tracks
  the full sync lifecycle — `pendingPush`, the `online` event, the 60 s heartbeat,
  and conflict — but none of it surfaces in the chrome. A user editing on a flaky
  connection has no "saved to cloud ✓" / "offline — will sync" affordance, so they
  can't tell whether their 30-relative session is safe. Add a small header sync
  pip driven off the existing dirty/push state (no new backend).
  `cloud-store.js:60-62,165-166,329,368`.
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
- **[S] A pending invite can't be re-sent or its link re-copied per-row.** The
  member list shows pending invites with only role-change + cancel; the app-link
  copy is a single global control at the top of the dialog, not attached to the
  specific pending invitee. Add a per-row "copy invite link" on pending rows (reuse
  `copyLink()` + `appLink()`; no backend change). `sharing.js:79-118,162-178`.
- **[M] An invitee who signs up with the wrong email lands on the blank create-tree
  screen with no clue an invite exists.** `claim_invites` matches by `auth.email()`
  (citext); a mismatch claims nothing, `resolveTree` finds no owned/shared tree and
  returns `null`, and first-run shows "Create your first family tree" — the shared
  tree is invisible with no "we couldn't find an invite for this address; the owner
  invited <x>?" hint. Surface a first-run note when the account has zero trees but
  arrived via an invite flow. `cloud-store.js:100-135`, `auth-store.js:223-224`,
  `first-run.js:207-217`.

### Person form (net-new, post-rework)

- **[M] The date picker is 100% hardcoded English — never routed through I18n.**
  Every string in `HeritagePicker` is a literal: input/trigger/dialog aria-labels
  (`heritage-datepicker.js:81,89,92`), prev/next month (`97-98`), the MONTHS /
  WEEKDAYS arrays (`15-16`, which drive the calendar title *and* each day's
  aria-label at `205`), "Year only" (`109`), "Today" (`113`), "Clear" (`117`). A
  Hindi user opens this 2×/person and sees English chrome + month names. Route all
  nine literals + localized month/weekday names through I18n (`heritagePicker.*`).
- **[M] No "Save & add another".** After each add the modal closes and the tree
  pans / Inspector opens (`people-view.js:1323-1326`), forcing a full context
  switch per person — painful for the 30-relatives-in-one-sitting persona. Add a
  footer "Save & add another" that saves then reopens a blank form, skipping the
  reveal/pan for that path.
- **[M] Every twin (EN+HI) field pays the two-column card cost even when Hindi is
  never used.** `pair()` wraps all 8 twinned fields in a padded dashed card
  (`people-view.js:1074-1087`, `components.css:458-467`), doubling each field's
  height on phone for English-only entry. Default the Hindi half to a collapsed
  "+ हिन्दी" toggle unless it already has a value (mirror the `moreDetails.open`
  progressive-disclosure keyed off `hasMoreData`).
- **[S] Enter never submits the form.** The modal body is a plain `<div>`, not a
  `<form>` (`dom.js:189-198`), and `openModal` only handles Escape/Tab (`157-186`);
  single-line inputs have only `oninput` (the `required` on `nameInput` is inert).
  Add a modal-level Enter handler that clicks Save when focus is in a single-line
  input (excluding textareas and the date popover's own Enter-commit).
- **[S] Hidden death-precision picker leaves a dead 130 px gutter.** The row is a
  fixed `grid-template-columns: 1fr 130px` (`people-view.js:742`); hiding the
  precision child via `display:none` (`734-738`) doesn't collapse the track, so
  every living person shows an empty 130 px hole beside the death-date input.
  Collapse the row to a single column when the picker is hidden.

---

## ✅ Shipped

All on `feat/cloud-sync`, verified per commit (`node -c` each file, smoke green,
tsc 5.9.3 = 0 errors). **CACHE_VERSION deliberately not yet bumped** — held until
the rest of the queued cloud work lands.

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
