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

*Pending — four parallel agents are running. Section will be filled in as findings arrive.*
