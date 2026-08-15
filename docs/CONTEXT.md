# Virasat — Architectural Context

This is the long-form reference: data model, module relationships, sequence flows, and the "why" behind decisions that look weird at first read. Pair with `docs/CLAUDE.md` (the working agreement) and `README.md` (the user-facing pitch).

---

## 1 · The shape of the app

```
[ index.html ]
     │
     │ loads in order:
     │
     ├── styles/tokens.css        — CSS variables; light/dark × normal/high-contrast
     ├── styles/base.css          — layout, typography reset
     ├── styles/components.css    — buttons, chips, cards, modal, picker
     ├── styles/views.css         — view-specific (tree / people / timeline / insights)
     │
     ├── (CDN) Supabase JS SDK            — UMD <script>, only when cloud is configured
     │
     ├── lib/core/
     │   ├── i18n.js                      — EN/HI strings + DOM applier
     │   ├── data-store.js                — FamilyStore (the single API surface)
     │   └── photo-store.js               — IDB blobs + cloud Storage adapter
     │
     ├── lib/ui/
     │   └── dom.js                       — UI.el, UI.openModal, UI.toast, UI.confirm,
     │                                      UI.emptyState, UI.cancelBtn, UI.saveBtn, UI.clamp …
     │
     ├── lib/auth/                        — cloud layer; inert when config is blank
     │   ├── config.js                    — VirasatConfig: supabaseUrl / anonKey / bucket
     │   ├── auth-store.js                — client + sign-in (password / OAuth / magic-link)
     │   ├── cloud-store.js               — tree load/push, version guard, realtime
     │   ├── sign-in.js                   — splash gate + sign-in screen + account menu
     │   ├── tree-list.js                 — tree switcher + create
     │   ├── sharing.js                   — invite-by-email + member / role list
     │   └── first-run.js                 — one-time local→cloud tree migration
     │
     ├── lib/components/
     │   ├── heritage-datepicker.js       — calendar popover with year-only mode
     │   ├── heritage-select.js           — custom <select> replacement
     │   ├── crop-editor.js               — two-frame photo cropping modal
     │   ├── path-finder.js               — "find a relation" BFS modal
     │   └── inspector.js                 — right-pane person view
     │
     ├── lib/views/
     │   ├── people-view.js               — list / search / form
     │   ├── tree-view.js                 — SVG tree + lineage focus
     │   ├── timeline-view.js             — horizontal lifespan bars + minimap
     │   └── insights-view.js             — stats dashboard + coming-up + calendar
     │
     ├── lib/features/
     │   ├── image-export.js              — tree → PNG, profile → poster
     │   ├── export-import.js             — JSON export modal + CSV import
     │   ├── collect-form.js              — Google Form template + import
     │   ├── print-book.js                — print-stylesheet driven family book
     │   ├── help-guide.js                — in-app "How Virasat works" guide
     │   └── anniversaries.js             — birthdays/memorials, .ics, reminders
     │
     ├── lib/legal-page.js                — in-app privacy / terms overlay renderer
     ├── lib/app.js                       — view router, rail wiring, boot gate
     ├── manifest.webmanifest             — PWA install metadata
     └── sw.js                            — service worker (offline-first)
```

Every JS file is an IIFE attaching to `window.<Namespace>`. There's no module bundler. Initialization flow is "load all scripts → `app.js` wires the DOM synchronously → **boot gate** (`Auth.ready()`): in cloud mode it waits for a session and the first remote tree load before mounting views; in local mode it mounts immediately". See §14 for the cloud layer and boot sequence.

The two standalone pages `privacy.html` / `terms.html` are plain static HTML (also reachable in-app via `legal-page.js` overlays), so a link shared to someone who never opens the app still resolves.

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
      photo: base64 | null,            // pre-migration data URL, auto-moves to IDB
      photoId: string | null,          // IDB blob key (post-migration)
      photoCropAvatar: { x, y, scale } | null,
      photoCropHero: { x, y, scale } | null,
      gallery: [{ id: "g_xxx", photoId, photo, caption, caption_hi }, ...],  // extra photos
      documents: [{ id: "doc_xxx", photoId, photo, title, title_hi, kind }, ...], // scanned sources
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
      unknownParents: ("father"|"mother")[],  // a known-missing parent slot, so the form
                                               // can show "father unknown" without a node
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

