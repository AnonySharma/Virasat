# Roadmap

Items already shipped are struck through and listed in [`README.md`](README.md). The rest are open ideas — not commitments. Wording is kept neutral and inclusive.

If any of these resonate, open an issue or just hack on it. The whole app is vanilla JS with no build step, so it's easy to extend a single file at a time.

---

## Tree depth & branches

- **Detailed vs compact tree views.** A toggle on the Tree view:
  - *Compact* — only shows direct lineage (default focus on whoever is set as "self"), good at-a-glance.
  - *Detailed* — shows every person who married into the family, *and* their parents, children and grandchildren as long as the chain stays connected. Useful when, for example, your aunt's family settled elsewhere and you want their branch visible too.
- **Pin a "self" person.** All views can then highlight relationship paths and label everyone with how they relate to you ("paternal grandmother", "spouse's brother", etc.).
- ~~**Highlight descendants from a selected person.** Select anyone in the tree and only their lineage going forward — their spouse(s) and the entire descendant subtree underneath — stays at full opacity; everyone else dims.~~ ✅ Shipped — clicking any tree node highlights their full lineage (ancestors + descendants + every spouse along the way) and fades the rest.
- ~~**Add relatives directly from the tree.** Right-click a tree node → contextual menu with Add child / Add spouse / Add parent.~~ ✅ Shipped.
- **Relationship tags.** Mark adoption, step-, half-, partner (unmarried), divorced, deceased-in-infancy. The tree should render these visually (dashed couple line for divorced, etc.).
- **Detailed-view branches for "married-out" lineages.** When a relative marries someone from outside the family, optionally show their parents and siblings too (one generation up, one wide). Useful for seeing how families merged.

---

## Photos

- **Image cropping UI** with two preview frames (small circular avatar, larger profile rectangle), each draggable / resizable independently. One source image, two crop rectangles stored against it (`photoCropAvatar`, `photoCropHero`); render-time SVG `clipPath` applies the appropriate crop. Avoids the "great close-up looks bad on the profile, great profile shot looks tiny in the tree" trade-off.
- **Multiple photos per person** — not just one avatar. A small gallery (childhood, wedding, etc.) per profile, with one designated "primary" photo for the avatar.
- **Auto-tag who's in a group photo** by clicking faces and assigning a person — useful for old family albums.
- ~~**Photos stored as binary** in IndexedDB (not base64 in localStorage).~~ ✅ Shipped.
- ~~**Photos always inlined as base64 in JSON exports** — no folder references.~~ ✅ Shipped.

---

## Data & interop

- **GEDCOM import / export** so you can interop with Ancestry / FamilySearch and other family-tree apps.
- **Documents / sources.** Attach scans of letters, certificates, articles. Cite them on dates and achievements so future generations can verify.
- **Stories** — long-form memories tied to a person, with tags (family, childhood, war, migration). Searchable.
- **Voice notes.** A 30-second voice memo per relative is priceless and trivially small in storage.
- **Date precision flags** — "around 1942", "before 1968", "after 1972". Store as a precision modifier on each date; render as `c. 1942` in chips. The timeline shows uncertainty as a soft fade gradient at the edges of the bar.
- **Calendar systems** — record dates in Vikram Samvat / Hijri / etc. alongside Gregorian, with a per-tree default.

---

## Languages

- ~~**EN + HI**, per-field user-entered, no auto-translate.~~ ✅ Shipped.
- **Beyond two languages** — each field can have any number of language variants (`name`, `name_hi`, `name_pa`, `name_te`...). Keep the rule: only show what the user wrote.
- **Right-to-left** support for Urdu / Arabic alongside Hindi.

---

## Sharing & collaboration

- **Read-only public links.** Export a static snapshot a relative can browse without editing.
- **Per-person privacy flags.** Hide a still-living relative's birthdate or phone number from public exports while keeping it in your own copy.
- **Multi-user editing.** Currently single-device. A future "merge" mode could compare two JSON exports and produce a deduped tree, surface conflicts, and let the user pick a side.
- **QR-code share** — generate a QR that opens a read-only view of one person's profile, useful at family gatherings.

---

## App polish

- **Offline / PWA.** A service worker so the app works offline and feels like a native app on phones. Add a `manifest.webmanifest`, register a worker that caches the app shell, and handle font/CDN assets with cache-first.
- **Print / PDF.** Generate a clean printable poster of the tree, or a per-person profile page suitable for a memory book.
- **Search across stories**, not just names.
- **Relationship path finder.** Tap any two people, see the shortest relationship chain ("Anil → father Ramesh → wife Sushila → niece Priya").
- **Family anniversaries** — surface birthdays, marriage anniversaries, death anniversaries on a per-day calendar, optionally with notification reminders.
- **Heritage map** — drop pins where each ancestor was born / lived / died on a soft-style map, to visualise how the family scattered or stayed.
- **Timeline minimap** — for trees that span 5+ generations and 200+ years, a small overview strip below the timeline so you can jump quickly.
- **Undo / redo** for edits, including delete.

---

## AI / generative

- **AI story generator.** Given a person's facts (dates, places, occupation, relations), draft a short paragraph the user can edit. Local-only by default; opt-in API.
- **Photo restoration / colourisation.** Optional service to clean up old scans.
- **Voice transcription** — auto-transcribe voice memos into searchable text.

---

## Visual & accessibility

- **High-contrast theme.**
- **Larger text mode** for older relatives.
- Custom background or motif (a family crest, a regional pattern) per tree.
- Animated couple knot — a subtle pulse on hover to invite the click that opens the marriage modal.
- **Per-person colour accent** — let the user assign a small accent colour per branch to make multi-generation trees easier to follow.

---

## Currently shipped (highlights, see README for the full list)

- ~~Three-pane workspace (rail / canvas / inspector) with a heritage palette (ivory + olive + gold), Cormorant Garamond + Inter typography.~~
- ~~Tree, People, Timeline views with shared filter and lineage focus.~~
- ~~Photo-first tree nodes with a gold knot between partner photos. Right-click a node for Add child / Add spouse / Add parent. Click the knot for a Marriage modal.~~
- ~~Heritage date picker with year-only mode for old ancestors.~~
- ~~Heritage custom dropdown replacing native selects.~~
- ~~Father / Mother / Spouse(s) as separate pickers.~~
- ~~Soft filter — Living / Deceased dim non-matching members in the active view, no view switch.~~
- ~~Hindi UI + per-field Hindi text companions, no auto-translate.~~
- ~~Google Form template + CSV import flow.~~
- ~~PNG export with quality presets (Sketch / Standard / Great / Heirloom) and Save-PNG download.~~
- ~~JSON export/import with photos inlined as base64; round-trip lossless.~~
- ~~Reset everything — wipes localStorage state, IndexedDB photos, the inspector selection, and the filter.~~
- ~~Mobile responsive: hamburger rail, slide-in inspector, touch pan/zoom.~~
