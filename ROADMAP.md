# Roadmap

Items already shipped are struck through and listed in [`README.md`](README.md). The rest are open ideas — not commitments. Wording is kept neutral and inclusive.

If any of these resonate, open an issue or just hack on it. The whole app is vanilla JS with no build step, so it's easy to extend a single file at a time.

The list is **ranked by priority**, not grouped by audit round. Top of each tier is the next thing worth doing; bottom is the most speculative.

---

## P1 — Highest leverage

These move the heritage product forward the most for the effort.

- **Multiple photos per person.** One *primary* avatar + a small gallery (childhood, wedding, late portrait, etc.). Crop editor already handles two frames from one source; extending to N+ is a natural step. Pairs with the Family Map and PDF book features below.
- **Memorial poster** using `photoCropHero`. The hero crop is rendered on the profile-page hero band but ignored by the share poster. A dedicated *Memorial print* template (A4 landscape, hero photo at the top, lifespan + key dates underneath) is straightforward — the data is already there.
- **Voice memos as a primary form CTA.** Make the affordance load-bearing — a *Record a 30-second memory* button beside the Notes field, with a waveform preview. Without surface area, users won't discover the feature.
- **Documents / sources.** Attach scans of letters, certificates, articles. Cite them on dates and achievements so future generations can verify.
- **Per-anniversary notification opt-in.** With the *Coming up* data already computed (see `FamilyStore.upcomingAnniversaries`), wire `Notification.requestPermission()` on first run and fire a local notification on the day of each event when the PWA is installed. Calendar export (`.ics`) is a free secondary outcome.

---

## P2 — Worthwhile, smaller scope

- **Detailed vs compact tree views.** A toggle on the Tree view:
  - *Compact* — only direct lineage (default focus on whoever is set as "self"), good at-a-glance.
  - *Detailed* — shows every person who married into the family + their parents, children, and grandchildren as long as the chain stays connected.
- **Pin a "self" person.** All views can then highlight relationship paths and label everyone with how they relate to you ("paternal grandmother", "spouse's brother"). Pairs naturally with the path-finder that already exists.
- **Auto-tag who's in a group photo** by clicking faces and assigning a person — useful for old family albums.
- **Date precision: BCE / month-only.** Today `parseDate` accepts `YYYY[-MM[-DD]]` only. Negative years and "March (year unknown)" are real for ancient genealogies. Defer until someone needs it.
- **Calendar systems** — record dates in Vikram Samvat / Hijri / etc. alongside Gregorian, with a per-tree default.
- **Beyond two languages** — each field can have any number of language variants (`name`, `name_hi`, `name_pa`, `name_te`...). Keep the rule: only show what the user wrote.
- **Right-to-left** support for Urdu / Arabic alongside Hindi.
- **Relationship tags.** Mark adoption, step-, half-, partner (unmarried), divorced, deceased-in-infancy. The tree should render these visually (dashed couple line for divorced, etc.).
- **Detailed-view branches for "married-out" lineages.** When a relative marries someone from outside the family, optionally show their parents and siblings too (one generation up, one wide).

---

## P3 — Big features (high cost, real value)

- **Family Map view.** A new top-nav tab. Birthplace, migration, current residence, connected through generations. Powerful for genealogy. Needs a tile provider + clustering — non-trivial.
- **GEDCOM import / export.** Interop with Ancestry / FamilySearch and other family-tree apps.
- **Multi-user editing / merge.** Currently single-device. A future "merge" mode could compare two JSON exports, dedupe, surface conflicts, and let the user pick a side.
- **Read-only public links.** Export a static snapshot a relative can browse without editing.
- **Per-person privacy flags** (beyond the per-contact-field ones already shipped). Hide a still-living relative's birthdate or phone number from public exports while keeping it in your own copy.
- **QR-code share** — generate a QR that opens a read-only view of one person's profile, useful at family gatherings.

---

## P4 — Nice polish, no rush

- **Layered canvas background.** Subtle paper texture + faded family motifs (letters, stamps, seals, temple carvings) at 3–5% opacity + faint generation rings emanating from the oldest ancestor. The current ivory + olive radial is fine but generic.
- **Photo / video / document counts** on tree nodes (alongside the story-count chip already there).
- **Custom background or motif** (a family crest, a regional pattern) per tree.
- **Per-person colour accent** — assign a small accent colour per branch to make multi-generation trees easier to follow.
- **High-contrast theme.** Light/dark already exists; a third pass for low-vision contrast wouldn't hurt.
- **Larger text mode** for older relatives.
- **Undo / redo** for edits, including delete.
- **Timeline minimap** — for trees that span 5+ generations and 200+ years, a small overview strip below the timeline so you can jump quickly.

