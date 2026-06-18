# Virasat — issues

Bugs, regressions, and tech-debt found across four audit rounds plus user-reported issues. **Open items at the top, ranked by impact priority.** Solved items live in [Resolved](#resolved) at the bottom for traceability.

Use the priority tier as the order to work through; within a tier, ordered by impact.

---

## Open issues

### Tier B — High (broken feature / WCAG fail / discoverability)

*(Tier-A items are all currently resolved — see [Resolved](#resolved).)*

- 🟡 **Tree-node Tab order — every node a tab stop.** A 50-person tree forces 50 tab presses to traverse. Roving tabindex with arrow-key navigation between siblings / parent / child would match the WAI-ARIA tree-grid pattern.

### Tier C — Medium (degraded UX / future tech-debt)

- 🟡 **Tree-view zoom buttons icon-only with no visible text label.** `aria-label` covers screen readers; sighted low-vision keyboard users get only a glyph. Add a tooltip on focus or a visually-hidden label.
- 🟡 **Inspector mobile close polish.** The `.inspector-close` exists at `≤ 1100 px` and works; the small × in the top corner could be more obvious.
- 🟡 **Photo migration first-load re-renders.** `migrateLegacy` runs N updates; each fires a notification (now muted, but the legacy code path could still cascade in some edge cases). Verify and tighten.
- 🟡 **`zoomBy` doesn't clamp the anchor.** Wheeling over canvas padding lets the tree slide off-screen.
- 🟡 **Crop editor — no keyboard reframe.** Drag is mouse/touch only. Arrow keys = ±2 % focal shift, +/− = scale ±0.1.
- 🟡 **Butter pastel + small text fails AA.** `--av-butter` (`#ECE0AE`) on ivory is 1.15:1 contrast.
- 🟡 **`buildGenerations` spouse-pull is symmetric.** Two orphan partners both at gen 0 stay at gen 0. No observed bug; gate the pull on `Math.max > 0`.
- 🟡 **`gapBefore` indexing fragile when `indexOfRight === 0`.** Defensive only.
- 🟡 **No progress UI on long PNG exports.** Currently only the button label flips to "Rendering…". A small "Inlining 12/30 photos…" chip would help.

### Tier D — Low (nits)

- 🟡 **Sample-data id collisions on re-load.** "Try sample family" overwrites silently if the user has the same fixed ids. Currently behind a destructive confirm; documented.
- 🟡 **Triple flush listeners on `flushPersist`** (beforeunload + pagehide + visibilitychange). Idempotent; redundant CPU at unload time only.
- 🟡 **Crop editor 404-tolerates silently** when `photoUrl` 404s. Drag still applies to a 0×0 broken image. Add an `<img>.onerror` that aborts with a toast.
- 🟡 **Generation labels clip on 360 px viewports.** Polish.
- 🟡 **PWA uninstall recovery story.** Browser keeps localStorage + IDB after uninstall on most platforms. Document: "Uninstall removes the icon, not the data. Use Tools → Reset everything before uninstalling for a clean wipe."
- 🟡 **First-time tooltips for hidden affordances.** Right-click on tree, click on the gold knot, drag in the crop editor — none are visually hinted on first run. One-shot tooltips gated by `localStorage.getItem("virasat.tip.knot")` etc.
- 🟡 **Date-input placeholder doesn't update with precision.** When the user picks "About", the input still says `YYYY-MM-DD`.
- 🟡 **Heritage date-picker popover overflows narrow modals.** 320 px popover + `left: 0` can push past the right edge on a 375 px screen. JS reposition.
- 🟡 **Timeline name column truncates Hindi names at 120 px.** Polish — accept truncation, consider line-wrap on `(pointer: coarse)`.
- 🟡 **Inspector "Add child" success doesn't expand the Family section.** If collapsed, the new child is invisible until the user clicks the section header.
- 🟡 **Storage.persist() toast may race the toast-root mount.** Defer inside `DOMContentLoaded`.
- 🟡 **Landscape phone (667×375) is functionally tight.** Inherent constraint; consider a more compact tree layout when `(orientation: landscape) and (max-height: 480px)`.
- 🟡 **Header search hidden on phones.** Compact search-icon → modal/drawer would restore discoverability.

---

## Tech stack & free hosting

**Verdict: stack is right-sized. Stay vanilla, stay on a static host.**

The whole codebase is ~10 k JS lines spread across 25 modules, all attached to `window`. Right at the ceiling before the lack of an explicit dependency graph starts to bite, but it's not biting yet — and the *no-build, just-open-index.html* property is a feature for a 30-year-lifespan family heirloom app.

**Hosting — top pick: stay on GitHub Pages.** Free HTTPS, free custom domain, automatic deploys on push. The 100 GB/month bandwidth cap is unreachable.

**Alternative: Cloudflare Pages.** Same feature set + (a) global edge CDN (faster outside North America), (b) instant PR-preview URLs. 5-min migration if those matter.

**Skip Netlify / Vercel / Firebase Hosting** — same free tier, more setup friction, no advantage here.

**Concrete next steps in ROI order:**

1. **Custom domain** (~10 min, ~$12/yr). `virasat.family` or similar. Trust signal for relatives storing decades of photos.
2. **JSON-backup-to-private-Gist** (~1 hr). One-time PAT pasted into the app; *Backup to cloud* button POSTs a timestamped JSON to a private Gist. Survives device loss without OAuth.
3. **Self-host the fonts** (~2 hrs) only if first-offline-boot font flash becomes a complaint. Subset Fraunces / Inter / Noto Serif Devanagari / Font Awesome to woff2 via `glyphhanger`. Adds ~400 KB to the precache, removes two CDN dependencies.
4. **ES modules** (~4–6 hrs) only when contributors arrive who need IDE autocomplete. `<script type="module">` is zero-config, keeps the no-build promise.
5. **Vite for dev DX** (~30 min after #4) for hot-reload during dev. Production build stays static.

**Skip cloud-storage OAuth** (Drive / Dropbox). The redirect-URI + `localhost` dance breaks PWAs. JSON export + manual cloud upload is more portable.

---

## Resolved

Fixed items (✅) tagged with the resolving commit hash. Verified-false / closed-won't-fix items (⛔) kept here for traceability so future audits don't re-flag them.

### Tier A — Critical / data-loss / iOS-broken

- ✅ **`genId` collisions.** Math.random + Date.now produced same-millisecond dupes. Now uses `crypto.randomUUID` with a per-process counter fallback. (`655b493`)
- ✅ **PhotoStore IDB races + transaction promise resolution race.** Id is picked inside the transaction (with retry-on-collision); the rewritten `txValue` resolves the captured value on `t.oncomplete`, not `null`. (`655b493`)
- ✅ **`importPreservingIds` opening a second IDB connection.** Reuses the wrapped connection via `db.putWithKey`. (`655b493`)
- ✅ **`state.marriages` dropped on JSON export.** `buildRedactedState{Sync,Async}` now include marriages and respect the same toggles. (`655b493`)
- ⛔ **`syncSpouses` mutating partner records without `persist()`.** Verified false — `addPerson`/`updatePerson` call `persist()` *after* `syncSpouses`, so it's already covered.
- ✅ **No `env(safe-area-inset-bottom)` anywhere — iOS home bar covered controls.** Tree zoom cluster + toasts now use `bottom: calc(… + env(safe-area-inset-bottom))`. (`07516dd`)
- ✅ **Mobile tree had no add-relative path.** Bottom-line resolution: every empty-state has an inline "Add your first relative" CTA; on devices with a populated tree, the People view's add path covers it. The right-click context menu is desktop-only by design.
- ✅ **Photo crop reset on photo replace.** Re-uploading a photo resets `photoCropAvatar` and `photoCropHero` so the old frame doesn't apply to the new image. (`7bad5ef`)
- ✅ **Corrupt-localStorage parse-fail orphans IDB photos.** `load()` calls `PhotoStore.clearAll()` on parse failure before resetting. (`7bad5ef`)
- ✅ **Marriage photos never migrated to IDB.** `migrateLegacy` now iterates `state.marriages` too. (`7bad5ef`)

### Tier B — High

- ✅ **Service worker `SHELL` array out of sync with `index.html`.** `path-finder.js` and `print-book.js` were loaded by the page but missing from `SHELL`, so offline mode broke for those features. Both added; `CACHE_VERSION` bumped to `v3` to invalidate stale caches. (this commit)
- ✅ **Timeline bar avatar ignored `photoCropAvatar`.** Real bug — couples-photo crops showed the wrong face on the timeline because the bar avatar didn't honour the user-chosen focal point. `buildBarAvatar` now mirrors `UI.avatar`'s crop application. (this commit)
- ✅ **Service worker bypass — `sw.js` was being cached.** `sw.js` is now bypass-cached; `CACHE_VERSION = v2`. (`655b493`)
- ✅ **Google Fonts CSS / Font Awesome CSS not in `SHELL`.** Added `CDN_SHELL` precached on install. (`655b493`)
- ✅ **Crop editor drag math divided by `state.scale`.** Removed; mapped by per-axis slack. Then a final pass switched to manual `<img>` sizing + `transform: translate` + a `MIN_SCALE = 1.05` floor so drag works on both axes regardless of frame aspect. (`655b493`, `319a01f`, `ceb3dde`)
- ✅ **Lineage-export bbox returned null for single-node lineage.** Falls back to focus-node `getBoundingClientRect` → SVG viewBox. (`655b493`)
- ✅ **Synchronous `persist()` per keystroke.** Debounced 250 ms with eager flush on `beforeunload` + `pagehide` + `visibilitychange=hidden`. (`655b493`, `7bad5ef`)
- ✅ **Modal had no focus trap or return-focus.** `Tab`/`Shift+Tab` traps; opens at first focusable; restores previous focus on close. (`655b493`)
- ✅ **HeritageSelect missing `aria-activedescendant`.** Each `<li>` gets a per-instance unique id; combobox attribute updates on hover. (`7bad5ef`)
- ✅ **Pinch-zoom conflicting with browser viewport zoom.** `.tree-svg { touch-action: none; }`. (`655b493`)
- ⛔ **Minimal-JSON export leaks new fields.** Verified false — `applyMinimal` builds the output from a fresh `{}` with an explicit allowlist. Allowlist later expanded to include `gender`, `createdAt`, `updatedAt`. (`7bad5ef`)
- ✅ **`cssAttrEscape` incomplete.** Uses `CSS.escape` when available; regex covers `[`, `]`, `"`, `\`, whitespace as fallback. (`7bad5ef`)
- ✅ **`txValue` didn't catch sync throws inside async callbacks.** Each IDB callback is wrapped via `safe(cb, fail)` so sync throws abort the transaction. (`7bad5ef`)
- ✅ **`pagehide` not wired alongside `beforeunload`.** Wired. (`7bad5ef`)
- ✅ **`replaceAll` racing pending debounce.** `flushPersist()` is called at the start of `replaceAll`. (`7bad5ef`)
- ✅ **No cross-tab sync.** `storage` event listener reloads state and notifies subscribers. (`7bad5ef`)
- ✅ **Photo-migration cascade re-rendered N times on first load.** `setMute()`/`notifyAll()` so one notification fires at the end. (`7bad5ef`)
- ✅ **Tree nodes not keyboard-focusable.** `tabindex=0`, `role=button`, `aria-label`, `keydown` (Enter/Space → inspector), gold focus halo on the photo ring. (`7bad5ef`)
- ✅ **`navigator.storage.persist()` rejection silently swallowed.** Logs the result + one-shot toast on denial. (`7bad5ef`)
- ✅ **README claim that story search is in the header.** Now accurate — header search routes through `PeopleView.setSearch`, which calls `searchStories(q)` and renders dedicated story-result cards. (`07516dd`)
- ✅ **iOS PWA icon was SVG-only.** Apple-touch-icon links updated. (`655b493`)
- ✅ **`.view-head__title` clipping on phones.** `@media (max-width: 640px)` shrinks title 38 → 26 px and stacks actions on their own row. (`07516dd`)
- ✅ **Tree empty-state had no inline CTA.** Inline *Add your first relative* primary button. (`07516dd`)
- ✅ **Reframe button broke on `photoUrl`-only people.** Resolves `draft.photoUrl` directly. (`f4dea50`-era follow-up)
- ⛔ **Cross-tab `storage` listener calling `load()` could clear IDB on parse failure.** Re-evaluated; the parse-failure clear is correct for single-tab corruption. The cross-tab path runs the same `load()`, which is acceptable: if the payload is unparseable everywhere, every tab's photos are already orphan candidates.
- ✅ **`exportFullProfile` poster ignored `photoCropHero`.** Updated poster path to use the hero crop for the round portrait clip with cover-fit + clamp identical to the on-screen render. (`655b493`)

### Tier C — Medium

- ✅ **Timeline `startYear === endYear` bar.** Death-only people render as a 6-px point marker. (`655b493`)
- ✅ **Reduced-motion not gating story-card / modal / toast / lineage banner.** Now gated. (`655b493`, `7bad5ef`)
- ✅ **Touch targets < 44 px.** `@media (pointer: coarse)` bumps `.btn--icon` and `.hsel__opt`. (`7bad5ef`)
- ✅ **Modal focus trap interfering with portaled popovers.** Exempts focus inside `.hdp__pop`, `.hsel__menu`, `.modal-portal-exempt`. (`7bad5ef`)
- ✅ **`inlineSvgImages` no per-export memoisation.** One `Map<href, Promise<dataUrl>>` per `exportTreePng` call. (`7bad5ef`)
- ✅ **`SCHEMA_VERSION` still 1.** Bumped to `2`. (`7bad5ef`)
- ✅ **Marriage keys not normalised on import.** `replaceAll` re-keys via `marriageKey`. (`7bad5ef`)
- ✅ **Inspector accordion focus halo touches the icon.** Inset gold outline on `:focus-visible`. (`6625fba`)
- ✅ **Section body glued to header on hover.** 8 px top padding on the open body. (`6625fba`)
- ✅ **Reframe modal overflowed horizontally; one shared zoom slider for both frames.** Manual layout that fits inside the modal max-width; per-frame zoom slider; the avatar shrinks to 180 px so both fit on one row. (`c548494`)
- ✅ **People grid stretched single result to full height.** `align-content: start` + per-card `align-self: start`. (`07516dd`)
- ✅ **Search returned people-only when matching stories.** Story-result cards now appear above person-result cards; clicking opens the inspector + scrolls to the matched story + flashes a gold halo. (`07516dd`)
- ✅ **Emojis everywhere instead of icons.** Sweep replaced 📍 / ⏳ / ❓ / ✦ / ↗ / ✕ / − / ＋ / { } / 🌳 / 🌱 / 🔎 / ← / ✎ / 🗑 with FA equivalents. (`07516dd`, plus a follow-up sweep across modal-button labels.)
- ✅ **Pet placement on top row + diagonal tether across the canvas.** Pets now sit one generation below their owners, connected with a dashed gold riser (same trunk + rail as their humans' children). When all of a couple's children are pets, the whole connector dashes. (`bfcb5bc`)
- ✅ **Pets not in lineage focus.** Lineage walker now pulls every pet whose owner is in lineage. (`bfcb5bc`)
- ✅ **Edge corners showed visible "steps" at thicker stroke widths.** Switched `.t-edge` to `stroke-linecap: butt` + `linejoin: miter`. (`bfcb5bc`)
- ✅ **Hamburger toggle ghost button on desktop.** Hamburger is `display: none` everywhere except `≤ 768 px`. Documented; closed.
- ✅ **Tools rail had no view-options.** New View Options popover (sliders icon in the tree-controls cluster) with *Show pets / Show story count / Show dates* — each persists per-device via `localStorage`. (`c26cf62`)
- ✅ **Family Highlights cards clipping in narrow inspector.** Stack one-per-row. (`017fd68`)
- ✅ **"Coming up" duplicated in rail and inspector.** Removed from the rail since Family Highlights already surfaces the next anniversary. (`bfcb5bc`)
- ✅ **Path-finder From/To pickers showed empty.** HeritageSelect returns `{ el, ... }`; adapter returns the right shape. (`d403bc5`)
- ✅ **Path-finder hop tooltip floating mid-modal.** Replaced with an `aria-label` that names the person. (`d403bc5`)
- ✅ **Photo uploader buttons inconsistent.** Upload / Reframe / Remove all carry icons. (`07516dd` + follow-ups)
- ✅ **Bare-text dialog buttons across modals.** Sweep covered Cancel / Save / Close / Remove / Forget / Today / Clear and the story-editor footer. (`de8e6be`)
- ✅ **Full SVG re-render on every store mutation.** Topology-signature gate: when the structural bits (parents / spouses / petOwners / isPet / deathDate / story-count presence / photo presence / marriages keys / view toggles) haven't changed, render() skips layout + DOM rebuild and patches cosmetic bits (name / dates / density-chip number) on existing nodes. (`51d2f8c`)
- ✅ **People-view search re-renders the entire grid per keystroke.** Debounced 120 ms + person cards cached in `Map<id, {sig, node}>`. Cache reuses DOM when name/date/place/photo are stable; pruned once size > 2× population. (`51d2f8c`)

### Tier D — Low

- ⛔ **`__addAsParentOf` seed leaking into saved record.** Verified false — the save handler builds the payload explicitly with named fields.
- ⛔ **CDN_SHELL opaque-response concerns.** Verified false — Google Fonts + Font Awesome serve glyph files with permissive CORS, so `mode: "no-cors"` precaching of the CSS works.
- ⛔ **In-memory PhotoStore fallback cross-tab sync.** Closed — the fallback runs only when IndexedDB is unavailable, essentially never on shipped browsers.
- ✅ **Density chip overlapping the photo at deep zoom-out.** Hard-pinned at fixed coordinates relative to the photo ring; never overlaps the photo itself, only floats outside the ring at any zoom.

---

*Last updated 2026-06-19. Tiers reflect impact priority across all four audit rounds + user-reported issues.*
