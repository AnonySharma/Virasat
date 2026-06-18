# Virasat — audit findings

Compiled from four parallel read-only audits (bugs, data model, perf/a11y/mobile, tech-stack). Each finding cites the file + line so it's actionable. Severity grouping; within a group, ordered by rough fix-cost vs payoff.

---

## Critical (data loss / silent corruption)

- **`lib/utils/data-store.js:209` — `genId` can collide.**
  `Math.random() + Date.now()` produces dupes when called twice in the same ms (rapid imports, batch story creation). Second `addPerson` / `addStory` then silently *overwrites* the first.
  *Fix:* generate, check against existing ids, retry if dup; or use `crypto.randomUUID()` (now safe in every shipped browser).

- **`lib/utils/photo-store.js:58–84` — IndexedDB `put()` races + transaction promise resolution race.**
  The id is computed synchronously (`"ph_" + Math.random() + Date.now()`) but the actual `s.put(blob, id)` is async. Two concurrent `fileToPhotoId` calls (drag-drop multi-photo, future bulk import) can mint the same id. Compounding: the `tx` helper resolves with `null` on `t.oncomplete` *before* the inner Promise chain finishes for sync results — so the returned id is sometimes `null` even though the blob landed.
  *Fix:* generate the id inside the transaction, check `s.get(id)` for a hit, retry; and rewrite `tx` so it always returns the inner result (`Promise.resolve(result)`), never the unconditional `resolve(null)` on line 81.

- **`lib/features/export-import.js:138–162` — `importPreservingIds` opens a *new* IDB connection.**
  It races with the existing `dbPromise`. If the user upgrades the app mid-import, an `onupgradeneeded` fires on the second handle and can corrupt the schema.
  *Fix:* expose a `putWithKey(id, blob)` on the wrapped `db` and reuse the single connection.

- **`lib/features/export-import.js` — `state.marriages` is dropped on export.**
  `buildRedactedStateAsync` writes `{ version, meta, people }` only. Anyone who has annotated marriages (date, place, photo, story via the gold-knot modal) loses those records on the next export → import round-trip.
  *Fix:* include `marriages: src.marriages || {}` in the redacted state. Apply `applyFieldToggles` to the marriage entries too (strip `date` when "include dates" is off, strip `place` when "include locations" is off, strip `photoId` when "include photos" is off, strip the embedded blob when "embed photos in JSON" is off).

- **`lib/utils/data-store.js` — `syncSpouses` mutates other people's records without `persist()`.**
  When `addPerson` / `updatePerson` adds the inverse spouse link on the partner, that change is in-memory only until the *next* user action triggers another `persist()`. If the tab crashes (or refreshes) before that, the bidirectional link is broken.
  *Fix:* call `persist()` once at the end of `syncSpouses`, after the loop.

---

## High (broken feature / WCAG fail)

- **`sw.js:21–48` — `SHELL` doesn't include `sw.js` itself, and the SW serves cached `sw.js` to the browser.**
  Result: cache-version bumps never roll out — the user keeps booting the old SW, which keeps serving the old shell. The fetch handler also caches `sw.js` into `RUNTIME_CACHE` because nothing excludes it.
  *Fix:* exclude `sw.js` from the runtime-cache `cache.put`, set `Cache-Control: max-age=0` for the SW (or use a cache-busting query: register `sw.js?v=2`). Let the browser's normal SW update flow drive activation.

- **`sw.js:21–48` — Google Fonts CSS is not in `SHELL`.**
  `https://fonts.googleapis.com/css2?...` is fetched on every load even after install; `cache-first` only kicks in *after* it's been seen once. First offline boot has no fonts.
  *Fix:* add the exact `https://fonts.googleapis.com/css2?...` URL to `SHELL` (or split into a CDN_SHELL list precached into `CDN_CACHE`).

- **`lib/components/crop-editor.js:59` — drag math divides by `state.scale`.**
  At scale=3, dragging 10 px shifts the focal point ~1.1 % — barely moves the photo. Users expect 1:1 panning.
  *Fix:* drop the `/ state.scale` in `dxPct` / `dyPct`; the pointer movement is already in the same pixel space as the rendered (scaled) image.

- **`lib/features/image-export.js:295–353` — lineage-export bbox falls back to "Tree is empty" for a single-node lineage.**
  When the focused person has no spouse and no descendants, `mappedRect` runs only on one node; if its CTM is unavailable for any reason `liveSubtreeBBox` returns `null` and the export rejects.
  *Fix:* if `focusSet.size === 1`, skip the subtree-bbox path and use `liveContentBBox` scoped to the single node, or surface a clearer error.

- **`lib/utils/data-store.js:196–206` + every keystroke handler — `persist()` runs synchronously on every change.**
  `JSON.stringify(state)` on a 500-KB tree blocks the main thread ~30–50 ms per keystroke on mobile Safari.
  *Fix:* debounce `persist()` 250 ms; flush eagerly on `beforeunload`, modal-close, and on `removePerson`-style high-stakes ops.

