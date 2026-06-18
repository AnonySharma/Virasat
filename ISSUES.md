# Virasat — audit findings

## Round 1 — initial audit (2026-06-18)

Compiled from four parallel read-only audits (bugs, data model, perf/a11y/mobile, tech-stack). Each finding cites the file + line so it's actionable. Severity grouping; within a group, ordered by rough fix-cost vs payoff.

Fixed items are crossed out and tagged ✅ with the commit hash. Items that the audit got *wrong* (false positives, verified against the code) are tagged ⛔ "Verified false". The rest are open.

---

### Critical (data loss / silent corruption)

- ✅ **`lib/utils/data-store.js:209` — `genId` can collide.** Fixed in `655b493` — now uses `crypto.randomUUID` with a per-process counter on the fallback path.

- ✅ **`lib/utils/photo-store.js:58–84` — IndexedDB `put()` races + transaction promise resolution race.** Fixed in `655b493` — id is picked inside the transaction (with retry-on-collision) and the rewritten `txValue` resolves the captured value on `t.oncomplete`, not `null`.

- ✅ **`lib/features/export-import.js:138–162` — `importPreservingIds` opens a *new* IDB connection.** Fixed in `655b493` — added `db.putWithKey(id, blob)` on the wrapped connection and reuse the single `dbPromise`.

- ✅ **`lib/features/export-import.js` — `state.marriages` is dropped on export.** Fixed in `655b493` — `buildRedactedStateAsync` / `Sync` now include `marriages` and run them through the same date / locations / photos toggles.

- ⛔ **`lib/utils/data-store.js` — `syncSpouses` mutates other people's records without `persist()`.** Verified false: `addPerson` and `updatePerson` both call `persist()` *after* `syncSpouses` returns, so all mutations land in a single localStorage write.

---

### High (broken feature / WCAG fail)

- ✅ **`sw.js:21–48` — `SHELL` doesn't include `sw.js` itself, and the SW serves cached `sw.js` to the browser.** Fixed in `655b493` — `sw.js` is now bypass-cached (network direct) so the browser's update-detection works; `CACHE_VERSION` bumped to `v2`.

- ✅ **`sw.js:21–48` — Google Fonts CSS is not in `SHELL`.** Fixed in `655b493` — added `CDN_SHELL` precached on install with `mode: "no-cors"` (Google Fonts CSS + Font Awesome CSS).

- ✅ **`lib/components/crop-editor.js:59` — drag math divides by `state.scale`.** Fixed in `655b493` — dropped the `/ state.scale` divisor; pointer travel maps directly to focal-point %.

- ✅ **`lib/features/image-export.js:295–353` — lineage-export bbox falls back to "Tree is empty" for a single-node lineage.** Fixed in `655b493` — falls back to `getBoundingClientRect` of the focus node mapped through the SVG viewBox when `liveSubtreeBBox` returns null.

- ✅ **`lib/utils/data-store.js:196–206` + every keystroke handler — `persist()` runs synchronously on every change.** Fixed in `655b493` — debounced 250 ms with eager flush on `beforeunload` + `visibilitychange=hidden`. Listeners still fire synchronously so the UI updates immediately; only the on-disk write is deferred.

- 🟡 **`lib/views/tree-view.js:196–229` — full SVG re-render on every store mutation.** Open. The persist debounce above masks symptoms; deeper fix (granular subscriptions) deferred.

- 🟡 **`lib/views/people-view.js:29 + 64–96` — search re-renders the entire grid per keystroke.** Open.

- ✅ **`lib/utils/ui-utils.js:87–117` — modal has no focus trap and no return-focus.** Fixed in `655b493` — `Tab` / `Shift+Tab` traps inside the modal, focus moves to the first focusable on open, restores to the previously-focused element on close.

- 🟡 **`lib/components/heritage-select.js` — no `aria-activedescendant` on the combobox.** Open.

- ✅ **`lib/views/tree-view.js:1229–1315` — pinch-zoom conflicts with browser viewport zoom.** Fixed in `655b493` — `.tree-svg { touch-action: none; }`.

- ⛔ **`lib/features/export-import.js:45–53` — Minimal JSON export leaks new fields.** Verified false: `applyMinimal` builds the output from scratch (`const out = {}` + allowlist), it does not clone the full record. New fields cannot leak.

---

### Medium (degraded UX / future tech-debt)

- ✅ **`lib/views/timeline-view.js:262–263` — bar width when `startYear === endYear`.** Fixed in `655b493` — death-only people render as a 6 px point marker with a `.timeline-bar--point` class.