### Public API

Categorised by what they do:

**Pure helpers (no state, no IO)** — `parseDate`, `getYear`, `isAlive`, `isDeceased`, `calcAge`, `formatDateRange`, `fileToDataURL`, `initials`, `getField`, `marriageKey`, `relationLabel`. Move these between modules freely; they're functions of their args.

**Reads (sync, over the in-memory snapshot)** — `getState`, `getPeople`, `getPerson`, `getChildrenOf`, `getSiblingsOf`, `buildGenerations`, `getMarriage`, `getFamilyName`, `getFamilyTitle`, `searchStories`, `upcomingAnniversaries`, `maintenanceStats`, `peopleMissing`, `findRelationPath`. **All reads stay synchronous even in cloud mode** — the snapshot is the source of truth; the cloud layer only ever *hydrates* it (§14). Nothing in the view layer became async.

**Mutations (call `persist()`)** — `addPerson`, `updatePerson`, `deletePerson`, `replaceAll`, `clearAll`, `setFamilyName`, `setFamilyTitle`, `setMarriage`, `deleteMarriage`, `addStory`, `updateStory`, `deleteStory`. Every one funnels through `persist()` — the single seam the cloud pusher and the undo timeline both hook.

**Undo / redo** — `undo`, `redo`, `canUndo`, `canRedo` (§2a). A ring of whole-tree JSON snapshots; not persisted, per-device.

**Cloud hydrate / active-tree** — `hydrateFromRemote(data, version)`, `setActiveTree(treeId)`, `getActiveTreeId`, `getVersion`, `setVersion`, `onDirty(fn)`, `purgeLocalTree`. These are the cloud layer's only entry points into the store; `data-store.js` itself never imports the SDK. `hydrateFromRemote` deliberately does **not** `markDirty()` — server data isn't a local edit, and flagging it would loop push→echo→hydrate.

**Read-only gate** — `setReadOnly(bool)`, `isReadOnly()`. A viewer-role tree flips this on; mutations become no-ops and the UI hides edit affordances (§14).

**Plumbing** — `subscribe(fn)`, `setMute`, `notifyAll`, `flushPersist`. `subscribe` returns an unsubscribe function. `setMute(true)` lets bulk operations (photo migration on first load) skip per-call notifications.

**Sample fixture** — the sample family lives in `tests/sample-data.js` (`window.SampleData.build()`), not in the store. Stable IDs (`p_anil`, etc.) — known footgun if the sample CTA is clicked on top of an existing tree, so the CTA is gated on `role === 'owner' && getPeople().length === 0` (§13).

### `persist()` lifecycle

`persist()` splits into three concerns but still notifies **synchronously**, so the sync-read contract holds:

```
mutation API → mutates `state` → persist({silent?, mute?}) →
  ├── records an undo snapshot (unless silent/mute — see §2a)
  ├── schedules debounced local-cache write (per-tree localStorage)
  ├── markDirty()  — flags the cloud pusher (no-op in local mode)
  └── synchronously notifies listeners (unless `mute` flag)

debounced write → JSON.stringify(state) → localStorage.setItem(cacheKey)
              (also flushed on beforeunload, pagehide, visibilitychange=hidden)

cross-tab `storage` event  ─┐
realtime remote UPDATE     ─┴─→ if clean: hydrateFromRemote(); notify
                                if dirty:  fire virasat:cross-tab-conflict (§14)
```

The cache key is **per active tree** (`familyTree.<treeId>.v1`) in cloud mode, or the legacy `familyTree.v1` in local mode — so two cloud trees never overwrite each other's offline snapshot.

Listeners today: `app.js` (view re-render + rail counts), `inspector.js` (panel re-render), and `cloud-store.js` (dirty-flag / push). `subscribe` is also used ad-hoc by feature blocks.