- **`lib/views/tree-view.js:196–229` — full SVG re-render on every store mutation.**
  Typing in the inspector → `persist()` → all subscribers fire → tree wipes `edgesG` + `nodesG` and re-lays out every node. Visible jank starts ~50 people.
  *Fix:* let subscribers receive a hint of *what changed* (the patched ids) and skip the layout pass if `people.length` and the relation graph are stable; just patch the mutated text/photo nodes.

- **`lib/views/people-view.js:29 + 64–96` — search re-renders the entire grid per keystroke.**
  No debounce, no DOM reuse. 100-person list flickers; mobile keyboards lag.
  *Fix:* debounce `setSearch` 150 ms; cache rendered cards in a `Map<id, Node>` and toggle `.hidden` instead of clearing.

- **`lib/utils/ui-utils.js:87–117` — modal has no focus trap and no return-focus.**
  Tab cycles into background controls; close doesn't restore focus to the trigger. Keyboard / screen-reader users get lost on every modal open/close.
  *Fix:* on open save `document.activeElement`; trap Tab / Shift+Tab inside the modal; on close, restore focus to the saved element.

- **`lib/components/heritage-select.js` — no `aria-activedescendant` on the combobox.**
  Visual `.is-hover` updates as the user arrows through options, but screen readers stay silent.
  *Fix:* give each `<li>` an id (`hsel-${name}-opt-${i}`); set `aria-activedescendant` on the combobox button to the currently-hovered option's id.

- **`lib/views/tree-view.js:1229–1315` — pinch-zoom conflicts with browser viewport zoom.**
  No `touch-action: none` on `.tree-svg`, so iOS Safari zooms the *page* simultaneously with the SVG.
  *Fix:* `.tree-svg { touch-action: none; }` (or `pan-x pan-y` if we want browser-driven scroll for the page itself).

- **`lib/features/export-import.js:45–53` — Minimal JSON export leaks new fields.**
  `applyMinimal` allowlists `["id","name","parents","spouses"]` but operates on the already-cloned full record, so it doesn't strip `birthDatePrecision`, `deathDatePrecision`, `stories`, `photoCropAvatar`, `photoCropHero`, `notes_hi`, etc.
  *Fix:* re-build minimal records from scratch (`{ id, name, parents, spouses }`), don't clone-and-prune.

---

## Medium (degraded UX / future tech-debt)

- **`lib/views/timeline-view.js:262–263` — bar width when `startYear === endYear`.**
  Death-only people show as a `MIN_BAR_PX` bar starting at the death year, which reads as "lived from 1950 to ~1952".
  *Fix:* render a slim marker (4 px diamond / hairline) at `startYear` instead of a bar.

- **`lib/app.js` photo-migration boot path — re-renders N times on first load.**
  Migration calls `updatePerson` per photo; each fires `persist()` + every subscriber. 50 photos = 50 layout passes.
  *Fix:* during migration, set a `migrating = true` flag on the store, skip notifications inside `persist()`, then emit one notification at the end.

- **`lib/features/image-export.js:94–114` — same blob is re-fetched + re-base64-encoded per export.**
  No memoisation across export sessions or even within a single export when two people share a photo.
  *Fix:* cache `href → dataUrl` in a `Map` for the lifetime of one `exportTreePng` call.

- **`lib/views/tree-view.js:1186–1204` — `zoomBy` doesn't clamp the anchor.**
  Wheeling over the canvas padding lets the tree slide off-screen.
  *Fix:* clamp `ax, ay` to `lastBBox` before applying the zoom.

- **`lib/components/crop-editor.js` — no keyboard reframing.**
  Only mouse / touch can pan the photo. Zoom slider is keyboard-accessible, focal point is not.
  *Fix:* `keydown` handler on `crop-frame__inner`: arrow keys = ±2 % focal shift, `+`/`-` = scale ±0.1.

- **`styles/tokens.css` + tree node text — butter pastel + small text fails AA.**
  `--av-butter` = `#ECE0AE` on ivory `#F8F6F2` is 1.15:1. Initials in olive on butter bg are also borderline.
  *Fix:* darken the avatar inks (`--av-*-ink` tokens) so each pastel reaches 4.5:1 against its own bg.

- **`styles/views.css` `.lineage-banner` — slide-in transition not gated by reduced-motion.**
  Vestibular-sensitive users opted out via OS setting still see motion.
  *Fix:* `@media (prefers-reduced-motion: reduce) { .lineage-banner { transition: none; } }`.

- **`lib/views/tree-view.js` zoom buttons — icon-only, no visible label.**
  `aria-label` covers screen readers; sighted low-vision keyboard users get only a glyph.
  *Fix:* tooltip on focus (not just hover), or a visually-hidden text node that becomes visible at large text sizes.

- **`lib/components/inspector.js` mobile — no in-panel close affordance.**
  At < 1100 px the inspector slides over the canvas. Close button is desktop-only; mobile users must tap the (invisible) backdrop.
  *Fix:* show a top-right close button at all widths; consider a swipe-down gesture.

- **Touch targets — heritage-select options + icon buttons are 32–40 px.**
  WCAG 2.5.5 wants ≥ 44 × 44.
  *Fix:* `@media (pointer: coarse) { .btn--icon, .hsel__opt { min-height: 44px; } }`.

