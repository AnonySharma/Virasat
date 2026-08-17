# Virasat — Your family's living legacy

*Virasat* (विरासत — "heritage") is a calm, mobile-friendly workspace for preserving names, photos, dates, and stories of every family member. View them as a tree, on a horizontal timeline, as biographical profiles, or as an at-a-glance insights dashboard. Built to feel like an heirloom, not a database.

**Runs two ways, same code.** Out of the box it's *cloud-enabled*: sign in and your tree follows you across devices, with per-email sharing (viewer / editor) and offline tolerance after login. Blank the credentials in `lib/auth/config.js` and it reverts to a *local-first* PWA — everything in your browser, no sign-in, no network calls. Either way photos are stored locally as binary blobs (IndexedDB), never as bloated base64 in `localStorage`, and JSON export/import moves a whole tree between devices by hand.

> Live at **https://anonysharma.github.io/Virasat/** when GitHub Pages is enabled.

---

## Features

### Four primary views

- **Tree** — heritage-style SVG with photo-first nodes. Couples sit side-by-side with a small **gold knot** between their photos as a wedding-band marker. Generations stack top to bottom; cousins from the same couple are kept adjacent so the rails between siblings never cross over each other. Pan, pinch-zoom, wheel-zoom; controls + zoom percent in a quiet pill at the bottom-right. Right-click a node (or long-press on touch) for a context menu that also includes **Focus this lineage**.
- **People** — searchable list of every family member with photo or initial, age chip, and birthplace. Search matches both English and Hindi names.
- **Timeline** — horizontal lifespan bars per person. Year axis with "TODAY" marker, zoomable years, click any bar to open the inspector. A labelled **overview minimap** sits above the canvas — drag or scroll it to move the window across long spans.
- **Insights** — a factual dashboard derived entirely from what's on file: headline counts (people, generations, living generations, average lifespan, living / remembered, years documented), gender split, born-by-decade, name trends, where the family is from, eldest & youngest, **stories preserved** with recurring themes, a **then & now** pairing of the earliest ancestor and newest addition, a whole-family **Coming up** list (clickable rows; "+N more" opens the full year ahead in a modal), and a compact **family calendar** marking every birthday and memorial with a small type icon per day — tap a marked day to open its people.

### Inspector pane

The right pane shows a person's full biography in collapsible sections:

- **About** (free-text bio)
- **Personal information** (born / died / gender / occupation / age or lifespan)
- **Life achievements**
- **Education**
- **Family** (parents / spouse(s) / children / siblings — each clickable to navigate)
- **Stories** — long-form memories with optional title, body, and comma-separated tags. Edit/delete in a dedicated modal; the header search matches story bodies and tags.
- **Photo** (large preview + edit button)
- **Notes & memories** (debounced auto-save)

Action row above the sections: add a note, share as image (full profile poster), edit, delete. Section open/closed state persists across sessions.

### Lineage focus

Click any person in the tree and only their lineage (the person + every spouse + every descendant) stays at full opacity. Connecting lines and the gold wedding emblems between in-lineage couples brighten with them; everyone else fades to ~22%. A *Viewing as: <Name> · Reset view* banner sits above the canvas while focus is active — click Reset (or pick someone else) to switch.

### Date precision flags

Each birth / death date can be tagged **exact / about / before / after**. Renders as `c. 1968` / `before 1968` / `after 1968` everywhere — profile chips, inspector rows, tree node compact form (`c.`/`<`/`>`), and a softly faded edge gradient on the timeline bar so uncertainty is visible at a glance.

### Soft filters (don't switch views)

Top-left rail has **All / Living / Deceased** filters. Toggling one **dims non-matching members in whichever view is currently active** — tree, people, or timeline — instead of jumping you elsewhere. Selection persists in `sessionStorage`.

### Add relatives from the tree

