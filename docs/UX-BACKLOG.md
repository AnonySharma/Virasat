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
audit is cleared. Net-new findings — anything not already covered above — will be
consolidated here, ranked by impact, each with a `file:line` anchor and an effort
tag. Nothing below is committed to yet; this is a fresh triage surface.*

_(Pending — findings will be appended when the review agents report.)_

---

## ✅ Shipped

All on `feat/cloud-sync`, verified per commit (`node -c` each file, smoke green,
tsc 5.9.3 = 0 errors). **CACHE_VERSION deliberately not yet bumped** — held until
the rest of the queued cloud work lands.

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