---

## P5 — AI / generative

These need an opt-in / API key path. None of them block on each other.

- **AI story generator.** Given a person's facts (dates, places, occupation, relations), draft a short paragraph the user can edit. Local-only by default; opt-in API.
- **Photo restoration / colourisation.** Optional service to clean up old scans.
- **Voice transcription** — auto-transcribe voice memos into searchable text (pairs with voice memos in P1).

---

## Shipped (highlights)

A short list. The fuller picture lives in [`README.md`](README.md) under *Features*.

- ~~Three-pane workspace (rail / canvas / inspector) with the heritage palette (ivory + olive + gold), Cormorant Garamond + Inter typography.~~
- ~~Tree, People, Timeline views with shared filter, lineage focus, and a unified `view-head` header rhythm.~~
- ~~Photo-first tree nodes with a gold knot between partner photos. Right-click a node for Add child / Add spouse / Add parent. Click the knot for a Marriage modal (date / place / story / photo).~~
- ~~Heritage date picker (year-only mode, today/clear chips with FA icons).~~
- ~~Heritage custom dropdown replacing native selects, with `aria-activedescendant` for screen-reader keyboard nav.~~
- ~~Father / Mother / Spouse(s) as separate pickers.~~
- ~~Soft filter — Living / Deceased dim non-matching members in the active view, no view switch.~~
- ~~Hindi UI + per-field Hindi text companions, no auto-translate.~~
- ~~Google Form template + CSV import flow.~~
- ~~PNG export with quality presets (Sketch / Standard / Great / Heirloom). Lineage-only export when a person is in focus.~~
- ~~JSON export/import with photos inlined as base64; round-trip lossless. Marriages included; per-field privacy flags strip flagged values.~~
- ~~Reset everything — wipes localStorage state, IndexedDB photos, the inspector selection, and the filter.~~
- ~~Mobile responsive: hamburger rail, slide-in inspector, touch pan/zoom, iOS safe-area for the zoom cluster + toasts.~~
- ~~Date precision flags (`exact|about|before|after`) rendered in profile chips, tree compact form, and as a faded edge gradient on the timeline.~~
- ~~Stories — long-form memories with tags. Header search returns dedicated story-result cards (snippet, highlighted match, tag chips); clicking opens the inspector at the matched story with a brief gold halo.~~
- ~~Two-frame photo cropping (avatar + 16:9 hero). Drag-with-slack math + per-frame zoom slider so both axes work regardless of frame aspect.~~
- ~~Lineage banner ("Viewing as: Name · Reset view") + lineage-only PNG export. Pets whose owner is in lineage stay bright too.~~
- ~~Full-profile share poster (hero, lifeline chips, About, Achievements, Education, Family, Stories, Notes).~~
- ~~Editable tree title (any free-form string) with eyebrow "Established c. NNNN" + memory count in the subtitle.~~
- ~~Offline-capable PWA via service worker + web app manifest. Family-archive completion bar and "Family highlights" empty-inspector card.~~
- ~~Anniversaries surfaced in the inspector empty state (oldest ancestor / latest addition / most stories / next birthday).~~
- ~~"Needs attention" rail card with deep-links into a People view filtered by missing-field.~~
- ~~Per-person contact info (phone / email / address) with per-field privacy flags. Inspector renders rows that link via tel: / mailto: / Maps.~~
- ~~Pets / companion animals — `isPet` + `petOwners[]`. Pets sit one generation below their humans, connected with a dashed gold riser. View Options popover toggles them on/off.~~
- ~~Lineage path-finder (BFS over parent / child / spouse edges). Modal renders the chain as avatars + relation chips.~~
- ~~PDF family book — `PrintBook.open()` builds a hidden DOM with one A4 page per relative + cover, then calls `window.print()`.~~
- ~~Dark-mode toggle (sun / moon header pill). Active rail item gets gold-soft + bright text in dark theme so it doesn't read as disabled.~~
- ~~Try-sample-family rail action (gated by destructive confirm).~~
- ~~Story-density chip on each tree node (top-left of photo ring) showing story count.~~
- ~~Icon sweep across visible buttons — every dialog button (Cancel / Save / Close / Remove / Forget / Today / Clear / etc.) carries a Font Awesome icon.~~
