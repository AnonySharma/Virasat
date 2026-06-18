# Virasat — Your family's living legacy

*Virasat* (विरासत — "heritage") is a calm, mobile-friendly workspace for preserving names, photos, dates, and stories of every family member. View them as a tree, on a horizontal timeline, or as individual biographical profiles. Built to feel like an heirloom, not a database.

**No backend.** Everything lives in your browser. Photos are stored locally as binary blobs (IndexedDB), not as bloated base64 in `localStorage`. Export to JSON to back up or move between devices.

---

## Features

### Views
- **People** — list of every member with avatars, age chips and birthplaces. Search by name (English or Hindi).
- **Profile** — click anyone to open their full page (animated entry). Hero with name + lifeline chips, *About*, *Life achievements*, *Education*, *Notes*, and *Family* (parents, spouse(s), children, siblings — each clickable to navigate).
- **Tree** — clean SVG family tree. Pan, pinch-zoom, wheel-zoom; couples linked horizontally, parents to children with neat L-shaped lines.
- **Timeline** — horizontal lifespan bars per person with year axis, "Today" marker, and zoomable years.

### Languages — EN / HI (no auto-translate)
- Top-right toggle switches the entire UI between English and Hindi.
- Every user-entered field has an optional Hindi twin (`name`, `name_hi`; `description`, `description_hi`; etc.). The Hindi version is shown when you switch to HI **only if you actually wrote one** — otherwise the English original is shown. Nothing is machine-translated, so you can trust what you see.
- Search matches both English and Hindi names.

### Data collection — Google Form
- Click **Collect** to open a step-by-step guide.
- The provided template (in `forms/family-tree-template.html`) lists every question to add to a Google Form, plus an Apps Script snippet that builds the form for you in one click.
- Send the form link to relatives. When they fill it in, download the linked sheet as **CSV** and import it back into the app — relations are auto-linked by name.

### Photos — stored properly
- Photos go into IndexedDB as binary blobs (auto-resized to 512px JPEG ~85% quality), **not** base64 in `localStorage`.
- For photos you want to commit to your repo, drop them into `photos/` and reference them via the `photoUrl` field (e.g. `photos/grandpa.jpg`).
- Existing base64 photos from older versions are auto-migrated to IndexedDB on first load.

### Export / import
- **Export** modal: choose what to include (photos, dates, locations) and the format — full JSON or minimal (names + relations only). Live size preview.
- **Import** accepts both family-tree JSON exports and Google Form **CSV** responses.
- The import format is **the same** as the export format — round-trip is lossless when "Include photos / dates / locations" are all on. The shape is `{ version, meta, people: [...] }`; only the `people` array is required, and missing fields on each person are filled with defaults at load time, so older or hand-edited exports still load.

### Mobile
- Bottom tab bar replaces the top nav.
- Modals slide up from the bottom and are full-width.
- Tree pans and pinch-zooms with touch.
- Timeline scrolls horizontally with touch.

### Other
- **Dark mode** — follows your system preference.
- **No analytics, no CDN, no third-party calls.** Everything is local.
- **Reduced-motion** users get the same UI without animations.

---

## Quick start (local)

Just open `index.html`. That's it.

If your browser blocks `file://` URLs (some Safari builds do), serve the folder:

```sh
# Python 3
python3 -m http.server 8000
# then visit http://localhost:8000
```

---

## Hosting on GitHub Pages

1. Create a new repo on GitHub and push this folder.
2. **Settings → Pages → Source:** *Deploy from a branch* → branch `main`, folder `/ (root)`.
3. Save. After a minute, your tree is live at `https://<your-username>.github.io/<repo-name>/`.

The `.nojekyll` file disables Jekyll so GitHub Pages serves files as-is.

---

## Data & privacy

- All data stays in your browser:
  - JSON metadata in `localStorage` (key `familyTree.v1`)
  - Photos in `IndexedDB` (`familyTree.photos`)
  - Language preference in `localStorage` (`familyTree.lang`)
- Clearing site data wipes your tree — **export first.**
- Photos auto-resized to 512px JPEG (~85% quality) before being saved.
- The site has no analytics, no network calls, no third-party CDNs.

---

## File structure