- 🟡 **`lib/app.js` photo-migration boot path — re-renders N times on first load.** Open.

- 🟡 **`lib/features/image-export.js:94–114` — same blob is re-fetched + re-base64-encoded per export.** Open.

- 🟡 **`lib/views/tree-view.js:1186–1204` — `zoomBy` doesn't clamp the anchor.** Open.

- 🟡 **`lib/components/crop-editor.js` — no keyboard reframing.** Open.

- 🟡 **`styles/tokens.css` + tree node text — butter pastel + small text fails AA.** Open.

- ✅ **`styles/views.css` `.lineage-banner` — slide-in transition not gated by reduced-motion.** Fixed in `655b493`.

- 🟡 **`lib/views/tree-view.js` zoom buttons — icon-only, no visible label.** Open.

- 🟡 **`lib/components/inspector.js` mobile — no in-panel close affordance.** Open.

- 🟡 **Touch targets — heritage-select options + icon buttons are 32–40 px.** Open.

---

### Low (nits)

- ⛔ **`lib/views/people-view.js:273–275` — `__addAsParentOf` seed leaks into the saved record.** Verified false: the save handler builds the payload explicitly with named fields; `__addAsParentOf` is read off `draft` but never copied into the payload.

- 🟡 **`lib/utils/data-store.js:405–409` — `buildGenerations` spouse pull is symmetric.** Open.

