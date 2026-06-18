# Virasat — Architectural Context

This is the long-form reference: data model, module relationships, sequence flows, and the "why" behind decisions that look weird at first read. Pair with `docs/CLAUDE.md` (the working agreement) and `README.md` (the user-facing pitch).

---

## 1 · The shape of the app

```
[ index.html ]
     │
     │ loads in order:
     │
     ├── styles/tokens.css        — CSS variables, light + dark themes
     ├── styles/base.css          — layout, typography reset
     ├── styles/components.css    — buttons, chips, cards, modal, picker
     ├── styles/views.css         — view-specific (tree / people / timeline)
     │
     ├── lib/utils/i18n.js                — EN/HI strings + DOM applier
     ├── lib/utils/data-store.js          — FamilyStore (the single API surface)
     ├── lib/utils/photo-store.js         — IDB-backed photo blobs
     ├── lib/utils/ui-utils.js            — UI.el, UI.openModal, UI.toast, UI.confirm
     │
     ├── lib/components/
     │   ├── heritage-datepicker.js       — calendar popover with year-only mode
     │   ├── heritage-select.js           — custom <select> replacement
     │   ├── crop-editor.js               — two-frame photo cropping modal
     │   ├── path-finder.js               — "find a relation" BFS modal
     │   ├── inspector.js                 — right-pane person view
     │   └── profile-view.js              — fallback full-page profile
     │
     ├── lib/views/
     │   ├── people-view.js               — list / search / form
     │   ├── tree-view.js                 — SVG tree + lineage focus
     │   └── timeline-view.js             — horizontal lifespan bars
     │
     ├── lib/features/
     │   ├── image-export.js              — tree → PNG, profile → poster
     │   ├── export-import.js             — JSON export modal + CSV import
     │   ├── collect-form.js              — Google Form template + import
     │   └── print-book.js                — print-stylesheet driven family book
     │
     ├── lib/app.js                       — view router, rail wiring, theme toggle
     ├── manifest.webmanifest             — PWA install metadata
     └── sw.js                            — service worker (offline-first)
```

Every JS file is an IIFE attaching to `window.<Namespace>`. There's no module bundler. Initialization flow is "load all scripts → `app.js` runs → mounts each view's container".

---

## 2 · `FamilyStore` — the single API surface

This is the load-bearing module. Every view, every feature, every export reads or mutates the family-tree state through here.

### State shape

```js
{
  version: 2,              // SCHEMA_VERSION
  meta: {
    familyName: string,    // legacy, first word
    familyTitle: string,   // free-form, e.g. "Sharma Family Tree"
    createdAt: ISO
  },
  people: [
    {
      id: "p_xxx",
      name: string, name_hi: string,
      photo: base64 | null,            // legacy, auto-migrated to IDB
      photoId: string | null,          // IDB blob key
      photoUrl: string | null,         // committed asset path (sample data)
      photoCropAvatar: { x, y, scale } | null,
      photoCropHero: { x, y, scale } | null,
      birthDate: "YYYY[-MM[-DD]]" | null,
      birthDatePrecision: "exact" | "about" | "before" | "after" | null,
      deathDate, deathDatePrecision,   // same shape
      birthPlace, birthPlace_hi, deathPlace, deathPlace_hi,
      gender: "male" | "female" | "other" | null,
      occupation, occupation_hi,
      description, description_hi,
      achievements: string[], achievements_hi: string[],
      education: string[], education_hi: string[],
      notes, notes_hi,
      stories: [{ id, title, body, tags[], createdAt, updatedAt }, ...],
      contact: {
        phone, email, address,
        privatePhone: bool, privateEmail: bool, privateAddress: bool
      },
      isPet: bool,
      petOwners: string[],             // ids of bonded humans
      parents: string[],
      spouses: string[],
      createdAt: ISO, updatedAt: ISO
    }
  ],
  marriages: {
    "<sortedAId>|<sortedBId>": {
      date, place, story, photoId, photo, createdAt, updatedAt
    }
  }
}
```

### Public API (≈30 methods)

Categorised by what they do:

**Pure helpers (no state, no IO)** — `parseDate`, `getYear`, `isAlive`, `isDeceased`, `calcAge`, `formatDateRange`, `formatDateWithPrecision`, `fileToDataURL`, `initials`, `getField`, `isMissingHindi`, `marriageKey`, `relationLabel`. Move these between modules freely; they're functions of their args.