---

## Low (nits)

- **`lib/views/people-view.js:273–275` — `__addAsParentOf` seed leaks into the saved record.**
  When the form is opened pre-seeded ("add child of X"), `draft.__addAsParentOf` is read on save but never deleted, so it persists onto the new person.
  *Fix:* `delete draft.__addAsParentOf;` before building the payload.

- **`lib/utils/data-store.js:405–409` — `buildGenerations` spouse pull is symmetric.**
  Two orphan partners both at gen 0 stay at gen 0 forever (which is fine, but the symmetry is fragile when more cases land).
  *Fix:* gate the pull on `Math.max(...partnerGens) > 0`.

- **`lib/views/tree-view.js:359` — `gapBefore` indexing fragile when `indexOfRight === 0`.**
  Currently can't trigger; just guard `indexOfRight > 0` to be safe against future refactors.

- **`SCHEMA_VERSION` — never bumped despite five field additions.**
  Today every new field has a sensible `||` default in `normalizePerson`, so additive changes work without migration. Bump on the *first* breaking change (e.g., splitting `parents[]` into `father`/`mother`); not before.

- **`lib/features/image-export.js` — no progress UI on long exports.**
  A 50-person tree export with photos can take 10+ s; the user sees nothing change after pressing Save PNG.
  *Fix:* swap the button label to "Rendering…" (already done) and add a small progress chip ("Inlining 12/30 photos…") for the photo phase.

---

## Don't bother

- **localStorage quota — already wrapped.** Every `setItem` is in a try-catch in `data-store.js`, `i18n.js`, `inspector.js`, `timeline-view.js`. Photo bytes already live in IDB.
- **Photo-migration idempotency — already idempotent.** `if (p.photo && !p.photoId && !p.photoUrl)` guards re-migration.
- **Stories on the person record vs top-level `state.stories` map.** Co-locating them is simpler; perf gain at family-tree scale (< 1 000 people) is negligible. Only refactor if "stories not tied to a person" become a feature.
- **`spouses[]` vs `marriages` map redundancy.** `spouses[]` is structural (tree layout reads it); `marriages[key]` is annotation. Both are load-bearing; document the split rather than collapse it.
- **`meta.familyName` vs `meta.familyTitle`.** `familyName` stays as the legacy first-word fallback. Removing it would break old exports; keeping both is cheap.

---

## Tech stack & free hosting (recommendation)

**Verdict: stack is right-sized. Stay vanilla, stay on a static host.**

The whole codebase is 8 k JS lines spread across 22 modules, all attached to `window`. That's right at the ceiling before the lack of an explicit dependency graph starts to bite — but it's not biting yet, and the *no-build, just-open-index.html* property is a feature for a 30-year-lifespan family heirloom app. Adding Vite or React would be a regression in robustness against the kind of bit-rot family-tree apps are uniquely vulnerable to.

**Hosting — top pick: stay on GitHub Pages.** You're already there. Free HTTPS, free custom domain, automatic deploys on push, the `.nojekyll` is already in place, the SW + manifest work. The 100 GB/month bandwidth cap is unreachable for a personal family tree.

**Hosting — alternative: Cloudflare Pages.** Same feature set + (a) a global edge CDN (genuinely faster for relatives outside North America), and (b) instant PR-preview URLs. 5-min migration: connect repo, set build command to `echo static`, publish dir `./`. Switch only if PR previews matter or relatives complain about latency.

**Skip Netlify / Vercel / Firebase Hosting** for this — same free tier, more setup friction, no advantage here.

**Concrete next steps in ROI order:**

1. **Custom domain** (~10 min, ~$12/yr for the domain itself). `virasat.family` or similar. Trust signal for relatives storing decades of photos.
2. **JSON-backup-to-private-Gist** (~1 hr). Adds a "Backup to cloud" button: a one-time `gist`-scoped GitHub PAT pasted into the app, then `fetch` POSTs the export to a private Gist with a timestamped filename. Zero infra cost, survives device loss without OAuth dance.
3. **Self-host the fonts** (~2 hrs) only if first-offline-boot font flash becomes a complaint. Subset Fraunces / Inter / Noto Serif Devanagari / Font Awesome to woff2 with `glyphhanger`. Adds ~400 KB to the precache, removes two CDN dependencies.
4. **ES modules** (~4–6 hrs) only when contributors arrive who need IDE autocomplete. `<script type="module">` + `export`/`import` is zero-config and keeps the no-build promise — until you want hot-reload and grab Vite (~30 min on top).
5. **Preact for the inspector** (~1–2 days, framework-mandatory) only if inspector sections grow past ~10 and the manual DOM sync starts producing stale-state bugs.

**Skip cloud-storage OAuth** (Drive / Dropbox). The redirect-URI + `localhost` dance breaks PWAs. Manual JSON export + cloud-of-your-choice upload is more portable and equally cheap.

---

*Generated 2026-06-18 from four parallel audits: bugs/correctness, data model & I/O, perf+a11y+mobile, tech-stack & hosting.*