### 2a · Undo / redo

A ring of **whole-tree JSON snapshots** — the exact payload `flushPersist()` already produces, so serializing is free work the store does anyway.

- `baselineStr` is the serialized present. `undoStack` holds prior states (oldest→newest), `redoStack` holds undone states. `HISTORY_LIMIT` caps the ring; the oldest undo step drops when full.
- `captureHistory()` runs inside `persist()` **after** the mute/silent gate — so bulk photo migration doesn't fragment the timeline (it re-baselines at the end instead). A serialized no-op (Save with nothing changed) is ignored so it can't push a dead step or wrongly clear redo. Any genuine edit clears `redoStack` (no redo past a fork).
- `undo()`/`redo()` move the present between stacks, then `applySnapshot()` installs the string **without** re-normalizing (it's our own already-normalized output). Stacks + baseline update *before* `notifyAll()`, so a listener like the header's undo/redo enable-state reads the final `canUndo()`/`canRedo()`.
- The stack is **per-device and not persisted**; `resetHistory()` clears it on boot, tree switch, and remote hydrate — no undo can cross those boundaries, so undo never fights sync. In cloud mode `applySnapshot()` *does* `markDirty()`, so an undo pushes as a new LWW version rather than silently diverging from the server.
- **Footgun:** a delete/reset frees photo blobs asynchronously (fire-and-forget), so undoing a delete restores the person record but the photo may already be gone from IDB — the render falls back to initials.

The UI is a two-button trio (Undo / Redo + divider, `.tree-controls__hist`) in the tree-controls cluster, plus global `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z` (and `Ctrl+Y`) shortcuts wired in `app.js`, ignored while a text field is focused (the browser's native text-undo owns Z there). Buttons dispatch `virasat:undo` / `virasat:redo` events; `app.js` calls the store and both views sync their disabled state on the next notify.

---

## 3 · Photo flow

Photos are blobs in IndexedDB (`familyTree.photos` database, `photos` object store). The store has two resolution sources for a given person:

1. `person.photoId` — IDB blob key. Resolved to a Blob URL on demand, cached in `urlCache: Map<id, objectUrl>`.
2. `person.photo` — base64 data URL. Pre-migration / freshly-imported. Auto-migrated to `photoId` on next page load via `migrateLegacy()`.

Sample data ships with photos already inlined as base64 (`tests/inline-sample-photos.mjs` does the conversion from `assets/sample/*.jpg`). The legacy `photoUrl` field that pointed at committed asset paths was removed 2026-06-19 — backups are now fully self-contained.

### Read API

- `PhotoStore.getUrl(person)` — async, returns the resolved URL or null. Caches the Object URL.
- `PhotoStore.getUrlSync(person)` — sync, returns whatever's already cached or null. Used for first paint; the caller swaps in async result on `getUrl(...).then`.

### Write API

- `PhotoStore.put(blob)` — async, returns a promise of `photoId`. Picks a random key inside the IDB transaction (with retry on collision), so concurrent puts can't collide.
- `PhotoStore.putWithKey(id, blob)` — async, writes at a specific id. Used by the cloud-download path to repopulate the IDB cache under a photo's original id.
- `PhotoStore.fileToPhotoId(file)` — pipeline: read → resize to 512 px JPEG @ 0.85 → put → return id. In cloud mode it also uploads the blob to Storage (best-effort, after the IDB put).
- `PhotoStore.delete(id)` — drops the blob and revokes the cached Object URL. In cloud mode it also fires a best-effort Storage `remove()`.

### Cloud adapter (cloud mode only)

When `VirasatConfig` is set, the same blobs are mirrored to a **private** Supabase Storage bucket at object path `<treeId>/<photoId>.jpg`:

- **Upload** happens inside `fileToPhotoId`, after the IDB put — fire-and-forget, `upsert: true` (idempotent). A failed upload leaves the photo in IDB and visible locally; it just isn't durable cross-device until a later sync. Never throws into the caller.
- **Download fallback** is a middle step inside `getUrl`: IDB miss → `storage.download()` (RLS-checked by the caller's JWT) → repopulate IDB via `putWithKey(id, blob)` under the photo's *original* id → objectURL. Every render site already does `getUrlSync() → null → getUrl()`, so a freshly-loaded remote tree paints initials first, then swaps photos in — transparent.
- **IDB keys stay FLAT** (the bare `photoId`), **not** compound `<treeId>|<photoId>` as an earlier plan proposed. The treeId lives only in the Storage object path, resolved fresh per call from `getActiveTreeId()`. `resetCache()` revokes and drops all cached object URLs on a tree switch so one tree's photos can't bleed into another's render (see §13, now resolved this way).

Print/export await note: `image-export.js` and `print-book.js` must `await` every `getUrl()` before rendering — on a cold remote tree the blobs aren't in IDB yet, and a `.then`-after-`print()` path would produce blank photos.

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

A deceased person's header renders an **In Memoriam** treatment (`.inspector-hero--memoriam`: a "in loving memory" eyebrow + parchment wash). This is a render treatment keyed off `isDeceased(person)`, **not** a stored field — the People list and tree node show the same quiet feather glyph the same way.

---

## 5a · Insights view

`insights-view.js` is a read-only dashboard computed entirely from `getPeople()` (filter-aware — the shared `window.Filter` narrows the set, and `setFilter()` is just a full re-render). Layout in `render()`:

1. **Headline stat cards** (`.insight-cards`) — people, generations, average lifespan, living, remembered.
2. **Stat panels** (`.insight-panels`) — gender split, born-by-decade histogram, recurring first names, roots (birthplaces), eldest/youngest. Packed with **CSS multi-column** (`columns: 320px 3`) so panels of very different heights balance into columns with no row-based dead space; `break-inside: avoid` keeps each panel whole.
3. **Full-width bands** (`.insight-bands`, a flex column) — the whole-family **Coming up** list and the **Family calendar**. These live *outside* the multicol on purpose: a `column-span:all` child inside it forced the balancer to leave a tall gap beside the last short column (a bug fixed by pulling the wide bands into their own flow).

**Coming up** and the **calendar** both read from `Anniversaries.events()` and share one `eventRow()` builder and one `openEventsModal()` (a scrollable modal of clickable person rows). Coming up shows the first 6, then a "+N more" that opens the whole year ahead in that modal. The calendar is a compact month grid; a marked day carries a small type icon (cake = birthday, feather = memorial) and opens the same modal for that day. Clicking any row dispatches `virasat:reveal-in-tree` (the same seam Timeline/People use) to reveal the person on the canvas.

## 5c · Anniversaries

`lib/features/anniversaries.js` is the single source for date-derived events. `events()` returns birthdays and memorials over `HORIZON_DAYS = 365`, each `{ person, kind: "birth"|"death", date, daysAway, ageOrYears }`, emitting exactly one entry per (person, kind) — no calendar-day duplicates. Helpers: `eventTitle`, `eventMeta`, `relLabel`, `dateLabel` (locale `hi-IN`/`en-GB`), plus `exportIcs()` (a `.ics` any calendar app imports) and the reminder opt-in (`remindersEnabled`/`setReminders`, backed by `localStorage["virasat.anniversaryReminders"]` and same-day Notifications delivered through the service worker's `notificationclick`). Deliberately whole-family and **never filtered** — a reminder you'd want shouldn't disappear because a facet is active.

---

## 6 · Service worker

`sw.js` precaches the app shell on install (`SHELL` array — every HTML/CSS/JS file, now including the `lib/auth/*` scripts and the two legal pages) plus the Google Fonts CSS and Font Awesome CSS via a `CDN_SHELL` array.

The CDN CSS is fetched in **CORS mode (the default), NOT `no-cors`** — the page loads Font Awesome's CSS with `integrity=… crossorigin`, and Subresource Integrity **cannot** be verified against an opaque (`no-cors`) response, so a cached opaque body would make the browser reject the stylesheet and icons would silently vanish until a hard refresh. Both CDNs send `access-control-allow-origin: *`, so a normal CORS fetch yields a verifiable 200. The handler only ever caches a real `200` whose `type !== "opaque"`.

Fetch handler, in order:
- **`*.supabase.co` → return early, never cache.** Auth / data / Storage responses are per-user, auth'd, and change constantly. (The cross-origin bail below would already let these through; this explicit guard makes the intent survive any reordering.)
- **CDN hosts** (`fonts.googleapis.com`, `fonts.gstatic.com`, `cdnjs.cloudflare.com`, `cdn.jsdelivr.net` for the Supabase SDK) → cache-first, never storing an opaque response.
- Any other cross-origin → pass through.
- `sw.js` itself → network direct (a cached copy would freeze the version number).
- Same-origin GET → stale-while-revalidate (RUNTIME_CACHE serves cached + refreshes in background), only caching a `type === "basic"` 200.
- Navigation fallback to `./index.html` when offline on an unvisited URL.

`CACHE_VERSION` is part of every cache name (`virasat-shell-v87`, etc.). **Bump it once per shipped commit** that changes any shell file — the activate handler deletes every cache starting with `virasat-` that isn't in the current version's set.

**Update model:** install does *not* `skipWaiting()`. A fresh deploy parks the new worker in `waiting` while the open tab keeps the old code; the page shows a "new version ready" prompt and posts `SKIP_WAITING` only when the user accepts — so code is never hot-swapped out from under an in-progress edit (there's no keystroke-level autosave). `notificationclick` (anniversary reminders, §12/anniversaries) focuses or opens a Virasat tab at the tree.

---

## 7 · Theme tokens

`tokens.css` exposes the light theme as `:root` variables. Key tokens:

- `--bg`, `--bg-elev`, `--bg-sunken`, `--surface`, `--surface-2`, `--surface-3` — backgrounds.
- `--text`, `--text-2`, `--text-3`, `--text-4` — text shades.
- `--olive`, `--olive-deep`, `--olive-soft` — primary accent (structural).
- `--gold`, `--gold-deep`, `--gold-soft` — secondary accent (importance signal).
- `--rust` — destructive / death markers.
- `--av-{peach,sage,lavender,sky,rose,butter,clay,mist}` + matching `-ink` — name-hashed avatar pastels.

### Two independent axes → four surfaces

Appearance is **two orthogonal attributes on `<html>`**, giving four distinct palettes:

| | normal contrast | high contrast |
|---|---|---|
| **light** | `:root` | `:root[data-contrast="high"]:not([data-theme="dark"])` |
| **dark** | `:root[data-theme="dark"]` | `:root[data-theme="dark"][data-contrast="high"]` |

- **Dark** brightens `--olive-deep` and `--gold-deep` at the *token* level rather than per-component — so any "color: olive-deep on bg: olive-soft" pairing reads correctly in both modes with no per-component dark rule. Persists in `localStorage["virasat.theme"]`.
- **High contrast** is a separate accessibility axis (`data-contrast="high"`, stored in `localStorage["virasat.contrast"]`) that thickens lines, deepens text, and adds a visible focus outline on interactive elements. The light HC block is scoped `:not([data-theme="dark"])` so it can't leak its light values onto the dark base; a dedicated `[data-theme="dark"][data-contrast="high"]` block covers dark HC.

Both toggles live in the **account / appearance menu** (the avatar button), not the header — decluttered there so the header stays a title + view switcher. Neither follows system preference; the heritage look is tuned for warm light and only flips on the explicit attribute. Both attributes are applied before first paint to avoid a flash.

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
  — if !includePhotos: drop photo, photoId
  — for each contact field: if private*, blank the value
  — strip privacy flags themselves
  — drop empty contact objects
```

`MINIMAL_FIELDS` allowlist for minimal-mode exports: `id, name, parents, spouses, gender, createdAt, updatedAt, name_hi`.

Import path: `replaceAll(parsed)` flushes any pending debounce, normalises marriage keys via `marriageKey()`, replaces state, calls `PhotoStore.migrateLegacy()` to convert any base64 photos in the imported data to IDB blobs.

---

## 9 · Naming + ID conventions

- Person ids: `genId()` = prefix `p_` + `crypto.randomUUID()` hex, dashes stripped, first 12 chars (with a non-crypto fallback). Sample data uses stable hand-written ids for screenshots.
- Story ids `s_`, gallery ids `g_`, document ids `doc_`, photo ids `ph_…` — same `genId(prefix)` helper.
- Marriage keys: `<sortedIdA>|<sortedIdB>` — always re-keyed via `marriageKey()` to keep lookup deterministic.
- Storage keys:
  - **Tree state (localStorage):** `familyTree.v1` (local-first) or `familyTree.<treeId>.v1` (per cloud tree); `virasat.activeTreeId` points at the current one.
  - **Preferences (localStorage):** `familyTree.lang`, `familyTree.inspector.sections`, `virasat.theme`, `virasat.contrast`, `virasat.showPets`, `virasat.showStoryCount`, `virasat.showDates`, `virasat.showEras`, `virasat.timelinePxPerYear`, `virasat.railCollapsed`, `virasat.searchScope`, `virasat.anniversaryReminders`.
  - **sessionStorage:** `virasat.filter`, `virasat.persistWarned`, `virasat.touchMenuHintShown`.
  - Preference keys are **global**, not per-tree (a deliberate MVP scope; see §13).
- IDB databases: `familyTree.photos` — one store; blobs are keyed by the bare `photoId` and isolated across trees by the Storage object path + `resetCache()` on switch, not by compound keys (§3).

---

## 10 · Bilingual (EN/HI) data model

Every textual person field has an `_hi` companion: `name`/`name_hi`, `birthPlace`/`birthPlace_hi`, `occupation`/`occupation_hi`, `description`/`description_hi`, `achievements`/`achievements_hi`, `education`/`education_hi`, `notes`/`notes_hi`, `deathPlace`/`deathPlace_hi`.

`FamilyStore.getField(person, key)` resolves: if lang is `"hi"` AND `_hi` is non-empty, return that; else return the EN. For arrays, item-by-item resolution.

The form has paired EN/HI inputs side-by-side. There's no auto-translate — empty `_hi` falls back to `_en`.

`I18n` (in `lib/core/i18n.js`) covers the static UI strings (button labels, section headings, empty-state copy). Dictionary in `dict.en` and `dict.hi`. The DOM applier walks `[data-i18n]`, `[data-i18n-placeholder]`, `[data-i18n-title]` and rewrites on language change.

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

1. **Tree layout doesn't lay out pets consistently when they have multiple owners.** Today we anchor on `petOwners[0]` for the riser. If owners are in different generations, the placement is the deeper one and the connection looks weird from the shallower owner's view. *(Still open.)*
2. **Schema versioning never had to do work yet.** When the first breaking change comes (likely splitting `parents[]` into `father`/`mother` if relationship-tagging lands), we'll need a real migration path. Today every additive field defaults via `||` in `normalizePerson`. *(Still open.)*
3. **Viewer privacy is UI-only in MVP.** With whole-blob LWW, RLS hands the entire `data` JSONB to every member including viewers, so per-field/photo privacy for viewers is enforced only in the UI — a determined viewer could read hidden fields via DevTools. Proper enforcement is a `SECURITY DEFINER` RPC returning a redacted blob for viewer-role callers — a documented fast-follow, not MVP. "View access" today means: **cannot edit** (enforced server-side by RLS) and sees a read-only UI.
4. **Preference keys are global, not per-tree.** Inspector section state, timeline zoom, view toggles, filter, theme all persist per-device across every tree. Low harm; scoping per-tree is a fast-follow. *(Partially by-design for MVP.)*

### Resolved since this doc was first written

- **Sample-CTA id collision** — gated on `role === 'owner' && getPeople().length === 0`, so it never lands on a tree you don't own or that already has people (§ data-store, sign-in).
- **IDB photo bucket across trees** — resolved by flat keys + Storage object path scoping + `resetCache()` on switch, *not* compound keys (§3).
- **Reads staying sync under cloud sync** — confirmed: the cloud layer only hydrates the in-memory snapshot; no view became async (§2, §14).

---

## 14 · The cloud layer (`lib/auth/`)

The whole cloud stack is **opt-in and inert by default**. `config.js` holds `VirasatConfig = { supabaseUrl, supabaseAnonKey, bucket }`; `Auth.ready()` resolves `{ cloud: false }` when either credential is blank, and the app runs exactly as the local-first PWA it always was. Fill both in and it becomes multi-user. The anon key is public-safe — **row-level security in Postgres is the enforcement point**, not the client. Backend schema + setup live in `docs/SUPABASE-SETUP.md` and `docs/CLOUD-SYNC-PLAN.md`.

No build step: the Supabase JS SDK loads as a **UMD `<script>` with SRI** from `cdn.jsdelivr.net` (`window.supabase.createClient`) — the classic ordered-IIFE script chain is preserved, nothing became `type=module`. `flowType: 'pkce'` so OAuth / magic-link return `?code=` in the *query* (stripped after exchange), leaving the `#tree/#people/#timeline` hash router untouched.

### Boot gate (`app.js`)

DOM + listener wiring stays synchronous. Only the mount/activate/sample-offer tail is gated:

```
Auth.ready() →
  { cloud:false }        → bootApp()            // local-only, unchanged
  { session }            → bootWithCloud()      // already signed in
  no session             → SignIn.show() → bootWithCloud()   // gate, then load+boot
  (Auth absent / throws) → bootApp()            // never strand on a blank page
```

`bootWithCloud()` resolves the active tree, `await`s the first remote load (hydrate) behind a splash, *then* mounts views — so first paint is data-complete.

### Modules

- **`auth-store.js`** (`window.Auth`) — creates the client (`persistSession`, `autoRefreshToken`, PKCE), `ready()`, sign-in via password / Google OAuth / magic-link, `signOut`, `onAuthChange`. Calls the `claim_invites` RPC on every login so an invite sent before signup is picked up.
- **`cloud-store.js`** (`window.CloudStore`) — the sync engine. `start()`/`stop()`; `loadInto(treeId)` fetches the row and `hydrateFromRemote`s it; `push()` is a **version-guarded LWW** update (`.eq('version', loaded).update({ data, version: loaded+1 })`) debounced `PUSH_DEBOUNCE_MS = 1500`. On a guard miss it fetches latest, hydrates, and fires the **existing** `virasat:cross-tab-conflict` event (same banner + backup offer the `storage`-event path used). A realtime channel on the active row delivers other devices' pushes; `POLL_MS = 60000` is the fallback heartbeat + offline-replay when the WebSocket is blocked. `subscribe(FamilyStore.onDirty)` is how a local edit flags a push. `syncState()` drives the header pip (`synced`/`pending`/`offline`) via `virasat:sync-state`.
- **`sign-in.js`** — splash gate + sign-in screen + the account/appearance menu (theme, contrast, sign-out).
- **`tree-list.js`** — tree switcher + create. Switching repoints `activeTreeId` and triggers a fresh cloud load; the load path (`cloud-store.loadInto`) calls `PhotoStore.resetCache()` so one tree's photo object-URLs can't bleed into another's render, and `app.js` clears the Inspector selection on the switch.
- **`sharing.js`** — invite-by-email dialog + member/role list; owner-checked `invite_to_tree` / `revoke_access` RPCs (which also double as role change).
- **`first-run.js`** — one-time: detects a returning local user's `familyTree.v1`, offers to upload it as a new cloud tree (inlining base64 photos to Storage), keeps the local copy as a fallback.

### Roles

`owner` / `editor` / `viewer`, enforced server-side by RLS. A `viewer` load flips `FamilyStore.setReadOnly(true)` (mutations no-op) and `body.is-viewer` hides every `.js-edit-only` affordance. **Viewer privacy is UI-only in MVP** — see §13.3.

---

— Last updated 2026-08-16. When making changes that contradict this file, update the file in the same commit.