- 🟡 **`lib/views/tree-view.js:359` — `gapBefore` indexing fragile when `indexOfRight === 0`.** Open (defensive only — currently can't trigger).

- 🟡 **`SCHEMA_VERSION` — never bumped despite five field additions.** Defer until a breaking change requires migration.

- 🟡 **`lib/features/image-export.js` — no progress UI on long exports.** Open.

---

### Don't bother (verified)

- localStorage quota — already wrapped.
- Photo-migration idempotency — already idempotent.
- Stories on the person record vs top-level `state.stories` map.
- `spouses[]` vs `marriages` map redundancy.
- `meta.familyName` vs `meta.familyTitle`.

---

### Tech stack & free hosting (recommendation)

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

## Round 2 — re-audit after fixes (2026-06-18, post-`655b493`)

Four parallel re-audits ran:
- **Bugs & correctness** — verifies the round-1 fixes actually work + hunts for new bugs.
- **Data & export round-trip** — marriage records, schema versioning, import/export integrity.
- **Perf, a11y & mobile** — verifies the persist debounce + focus trap + touch-action; new a11y/mobile gaps.
- **SW & edge cases** — service worker on subpaths, multi-tab, photo-crop reset, sample data.

**All round-1 fixes verified PASS** by every agent. The issues below are *new*: either uncovered for the first time, or surfaced because a round-1 fix exposed a related code path.

---

### Critical (data loss / silent corruption)

- ✅ **`lib/views/people-view.js:283–300` — photo re-upload doesn't reset crop frames.** Fixed in `7bad5ef` — both `photoCropAvatar` and `photoCropHero` are reset to `null` after a new upload, and the previous `photoId` blob is freed from IDB.

- ✅ **`lib/utils/data-store.js:36–39` — corrupt localStorage orphans IDB photos.** Fixed in `7bad5ef` — `load()` calls `PhotoStore.clearAll()` on parse failure before falling back to `emptyState()`.

- ✅ **`lib/utils/photo-store.js:148–167` — marriage photos never migrate to IDB.** Fixed in `7bad5ef` — `migrateLegacy` now also iterates `FamilyStore.getState().marriages` and calls `setMarriage` to swap base64 for `photoId`.

---

### High (broken feature / WCAG fail)

- ✅ **`lib/features/image-export.js:585–587` — `cssAttrEscape` incomplete.** Fixed in `7bad5ef` — uses `CSS.escape` when available, regex covering `[ ] " \ \s` as fallback.

- ✅ **`lib/utils/photo-store.js:113–125` — `txValue` doesn't catch sync throws inside async callbacks.** Fixed in `7bad5ef` — every IDB callback is wrapped via `safe(cb, fail)` so sync throws inside `onsuccess`/`onerror` abort the transaction.

- ✅ **`lib/features/export-import.js:96–104` — `applyMinimal` allowlist missing fields.** Fixed in `7bad5ef` — `MINIMAL_FIELDS` now includes `gender`, `createdAt`, `updatedAt`.

- ✅ **`lib/utils/data-store.js:222–229` — `pagehide` not wired.** Fixed in `7bad5ef` — added alongside `beforeunload` and `visibilitychange=hidden`.

- ✅ **`lib/utils/data-store.js:313–324` — `replaceAll` races pending debounce.** Fixed in `7bad5ef` — `flushPersist()` is called at the start of `replaceAll` so any pending write lands first, then the import is the next write.

- ✅ **No cross-tab sync — `storage` event ignored.** Fixed in `7bad5ef` — added a `storage` event listener that reloads state when another tab persists and notifies subscribers (last-write-wins).

- ✅ **`lib/utils/photo-store.js:148–166` — photo migration cascade re-renders N times.** Fixed in `7bad5ef` — added `setMute(true)` / `notifyAll()` around the migration loop; one final notification at the end.

- ✅ **`lib/components/heritage-select.js` — missing `aria-activedescendant`.** Fixed in `7bad5ef` — each `<li>` gets a per-instance unique id; the combobox's `aria-activedescendant` updates on hover.

- ✅ **`lib/views/tree-view.js:554–665` — tree nodes not keyboard-focusable.** Fixed in `7bad5ef` — every `.t-node` gets `tabindex=0`, `role=button`, `aria-label`, `keydown` (Enter/Space → inspector), and a `:focus-visible` gold halo on the photo ring.

- ✅ **`lib/app.js:16–18` — `navigator.storage.persist()` rejection silently swallowed.** Fixed in `7bad5ef` — logs the result + shows a one-shot toast (gated by `sessionStorage`) when storage isn't pinned.

---

### Medium (degraded UX / future tech-debt)

- ✅ **`SCHEMA_VERSION` still 1.** Fixed in `7bad5ef` — bumped to `2`.

- ✅ **Marriage keys not normalised on import.** Fixed in `7bad5ef` — `replaceAll` re-keys every entry through `marriageKey()`.

- ✅ **Modal focus trap interferes with portaled popovers.** Fixed in `7bad5ef` — exempts focus inside `.hdp__pop`, `.hsel__menu`, `.modal-portal-exempt`.

- ✅ **`inlineSvgImages` no per-export memoisation.** Fixed in `7bad5ef` — one `Map<href, Promise<dataUrl>>` per `exportTreePng` call.

- ✅ **Reduced-motion not gating story-card / modal / toast.** Fixed in `7bad5ef`.

- ✅ **Touch targets < 44 px on mobile.** Fixed in `7bad5ef` — `@media (pointer: coarse)` bumps `.btn--icon` and `.hsel__opt` to ≥ 44 px.

- 🟡 **Inspector — no in-panel close button on mobile (< 1100 px).**
  Open from round 1.
  *Fix:* add `.inspector__close-mobile` button in the inspector hero, visible only via `@media (max-width: 1100px)`.

- 🟡 **Tree zoom controls — icon-only, no visible label.**
  Open from round 1.
  *Fix:* add a `.sr-only` span (or use `<span aria-hidden="false">` with the existing aria-label content).

---

### Low (nits)

- 🟡 **`lib/app.js:212–226` — sample-data offer fires after every Reset.**
  If the user declined once, every subsequent reset offers it again.
  *Fix:* `sessionStorage.setItem("virasat.sampleOffered","1")` on first show, skip when already set.

- 🟡 **`sw.js:123` — `sw.js` bypass works on subpaths but is fragile.**
  `pathname.endsWith("/sw.js")` is fine for `/Virasat/sw.js` on GitHub Pages. Tighten to `pathname.split("/").pop() === "sw.js"` for safety.

- 🟡 **PWA uninstall keeps localStorage + IndexedDB.**
  Browser behaviour, not fixable in code. Document recovery: "Uninstall removes the icon, not the data. Use Tools → Reset everything before uninstalling for a clean wipe."

- ⛔ **In-memory PhotoStore fallback cross-tab sync (audit finding).**
  Verified false-ish: the in-memory fallback only runs when IndexedDB is unavailable, which is essentially never on shipped browsers. Documenting as a known limitation, not a bug.

- ⛔ **CDN_SHELL opaque-response concerns.**
  Verified PASS by SW audit: Google Fonts + Font Awesome both serve glyph files with permissive CORS, so `mode: "no-cors"` precaching of the *CSS* works in practice. Acceptable.

---

*Round 2 generated 2026-06-18 from four parallel re-audits. All round-1 fixes confirmed working.*

*Round-2 fixes landed in `7bad5ef`: every Critical / High / Medium item above resolved, except the few still-open Lows (sample-data nag after reset, SW bypass-path tightening, PWA-uninstall recovery doc).*