**Reads (sync, over local snapshot)** — `getState`, `getPeople`, `getPerson`, `getChildrenOf`, `getSiblingsOf`, `buildGenerations`, `getMarriage`, `getFamilyName`, `getFamilyTitle`, `searchStories`, `upcomingAnniversaries`, `maintenanceStats`, `peopleMissing`, `findRelationPath`. These will stay sync after a cloud-sync migration; the local snapshot is the cache.

**Mutations (call `persist()`)** — `addPerson`, `updatePerson`, `deletePerson`, `replaceAll`, `clearAll`, `setFamilyName`, `setFamilyTitle`, `setMarriage`, `deleteMarriage`, `addStory`, `updateStory`, `deleteStory`. These are the swap points for cloud sync.

**Plumbing** — `subscribe(fn)`, `setMute`, `notifyAll`, `flushPersist`. `subscribe` returns an unsubscribe function. `setMute(true)` lets bulk operations (photo migration on first load) skip per-call notifications.

**Sample fixture** — `sampleData()`. 14-person 4-generation Sharma family with a beagle. Stable IDs (`p_anil`, `p_g_rs`, etc.) — known footgun if a user imports the sample then a public-shared user clicks the sample CTA on top of it.

### `persist()` lifecycle

```
mutation API → mutates `state` → calls persist({silent?}) → 
  ├── schedules debounced flushPersist (250 ms)
  └── synchronously notifies listeners (unless `mute` flag)

flushPersist → JSON.stringify(state) → localStorage.setItem
              (also fires on beforeunload, pagehide, visibilitychange=hidden)

cross-tab `storage` event → state = load() → notifies listeners
```

Listeners are 5 today: app.js (view re-render + rail counts), inspector.js (panel re-render), profile-view.js (modal re-render), and two local subscribers in story / family blocks.

---

## 3 · Photo flow

Photos are blobs in IndexedDB (`familyTree.photos` database, `photos` object store). The store has three resolution sources for a given person:

1. `person.photoUrl` — committed asset path (used by sample data: `assets/sample/p33.jpg`). Highest priority.
2. `person.photoId` — IDB blob key. Resolved to a Blob URL on demand, cached in `urlCache: Map<id, objectUrl>`.
3. `person.photo` — base64 data URL. Legacy / freshly-imported. Auto-migrated to `photoId` on next page load via `migrateLegacy()`.

### Read API

- `PhotoStore.getUrl(person)` — async, returns the resolved URL or null. Caches the Object URL.
- `PhotoStore.getUrlSync(person)` — sync, returns whatever's already cached or null. Used for first paint; the caller swaps in async result on `getUrl(...).then`.
- `PhotoStore.bindImg(imgEl, person, fallback)` — sets `imgEl.src` from sync source, falls back to async.

### Write API

- `PhotoStore.put(blob)` — async, returns a promise of `photoId`. Picks a random key inside the IDB transaction (with retry on collision), so concurrent puts can't collide.
- `PhotoStore.putWithKey(id, blob)` — async, writes at a specific id. Used by the JSON importer to preserve photoIds across round-trip.
- `PhotoStore.fileToPhotoId(file)` — pipeline: read → resize to 512 px JPEG @ 0.85 → put → return id.
- `PhotoStore.delete(id)` — drops the blob and revokes the cached Object URL.

### IDB transaction wrapper (`txValue`)

The wrapper deserves its own paragraph because it's been wrong before:

```js
function txValue(mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const s = t.objectStore(STORE);
    let value, captured = false, error = null;
    function fail(e) { error = e; try { t.abort(); } catch (_) {} }
    try { fn(s, (v) => { value = v; captured = true; }, fail); }
    catch (e) { fail(e); reject(error); return; }
    t.oncomplete = () => {
      if (error) reject(error);
      else if (captured) resolve(value);
      else resolve(undefined);
    };
    t.onerror = () => reject(error || t.error);
    t.onabort = () => reject(error || t.error || new Error("Transaction aborted"));
  });
}
```