- **Left-click** any tree node → selects the person in the inspector.
- **Right-click** → contextual menu: Edit, Add child, Add spouse, Add parent, Delete. Each "Add..." opens the form pre-filled with the appropriate relation linked.
- **Click the gold knot** between a couple → small "Marriage" modal with both partners and their lifespans.

### Form

- **Heritage date picker** for birth/death dates — calendar with year-only mode for old ancestors, "Today" / "Clear" buttons.
- **Custom dropdowns** (HeritageSelect) — no native browser-blue picker. Olive-soft hover, gold check on selected, full keyboard support (arrows, Home/End, Enter, Esc, typeahead).
- **Father / Mother / Spouse(s)** as separate single-pickers (mutually exclusive). Spouses render as a dynamic list of avatar + picker rows with a "+" pill to add another.
- **Hindi twin** for every text field — every name, place, occupation, description, achievement, education, note has an optional `_hi` companion. Hindi shows when language = HI **and** you wrote one; otherwise the English original is shown. Nothing is machine-translated.
- **Photo uploader** — auto-resized to 512px JPEG (~85% quality), stored in IndexedDB.
- **Reframe button** — open a side-by-side editor with two crop frames against the same source photo. Drag inside each to choose what's centred; one slider zooms both. The round frame is what shows in tree nodes and avatars; the wide 16:9 frame is the hero band on the profile page and the share poster. Stored as `photoCropAvatar` and `photoCropHero` (focal point + zoom factor), applied at render-time.

### Languages — EN / HI

Top-right toggle switches the entire UI between English (Inter / Fraunces) and Hindi (Noto Sans Devanagari). Font Awesome icons are protected from the language change. Search matches both scripts.

### Data collection — Google Form

Click **Collect** to open a setup guide. The provided template (in `forms/family-tree-template.html`) lists every question to add to a Google Form, plus an Apps Script snippet that builds the form for you in one click. Send the form to relatives. Download responses as **CSV** and **Import** them — relations are auto-linked by name.

### Export

Single modal with everything in one place:

- **Field toggles** — Include photos / dates / locations (apply to both PNG and JSON).
- **PNG quality** — Sketch / Standard / Great / Heirloom heritage radio cards with file-size estimates.
- **Lineage-only PNG** — when a person is in lineage focus and you open Export, an *Only \<Name\>'s lineage* toggle is shown and turned on by default. The PNG renders just that subtree (focus + spouse as joint roots, descendants below) framed tightly around the in-lineage nodes, edges, and couple knots.
- **JSON options** — Minimal mode (names + relations only) and "Embed photos in JSON" (base64).
- **Save PNG** — always downloads a self-contained image.
- **Save JSON** — single self-contained file. Photos are inlined as base64 on the `photo` field; round-trip with Import is lossless.

### Image export

- **Tree → PNG** at any quality preset. CSS variables resolved to literals; photos inlined as base64; couple knots and connectors all rendered correctly when detached from the document.
- **Full-profile poster** — the Share button generates a tall poster with the entire profile: hero (with the avatar crop honoured), lifeline chips, About, Achievements, Education, Family chips, Stories (title + body + tags), and Notes. Heritage palette, free-flowing height, ready to send.

### Family Highlights · Needs attention

The inspector's empty state and the rail surface a small "soul of the tree" panel each:

- **Family Highlights** (right inspector, when nobody's selected) — *Oldest ancestor*, *Latest addition*, *Most stories*, *Next anniversary*. Cards stack one-per-row so the labels never clip. Click any card → opens that person's profile.
- **Family Archive completion bar** — gold gradient progress bar in the same panel, showing the % of fields filled across the tree (photos, birth dates, descriptions). Mild gamification for keeping the record alive.
- **Needs attention** (rail) — counts of people missing a birth date / photo / description. Click any row → People view filtered to those folks, with a banner at the top + Clear button.

### Contact info per person · privacy-aware

Each person carries optional `phone`, `email`, and `address`. Inspector renders rows that link via `tel:` / `mailto:` / Google Maps. Each field has its own *Private* toggle — flagged values are stripped from JSON / PNG / poster exports but stay in your local store. Useful for the part of the tree that's still alive.

### Pets / companion animals

A *Companion animal* checkbox on the form marks a person as a pet, and a separate `petOwners[]` field links the pet to its humans.

- **In the tree** the pet sits **one generation below its owners** (just like a child) and connects with a **dashed gold riser** so it reads as "bonded" rather than "biological". When a couple has only a pet (no kids), the entire trunk + rail dashes too. A small gold paw badge tops the right of the pet's photo ring.
- **Lineage focus** pulls in any pet whose owner is in lineage, so Kabir stays bright when Anil is selected.
- **View Options popover** in the tree-controls cluster (sliders icon) toggles *Show pets* on / off, plus *Show story count* and *Show dates*. Each persists per-device.

### Find a relation

A path-finder modal under Tools — pick any two people, see the shortest relationship chain rendered as avatars + relation chips (*mother / wife / son / nephew*). BFS over parents / children / spouses, so it works across blended families and multiple marriages.

When the two people are close kin, the result also names the **exact vernacular relation** — *chacha* vs *mama*, *bua* vs *mausi*, *tau* vs *chacha*, *dada* vs *nana*, and the four cousin kinds (*chachera / fufera / mamera / mausera bhai-behen*) — the words English "uncle / aunt / grandfather / cousin" collapse by side and seniority. It shows as a gold chip in the modal and inline in the tree's Compare bar. The elder/younger split (*tau* vs *chacha*) shows only when both birth years are known, and a cousin is only named by kind when both linking relatives' sides are known — otherwise it falls back to a neutral term rather than guess.

**"This is me."** Right-click any node → *This is me* to pin yourself. From then on, opening anyone's profile shows a gold chip naming **their exact relation to you** — the same vernacular vocabulary as above (your father's younger brother reads *chacha*, your mother's brother *mama*). Your own node is marked with a gold ring and a small person badge, and — right on the canvas — every close relative wears an olive **relation pill** (*chacha*, *bua*, *bhatija*…) so the whole tree reads as your kin at a glance. Turn the pills off any time under *View options → Show relation to me*. The pin is personal and stays on your device only — it's never shared with others viewing the same cloud tree, each tree remembers its own, and it never appears in an exported image — so on a family-shared tree everyone sees relations from their own vantage point. Pinning someone new moves the marker; right-click again → *Not me* to clear it.

### Print family book

Tools → *Print family book* builds a hidden DOM with one A4 page per relative (cover page + per-person bio with hero photo, lifespan, About, Achievements, Education, Stories, Notes), then opens the system print dialog. Pick *Save as PDF* and you've got a multi-page heirloom ready for spiral binding at any local print shop.

### Appearance — dark mode & high contrast

Two independent axes, both in the account / appearance menu (they leave the header uncluttered rather than sitting as loose pills):

- **Dark mode** flips the whole app to a warm-dark heritage palette. Persists per-device via `localStorage virasat.theme`. Tokens stay paired so the gold accents and olive lineage colours read correctly on both surfaces.
- **High contrast** is a separate accessibility axis (`data-contrast="high"`, stored in `virasat.contrast`) that thickens lines and deepens text against the background. It composes with light *and* dark, giving four distinct theme surfaces.

### Story-density on the tree

A small olive disc top-left of each photo ring shows the number of stories captured for that person. The tree reads as an archive map, not just a relationship diagram.

### Editable tree title

The big title above the tree (e.g. *Sharma Family Tree*) is fully editable — click the pencil to type whatever you'd like: a surname, a phrase, the family motto. The first word still gets the gold accent. The same string is printed on every PNG export.

### Offline / PWA

A service worker caches the entire app shell (HTML, CSS, JS, icons, fonts) on first visit. On returning visits the cache responds first (stale-while-revalidate) so the app boots instantly even without a network. Add to home screen on iOS / Android — `manifest.webmanifest` declares standalone display mode, the heritage theme colour, and the same icon as the favicon. The app also calls `navigator.storage.persist()` so Safari won't evict your IndexedDB photos after 7 idle days.

### Reset everything

A red rail item under Tools wipes localStorage state, IndexedDB photos, the active filter, and the inspector selection. Behind a danger confirm.

### Heritage design system

- **Palette** — ivory `#F8F6F2`, olive `#5E7D63`, gold `#B89A5A`. Light surface as default. Dark mode is an explicit opt-in via `[data-theme="dark"]`; high contrast layers on via `[data-contrast="high"]`.
- **Type** — Fraunces (display serif), Inter (UI), Noto Sans Devanagari (Hindi). Font Awesome 6 from CDN.
- **Soft pastel avatars** — name-hashed (peach / sage / lavender / sky / rose / butter / clay / mist) so each person gets the same colour everywhere.
- 20-24px radii, warm shadows, parchment textures behind the tree canvas.

### Mobile / responsive

- Hamburger button reveals the rail at < 768px.
- Inspector slides in from the right at < 1100px with an explicit close button.
- Tree pans + pinch-zooms with touch.
- Timeline scrolls horizontally with touch.

### Keyboard / gestures

- `Esc` — close any open modal
- Tree: drag to pan, wheel/pinch to zoom, controls cluster for fine-tune
- Timeline: scroll horizontally; press **Today** to jump to the year cursor
- HeritageSelect: ↑/↓ navigate, Enter selects, Esc closes, single-letter typeahead

### Other

- **No analytics, no tracking.** Third-party calls are limited to fonts.googleapis.com and the Font Awesome CDN — plus, in cloud mode, your own Supabase project for auth, tree data, and photo storage. Blank the credentials in `lib/auth/config.js` and even those go away.
- **Reduced-motion** users get the same UI without animations.
- Dark mode follows the explicit `data-theme` attribute, not system preference (heritage feels best in warm light).

---

## Quick start (local)

**Local-first mode** (credentials blank in `lib/auth/config.js`): just open `index.html` — no sign-in, no network. That's it.

If your browser blocks `file://` URLs, or you're running the **cloud-enabled** build (auth and OAuth redirects need a real origin, not `file://`):

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

For the cloud build, also add `http://localhost:8000/` to your Supabase project's **Additional Redirect URLs** (see [`docs/SUPABASE-SETUP.md`](docs/SUPABASE-SETUP.md)).

---

## Hosting on GitHub Pages

1. Push this folder to a GitHub repo.
2. **Settings → Pages → Source:** *Deploy from a branch* → branch `main`, folder `/ (root)`.
3. Save. After a minute, your tree is live at `https://<user>.github.io/<repo>/`.

`.nojekyll` is included so GitHub Pages serves files as-is.

---

## Data & privacy

- Person records: `localStorage` key `familyTree.v1` (local-first) or `familyTree.<treeId>.v1` (one cache per cloud tree).
- Photos: `IndexedDB` database `familyTree.photos`. In cloud mode the same bytes are also uploaded to a private Supabase Storage bucket, keyed `<treeId>/<photoId>.jpg`.
- Active cloud tree pointer: `localStorage` key `virasat.activeTreeId`.
- Language preference: `localStorage` key `familyTree.lang`.
- Theme / high contrast: `localStorage` keys `virasat.theme` and `virasat.contrast`.
- Inspector section open/closed: `localStorage` key `familyTree.inspector.sections`.
- Active filter: `sessionStorage` key `virasat.filter`.

In cloud mode your tree also lives in Supabase (Postgres row + Storage), reachable only to you and the people you share it with — enforced server-side by row-level security, not just the UI. Clearing site data wipes the local copy — **export first** if you're not signed in. Photos are auto-resized to 512px JPEG before being saved.

---

## File structure

```
index.html                       single-page shell (header / 3-pane body)
privacy.html                     standalone privacy policy (also served in-app)
terms.html                       standalone terms (also served in-app)
.nojekyll
assets/
  icon.svg                       app mark (used as favicon + header icon)
  apple-touch-icon.png           iOS home-screen icon
  tree.svg                       raw tree silhouette source
  wedding-rings.svg              couple-knot glyph source
  sample/                        photos for the built-in sample family
forms/
  family-tree-template.html      Google Form question reference + Apps Script
styles/
  tokens.css                     design tokens (palette, type, spacing)
  base.css                       reset + 3-pane layout
  components.css                 buttons, cards, modal, avatar, chip, toast,
                                 heritage select, date picker, png-quality
  views.css                      view-specific styles
lib/
  core/
    i18n.js                      EN/HI strings + DOM applier
    data-store.js                FamilyStore — in-memory snapshot, per-tree
                                 localStorage cache, undo/redo, cloud hydrate
    photo-store.js               IndexedDB photo blobs + cloud upload/download
  ui/
    dom.js                       UI.el / openModal / toast / confirm /
                                 emptyState / cancelBtn / saveBtn / clamp
  components/
    heritage-datepicker.js       calendar popover with year-only mode
    heritage-select.js           custom dropdown (replaces native <select>)
    crop-editor.js               two-frame photo crop editor (avatar + hero)
    path-finder.js               BFS "find a relation" modal
    inspector.js                 right-pane person details with sections
  views/
    people-view.js               list + add/edit form
    tree-view.js                 SVG tree with pan/zoom + lineage highlight
    timeline-view.js             horizontal timeline + overview minimap
    insights-view.js             stats dashboard + coming-up + calendar
  features/
    image-export.js              tree → PNG (full or lineage-only),
                                 profile → full-profile poster
    export-import.js             export modal + JSON/CSV import
    collect-form.js              Google Form template + CSV importer
    print-book.js                printable family book (one A4 per person)
    help-guide.js                in-app "How Virasat works" guide
    anniversaries.js             birthdays/memorials, .ics export, reminders
  auth/                          cloud layer — inert when config is blank
    config.js                    Supabase URL + anon key + bucket (edit me)
    auth-store.js                client, sign-in (password/OAuth/magic-link)
    cloud-store.js               tree load/push, version guard, realtime
    sign-in.js                   splash gate + sign-in screen + account menu
    tree-list.js                 tree switcher + create
    sharing.js                   invite-by-email + member / role list
    first-run.js                 one-time local→cloud tree migration
  legal-page.js                  in-app privacy / terms overlay renderer
  app.js                         view router, rail wiring, filters, boot gate,
                                 service-worker registration
manifest.webmanifest             PWA install metadata
sw.js                            service worker (offline-first cache)
docs/
  ROADMAP.md                     priority-ranked feature backlog
  ISSUES.md                      open bugs + tech-debt + resolved log
  CLAUDE.md                      working agreement, taste rules
                                 (read-this-first for any new agent)
  CONTEXT.md                     architectural reference (data model,
                                 module map, key flows, footguns)
  CLOUD-SYNC-PLAN.md             cloud migration plan + phase log
  SUPABASE-SETUP.md              filled-in backend setup checklist
```

---

## Roadmap

Future feature ideas live in [`docs/ROADMAP.md`](docs/ROADMAP.md) — priority-ranked P1–P5, with shipped items struck through and folded into Features above. Bug list + tech-debt at [`docs/ISSUES.md`](docs/ISSUES.md). For agents picking the project up: [`docs/CLAUDE.md`](docs/CLAUDE.md) is the working agreement and taste rules; [`docs/CONTEXT.md`](docs/CONTEXT.md) is the architectural reference.

---

## Credits

No build step and no bundler. Runtime dependencies are Google Fonts and Font Awesome 6 (CDN) always, plus the Supabase JS SDK (CDN, loaded only when cloud credentials are set). Vanilla DOM throughout.