```
index.html
.nojekyll
photos/                       # commit photos here for repo-hosted images
forms/
  family-tree-template.html   # Google Form question reference + Apps Script
styles/
  tokens.css                  — design tokens (colour, type, spacing)
  base.css                    — reset + app layout
  components.css              — buttons, cards, modal, avatar, chip, toast
  views.css                   — view-specific styles
js/
  i18n.js                     — EN/HI strings + DOM applier
  data-store.js               — localStorage CRUD + helpers (single source of truth)
  photo-store.js              — IndexedDB photo blob storage + migration
  ui-utils.js                 — DOM helpers, modal, toast, confirm
  people-view.js              — list, add/edit form, paired EN+HI fields
  tree-view.js                — SVG tree with pan/zoom
  timeline-view.js            — horizontal timeline
  profile-view.js             — full profile page (animated open)
  export-import.js            — export modal + JSON/CSV import
  collect-form.js             — Google Form template + CSV importer
  app.js                      — view router + first-run sample data
```

---

## Keyboard / gestures

- `Esc` — close any open modal
- Tree: drag to pan, wheel/pinch to zoom, buttons to fine-tune
- Timeline: scroll horizontally; press **Today** to jump back

---

## Roadmap / future ideas

The following are tracked here as ideas to grow the app over time. Wording is kept neutral and inclusive.

### Tree depth & branches
- **Detailed vs compact tree views.** A toggle on the Tree view:
  - *Compact* — only shows direct lineage (default focus on whoever is set as "self"), good at-a-glance.
  - *Detailed* — shows every person who married into the family, *and* their parents, children and grandchildren as long as the chain stays connected. Useful when, for example, your aunt's family settled elsewhere and you want their branch visible too.
- **Pin a "self" person.** All views can then highlight relationship paths and label everyone with how they relate to you ("paternal grandmother", "spouse's brother", etc.).
- **Highlight descendants from a selected person.** Select anyone in the tree and only their lineage going forward — their spouse(s) and the entire descendant subtree underneath — stays at full opacity; everyone else dims. A "Show descendants of [Name]" mode that complements the existing alive/deceased filter, but operates on relationship topology instead of status. Optionally include or exclude spouses-married-in further down the line.
- **Relationship tags.** Mark adoption, step-, half-, partner (unmarried), divorced, deceased-in-infancy. The tree should render these visually (dashed couple line for divorced, etc.).

### Photos
- **Two crop framings, one source image.** Each person uploads a single photo, but stores *two crop rectangles* against it — one tight square crop for tree-node and timeline avatars, one looser portrait crop for the profile hero. We never duplicate the bytes; we just remember the rectangles and apply them at render time. This avoids the awkward "great close-up looks bad on the profile, great profile shot looks tiny in the tree" trade-off.
- **Image cropping UI** with two preview frames (small circular avatar, larger profile rectangle), each draggable/resizable independently.
- **Repo-hosted photos.** Drop files into `photos/` and reference them via `photoUrl` for committed, shareable photos.

### Data
- **GEDCOM import / export** so you can interop with Ancestry / FamilySearch and other family-tree apps.
- **Multiple media per person** — not just one avatar. A small gallery (childhood, wedding, etc.) per profile.
- **Documents / sources.** Attach scans of letters, certificates, articles. Cite them on dates and achievements so future generations can verify.
- **Stories** — long-form memories tied to a person, with tags (family, childhood, war, migration). Searchable.
- **Voice notes.** A 30-second voice memo per relative is priceless and trivially small in storage.

### Languages
- Beyond EN/HI: each field can have any number of language variants (`name`, `name_hi`, `name_pa`, `name_te`…). Keep the rule that we only show what the user wrote — never auto-translate.
- Right-to-left support for Urdu / Arabic siblings of Hindi, if added.

### Sharing & collaboration
- **Read-only public links.** Export a static snapshot a relative can browse without editing.
- **Per-person privacy flags.** Hide a still-living relative's birthdate or phone number from public exports while keeping it in your own copy.
- **Multi-user editing.** Currently single-device. A future "merge" mode could compare two JSON exports and produce a deduped tree.

### App polish
- **Offline / PWA.** A service worker so the app works offline and feels like a native app on phones.
- **Print / PDF.** Generate a clean printable poster of the tree, or a per-person profile page suitable for a memory book.
- **Search across stories**, not just names.
- **Date precision flags** — "around 1942", "before 1968", with the timeline rendering the uncertainty as a faded zone.
- **Relationship path finder.** Tap any two people, see the shortest relationship chain ("Anil → father Ramesh → wife Sushila → niece Priya").

### Visual & accessibility
- High-contrast theme.
- Larger text mode for older relatives.
- Ability to upload a custom background or motif (a family crest, a regional pattern).

If any of these resonate — or you have your own — open an issue or just hack on it. The whole app is vanilla JS with no build step, so it's easy to extend a single file at a time.

---

## Credits

Built with no external dependencies — just modern browser APIs.