Plus a `safe(cb, fail)` helper that wraps every IDB callback so a sync throw inside `onsuccess`/`onerror` aborts the transaction. Don't simplify this — the earlier version resolved with `null` for sync results before the inner promise settled, which caused photoIds to come back as `null` even though the write landed.

### Migration on boot

`PhotoStore.ready()` resolves once `migrateLegacy()` has walked every person + every marriage and converted base64 `photo` fields to IDB `photoId`. During migration, `setMute(true)` keeps subscribers from re-rendering N times for N migrations; `notifyAll()` fires once at the end.

---

## 4 · Tree-view internals

`tree-view.js` is the largest module by far (~1700 lines). The shape:

### Layout pipeline

```
render() →
  computeLayout(people) →
    1. buildGenerations()           — graph walk, pets +1 below owners
    2. group by gen → rows          — Map<gen, person[]>
    3. sort gen 0 by birth year
    4. sort subsequent gens by parentAnchorIndex (cousin clustering)
    5. placeRow(g) for each gen     — places couples adjacent, returns
                                       order + couple-pair indices
    6. emit positions: Map<id, {x, y, person, gen, rowIdx}>
  drawEdges(positions) →
    1. group children by sorted parent ids
    2. for each group:
       — split into humans + pets
       — humans get solid trunk + rail + risers
       — pets get their own end-to-end dashed path (continuous stroke)
    3. couple knots (gold rings + heart) painted last
  drawNodes(positions) →
    for each person:
      — photo ring + photo (or initials)
      — name text
      — date subtitle (if showDates)
      — pet paw badge (if isPet) top-right
      — story-density chip (if storyCount > 0 && showStoryCount) top-left
      — selected/lineage focus halo
```

### Topology-signature gated render

`render()` first computes:

```js
sig = topoSignature(people, state.marriages, viewToggles)
```

Where the signature folds in `(parents, spouses, petOwners, isPet, deathDate truthy, story-count > 0, photo presence, marriages keys, view toggles)`. If `sig === lastTopoSig`, `render()` skips layout + DOM rebuild and just patches text content on existing `.t-node` elements via `softUpdateNodes()`. This is what makes typing in a name field cheap on a 100-person tree.

Things that should bust the signature: anything structural (gaining/losing a story chip, gaining/losing a photo, marriages changing, pets toggle changing). Anything that should NOT bust: pure text edits to name / date / description. The cosmetic patches handle those.

### Lineage focus

```js
lineageOf(rootId) → Set<id>
  — rootId itself
  — every spouse (co-roots)
  — descendants from each co-root (BFS)
  — every spouse of every descendant
  — every pet whose owner is in the set
```

`applyHighlightClasses()` toggles `.is-selected` / `.is-lineage` / `.is-faded` classes on nodes + edges + couple knots based on this set. Edges check their `data-edge-ids` (a comma-list of person ids) against the set — an edge is in-lineage iff every id is in the set.

### Pet edges (the recent rewrite)

When a parents-group has both human children and pets, the human children share a solid trunk + rail + risers. Each pet gets its own continuous dashed path:

```
M anchorX,anchorY
  L anchorX,railY-r
  Q anchorX,railY anchorX±r,railY     ← rounded corner
  L petX∓r,railY
  Q petX,railY petX,railY+r           ← rounded corner
  L petX,petY
```

One `<path>` element per pet so the dash pattern is seamless across both corners. Don't go back to the shared-rail approach — the dash discontinuity at corners read as broken.

### View options popover

Sliders icon in the tree controls cluster opens a popover with three pill switches: *Show pets*, *Show story count*, *Show dates*. Each persists per-device (localStorage `virasat.showPets` etc.) and triggers a full render. Outside-click closes the popover.

---

## 5 · Inspector internals

The right-side panel. Two modes:

1. **No selection (empty state):** renders Family Highlights (oldest ancestor, latest addition, most stories, next anniversary cards) + Family Archive completion bar. Re-renders on every store change.
2. **Person selected:** renders header (avatar + name + lifespan chips) + action row (Note / Share / Edit / Delete) + collapsible sections (About, Personal info, Achievements, Education, Family, Contact, Stories, Photo, Notes).

