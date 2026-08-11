# Virasat — UX audit backlog

Source: an 8-agent max-effort UX audit (2026-08-11) across accessibility/i18n,
header/nav/IA, onboarding/empty states, the person form, the tree canvas,
sharing/collaboration/account, mobile/responsive, and timeline/people views.
**59 findings total** (16 high, 32 medium, 11 low).

Each finding is verifiable against source at the cited `file:line`. Effort tags:
**S** = small (one rule / a few lines), **M** = medium (new copy + a component
change), **L** = large (broad sweep).

---

## ✅ Shipped (2026-08-11 → 08-12)

Landed across commits `11f433d`, `375c659`, `1a03083`, `5f9de57`. Verified
(`node -c` per file, smoke green, tsc 5.9.3 = 0 errors). **CACHE_VERSION not yet
bumped** — held until the rest of the queued changes land.

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

Everything below is the **remaining backlog** — captured so nothing is lost, in
rough priority order within each area.

---

## Accessibility & i18n

- **[M] Form field labels & hints fail contrast (SC 1.4.3).** `.field__label` /
  `.field__hint` render at `--text-3` = 3.95:1 at 11–12px. Darken to `--text-2`
  (#4A463E = 8.7:1) or add a `--text-label` token. `styles/components.css:47-51`.
- **[S] Inspector disclosure sections never expose `aria-expanded`.** Add
  `aria-expanded` to the head element and update it in `toggle()`; optionally
  `aria-controls` the body. `lib/components/inspector.js:366-385`.
- **[M] Save validation is a 2.4s polite toast with no `aria-invalid`.** Set
  `aria-invalid` on the field and render a persistent inline error tied via
  `aria-describedby`; and/or make danger toasts assertive. Copy already exists
  (`form.nameRequired`, `form.dateInvalid`). `lib/views/people-view.js:1082-1100`.
- **[M] Mobile kebab/hamburger: `aria-expanded` stale, focus not moved.** Toggle
  `aria-expanded` on open/close, move focus to the first item on open, restore to
  the anchor on close, add ArrowUp/Down between items. `lib/app.js:240-345, 547-553`.
- **[S] Tree control icon-buttons hardcode English aria-labels** (unused i18n keys
  already exist). `lib/views/tree-view.js` control buttons.

## Header, navigation & information architecture

- **[S] Icon-only collapse has no CSS, so the desktop header crowds/overflows on
  narrow laptops.** `btn__label-md` / `nav-btn__label` spans exist in markup but
  no rule hides them; the layout jumps straight from full desktop to the 768px
  kebab. Add `@media (max-width:1024px){ .btn__label-md{display:none} }` and let
  `.header-search` shrink. `index.html:57,61,65,85,89,93`; `styles/base.css`.
- **[S] Header tooltips / icon-button names are hardcoded English** despite
  `data-i18n-title` / `data-i18n-aria-label` being implemented (i18n.js:665-670)
  and used **zero** times in index.html. Replace literals with those attributes.
- **[M] Global search yanks you to People on every keystroke** and disappears on
  phone with no kebab fallback. Debounce/soften the auto-switch; add a "Search
  people" kebab row on phone. `lib/app.js:139-144`; `styles/base.css:208`.

## Onboarding & empty states

- **[M] No language switch on landing / sign-in / first-run screens.** The EN/HI
  toggle only lives in the app header, which is occluded until after sign-in AND
  the first-tree screen. A Hindi-reading elder meets the whole funnel in English.
  Add a toggle reusing `.lang-switch` into the landing hero and first-run topbar.
  `lib/auth/sign-in.js:203-220`, `lib/auth/first-run.js:182-189`.
- **[S] Blank app shell flashes after sign-in while the cloud tree loads.** Keep a
  lightweight "Loading your tree…" splash between sign-in and first paint.
  `lib/auth/sign-in.js:236-238`, `lib/app.js:720-728`.
- **[S] People-view empty states are hardcoded English**, bypassing existing Hindi
  keys. (Overlaps the i18n sweep; residual states remain.) `people-view.js:415-433`.
- **[S] "First name" at sign-up has no rationale, no optional marker,** and a
  redundant label+placeholder. Add `auth.firstNameHint`. `lib/auth/sign-in.js:44-52`.
- **[S] First-run Import / Sample paths show busy feedback on the wrong button.**
- **[S] No way back to the landing pitch once the auth card is revealed.**

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
- **[S] "Add child/spouse/parent" modal titles are hardcoded English,** ignoring
  existing HI keys. (Overlaps the i18n sweep.)

## Tree canvas

- **[M] The wedding-record editor is reachable only via the tiny gold knot** —
  undiscoverable, keyboard-inaccessible, and absent for cross-row couples. Add a
  "Marriage details" item to the node menu and make the knot focusable with
  Enter/Space. New key `inspector.marriageDetails`. `tree-view.js:601,583,595-624`.
- **[S] Node menu opens downward with no edge-flip and is clipped by the stage's
  `overflow:hidden`** — bottom-row / edge nodes lose menu items incl. Delete.
  Measure and flip/clamp after append. `tree-view.js:1459-1464`; `views.css:83`.
  (Related to the mobile clip fix; desktop bottom-edge case remains.)
- **[S] "Focus this lineage" fades ancestors and highlights only descendants** —
  the opposite of what "lineage" (वंशावली) promises. Cheapest honest fix: relabel
  to "Focus descendants"; better: also walk ancestors. `tree-view.js:1875-1902`.
- **[M] Nodes show first-name-only; full name is in a hover `<title>` only** —
  same-name relatives are indistinguishable on touch. Append a surname initial for
  colliding first names. `tree-view.js:1036-1044`.
- **[S] Right-clicking a pet offers Add spouse/child/parent,** nonsensical for a
  companion animal.
- **[M] After adding a relative, the new node is neither selected nor scrolled
  into view** — it can land off-screen. Call `Inspector.show(saved.id)` + a
  `TreeView.revealPerson(id)` pan/zoom. `people-view.js:1158-1160`, `tree-view.js:435`.
  *(Partly related to the add-affordance gap being built now; the reveal remains.)*

## Sharing, collaboration & account

- **[M] Inviting defaults to "Can edit", and neither role is ever explained.**
  Default to view-only; add a one-line `share.roleHelp` under the select.
  `lib/auth/sharing.js:98-101`.
- **[S] Multi-tree switching lacks a labelled home** — it lives only inside the
  account menu behind an email-initials avatar. Add a rail entry calling
  `TreeList.open()` reusing `tree.yourTrees`. `lib/app.js:434-447`.

## Mobile & responsive

- **[S] Phone kebab menu has no max-height/scroll and ignores the bottom safe
  area.** Add `max-height: calc(100dvh - 64px - env(safe-area-inset-bottom))`,
  `overflow-y:auto`. `styles/components.css:1070-1083`.
- **[S] Kebab overflow menu omits Add person,** the core creation action. Add a
  row inside the `canEdit` block. `lib/app.js:299-306`.
- **[S] Tree overlay control buttons are 32px on phone** (< 44px touch min). Add
  `min-width/height:44px` inside the `@media (pointer:coarse)` block. `views.css:1090,1107`.
- **[S] Header doesn't reserve the top safe-area inset** — content hides under the
  notch in the installed PWA. `padding-top: env(safe-area-inset-top)` on
  `.app-header`. `styles/base.css:45-57`.
- **[M] Date picker popover is a fixed 320px opening downward,** clipping inside the
  bottom-sheet form on narrow phones. `width: min(320px, calc(100vw - 32px))` + an
  upward-flip. `styles/components.css:704-709`.
- **[S] Header crowds in the 769–1100px band** — full nav + 280px search + three
  labeled actions never wrap. (Same root as the icon-only-collapse item above.)
- **[M] Timeline has no pinch-to-zoom on touch** and a hardcoded English TODAY label.

## Timeline & people

- **[M] "present" and date-precision markers are hardcoded English** in the shared
  lifespan label — Hindi timelines/cards read "1950–present", "c. 1950". Add
  `common.present`, `date.circa/before/after`. `timeline-view.js:281`,
  `data-store.js:940-946`. *(Partly covered by the i18n sweep; the shared
  data-store formatter remains.)*
- **[S] Search silently drops the active Living/Deceased filter in People view.**
  Apply the same `filterMode` test in the search branch. `people-view.js:152-177`.
- **[S] Timeline's sticky name column isn't clickable** — off-screen bars leave the
  visible name inert. Give it `role=button`, `tabindex=0`, and the openPerson
  handler. `timeline-view.js:319-324`.
- **[S] People search shows no result count** — the header still reads the full
  member total.

---

*Generated from the audit journal; ranked most-impactful-first within each area.
When picking up an item, re-verify the `file:line` — the codebase moves.*
