# Virasat — UX audit backlog

Source: an 8-agent max-effort UX audit (2026-08-11) across accessibility/i18n,
header/nav/IA, onboarding/empty states, the person form, the tree canvas,
sharing/collaboration/account, mobile/responsive, and timeline/people views.
**59 findings total** (16 high, 32 medium, 11 low).

Each finding is verifiable against source at the cited `file:line`. Effort tags:
**S** = small (one rule / a few lines), **M** = medium (new copy + a component
change), **L** = large (broad sweep).

> **Progress:** the first two batches (11 findings) plus a third batch of 12 and
> a fourth a11y/i18n/responsive sweep shipped on `feat/cloud-sync`. The
> **remaining backlog is below**; everything shipped is collected in
> **[✅ Shipped](#-shipped)** at the bottom of this file. **CACHE_VERSION is
> deliberately not yet bumped** — held until the rest of the queued changes land.

---

## Accessibility & i18n

- **[M] Save validation is a 2.4s polite toast with no `aria-invalid`.** Set
  `aria-invalid` on the field and render a persistent inline error tied via
  `aria-describedby`; and/or make danger toasts assertive. Copy already exists
  (`form.nameRequired`, `form.dateInvalid`). `lib/views/people-view.js:1082-1100`.
- **[M] Mobile kebab/hamburger: `aria-expanded` stale, focus not moved.** Toggle
  `aria-expanded` on open/close, move focus to the first item on open, restore to
  the anchor on close, add ArrowUp/Down between items. `lib/app.js:240-345, 547-553`.

## Header, navigation & information architecture

- **[M] Global search yanks you to People on every keystroke** and disappears on
  phone with no kebab fallback. Debounce/soften the auto-switch; add a "Search
  people" kebab row on phone. `lib/app.js:139-144`; `styles/base.css:208`.

## Onboarding & empty states

*(All findings in this area have shipped — see [✅ Shipped](#-shipped).)*

## Person form

- **[S] A Latin-script name is mandatory — you cannot save a person with only a
  Hindi name.** Accept the record when *either* `name` or `name_hi` is non-empty;
  if `name` is blank, store `name_hi` as the resolving name. `people-view.js:598-608,
  1083-1087, 999-1009`.
- **[S] No sanity check that birth precedes death** (or that dates aren't in the
  future); `calcAge` goes negative. Add `form.dateOrderInvalid`. `people-view.js:1089-1100`,
  `data-store.js:918-927`.
- **[M] Validation errors are transient toasts, not inline field errors,** with no
  aria wiring. Render into a `.field__error` span, set `aria-invalid` +
  `aria-describedby`, add an `.input.is-invalid` rule. `people-view.js:1084-1099`.
- **[M] The form is a flat wall of ~15 field groups** with no grouping and no
  "only name is required" cue. Keep an always-visible Essentials block and move
  the rest into a collapsible "More details". `people-view.js:1013-1042`.
- **[S] Date-precision dropdown always shows,** even beside a blank/"living" death
  date, and is unlabeled.

## Tree canvas

*(All findings in this area have shipped — see [✅ Shipped](#-shipped). The
"Focus this lineage" fix relabelled to "Focus descendants" — the deeper option
of also walking ancestors is still open if desired.)*

## Sharing, collaboration & account

*(All findings in this area have shipped — see [✅ Shipped](#-shipped).)*

## Mobile & responsive

- **[S] Kebab overflow menu omits Add person,** the core creation action. Add a
  row inside the `canEdit` block. `lib/app.js:299-306`.
- **[M] Timeline has no pinch-to-zoom on touch.** (The hardcoded English TODAY
  label has shipped — see [✅ Shipped](#-shipped).)

## Timeline & people

*(All findings in this area have shipped — see [✅ Shipped](#-shipped).)*

---

## ✅ Shipped

All on `feat/cloud-sync`, verified per commit (`node -c` each file, smoke green,
tsc 5.9.3 = 0 errors). **CACHE_VERSION deliberately not yet bumped** — held until
the rest of the queued cloud work lands.

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