Section collapse state persists in `localStorage["familyTree.inspector.sections"]` keyed by section id. When the user opens story-search results via header search, `Inspector.show(personId, { scrollToStoryId })` force-opens the Stories section, scrolls the matching `.story-card` into view, and adds a brief `.is-flash` class for a gold-halo animation.

---

## 6 · Service worker

`sw.js` precaches the app shell on install (`SHELL` array) plus Google Fonts CSS + Font Awesome CSS via a `CDN_SHELL` array (with `mode: "no-cors"` because the CDN doesn't always send permissive CORS).

Fetch handler:
- `sw.js` itself: bypass cache (network direct). Otherwise update detection breaks.
- Cross-origin font/icon requests: cache-first (CDN_CACHE).
- Same-origin GET: stale-while-revalidate (RUNTIME_CACHE serves cached + refreshes in background).
- Non-GET, navigation fallback to `./index.html` if offline.

`CACHE_VERSION` is part of every cache name (`virasat-shell-v2`, etc.). Bump it whenever the SHELL list changes — the activate handler deletes any cache starting with `virasat-` that isn't in the current version's set.

When the cloud-sync work lands, the fetch handler will need a Supabase-bypass branch (any URL ending `.supabase.co` → pass through to network, no caching).

---

## 7 · Theme tokens

`tokens.css` exposes the light theme as `:root` variables and a dark theme override under `:root[data-theme="dark"]`. Key tokens:

- `--bg`, `--bg-elev`, `--bg-sunken`, `--surface`, `--surface-2`, `--surface-3` — backgrounds.
- `--text`, `--text-2`, `--text-3`, `--text-4` — text shades.
- `--olive`, `--olive-deep`, `--olive-soft` — primary accent (structural).
- `--gold`, `--gold-deep`, `--gold-soft` — secondary accent (importance signal).
- `--rust` — destructive / death markers.
- `--av-{peach,sage,lavender,sky,rose,butter,clay,mist}` + matching `-ink` — name-hashed avatar pastels.

The dark theme **brightens `--olive-deep` and `--gold-deep`** rather than overriding component CSS per-by-per. This is intentional — any "color: olive-deep on bg: olive-soft" pairing in the codebase reads correctly in both modes without per-component dark-mode rules.

Theme persists in `localStorage["virasat.theme"]`. Toggle is a sun/moon pill in the header.

---

## 8 · Data round-trip (export → import)

`export-import.js` builds a redacted state from `FamilyStore.getState()`:

- `buildRedactedStateAsync(opts)` — for the actual export. Inlines photos as base64, applies field toggles (includePhotos, includeDates, includeLocations) + privacy flags, normalises marriage keys.
- `buildRedactedStateSync(opts)` — for the live size-estimate chip. Same redaction, but photos are placeholders.

Field-toggle flow:
```
applyFieldToggles(out, opts) →
  — if !includeDates: drop birthDate, deathDate
  — if !includeLocations: drop birthPlace*, deathPlace*
  — if !includePhotos: drop photo, photoId, photoUrl
  — for each contact field: if private*, blank the value
  — strip privacy flags themselves
  — drop empty contact objects
```

`MINIMAL_FIELDS` allowlist for minimal-mode exports: `id, name, parents, spouses, gender, createdAt, updatedAt, name_hi`.

Import path: `replaceAll(parsed)` flushes any pending debounce, normalises marriage keys via `marriageKey()`, replaces state, calls `PhotoStore.migrateLegacy()` to convert any base64 photos in the imported data to IDB blobs.

---

## 9 · Naming + ID conventions

- Person ids: `crypto.randomUUID().slice(0, 12)` prefixed with `p_` (e.g., `p_a1b2c3d4e5f6`). Sample data uses stable hand-written ids for screenshots.
- Story ids: same pattern, prefixed `s_`.
- Photo ids: `ph_<random6><dateB36-4><counter>`. Counter prevents same-millisecond collisions on the fallback path.
- Marriage keys: `<sortedIdA>|<sortedIdB>` — always re-keyed via `marriageKey()` to keep lookup deterministic.
- Storage keys (localStorage): `familyTree.v1` (legacy state), `familyTree.lang`, `familyTree.inspector.sections`, `virasat.theme`, `virasat.showPets`, `virasat.showStoryCount`, `virasat.showDates`, `virasat.timelinePxPerYear`. Sessionstorage: `virasat.filter`, `virasat.persistWarned`.
- IDB databases: `familyTree.photos` (one bucket today; needs scoping for multi-tree).

---

## 10 · Bilingual (EN/HI) data model

Every textual person field has an `_hi` companion: `name`/`name_hi`, `birthPlace`/`birthPlace_hi`, `occupation`/`occupation_hi`, `description`/`description_hi`, `achievements`/`achievements_hi`, `education`/`education_hi`, `notes`/`notes_hi`, `deathPlace`/`deathPlace_hi`.

`FamilyStore.getField(person, key)` resolves: if lang is `"hi"` AND `_hi` is non-empty, return that; else return the EN. For arrays, item-by-item resolution.

The form has paired EN/HI inputs side-by-side. There's no auto-translate — empty `_hi` falls back to `_en`.

`I18n` (in `lib/utils/i18n.js`) covers the static UI strings (button labels, section headings, empty-state copy). Dictionary in `dict.en` and `dict.hi`. The DOM applier walks `[data-i18n]`, `[data-i18n-placeholder]`, `[data-i18n-title]` and rewrites on language change.

---

## 11 · The PWA bits

- `manifest.webmanifest` declares `display: standalone`, the heritage theme color, and the icon (a JPG generated from the SVG).
- SW registration in `app.js` (skipped on `file://`).
- `navigator.storage.persist()` called once per session to ask the OS to keep IDB blobs around past 7-day idle on iOS Safari.
- Boot-time trace logs `[Virasat] loaded — N people, M marriages, K chars` to console so a user reporting "data went away" can be triaged from DevTools.

---

## 12 · Things that went wrong before, captured here so they don't again

- **Crop drag math.** Three iterations: per-axis-slack (broken at scale=1 on aspect-mismatched frames), then divide-by-scale (sluggish), now manual `<img>` sizing + `transform: translate` + `MIN_SCALE = 1.05` floor.
- **Pet placement.** Three iterations: top-row diagonal tether (looked broken), same-row-as-owners (cluttered the couple), now one-gen-below as a child-with-dashed-edge.
- **Pet edges.** Two iterations: shared rail with mixed group → dash discontinuity at corners. Now per-pet continuous dashed path.
- **Inspector accordion focus.** UA default outline traced the row's bounding box and touched the icon. Replaced with inset gold outline.
- **People grid single-result height.** `align-content: stretch` (CSS default) stretched a single card to the full container height. Fixed with `align-content: start` + `align-items: start`.
- **Search returning people only.** Story matches were buried — now story-result cards appear above person cards with snippet + highlight + click-to-scroll-and-flash.
- **Wedding-knot halo.** 3 stacked white shadows + 3 px gold glow read as a halo. Reduced to two 0.6 px white shadows.
- **Dark-mode active-state read as disabled.** Olive-deep on near-black olive-soft. Fixed by token-level brightening of olive-deep + gold-deep in dark, not per-component overrides.
- **Crop drag only works on one axis.** `object-fit: cover` only overflows on one axis. Switched to manual sizing + 1.05× minimum scale so both axes always have slack.

---

## 13 · Open architectural questions (worth thinking about before they bite)

1. **Tree layout doesn't lay out pets consistently when they have multiple owners.** Today we anchor on `petOwners[0]` for the riser. If owners are in different generations, the placement is the deeper one and the connection looks weird from the shallower owner's view.
2. **`sampleData()` IDs are stable across all users.** A public-share collision bug. Mitigated by gating the sample CTA on `role === 'owner'` once auth lands.
3. **Schema versioning never had to do work yet.** When the first breaking change comes (likely splitting `parents[]` into `father`/`mother` if relationship-tagging lands), we'll need a real migration path. Today every additive field defaults via `||` in `normalizePerson`.
4. **Per-tree state scoping** is needed before the multi-tenant cloud sync ships. Inspector section state, timeline zoom, view toggles, filter — all currently global. List in `docs/ROADMAP.md` § P3.5.
5. **IDB photo bucket leaks across trees.** One DB for all. Will need per-tree scoping (one DB per tree, or compound `${treeId}|${photoId}` keys) before multi-tree.

---

— Last updated 2026-06-19. When making changes that contradict this file, update the file in the same commit.
