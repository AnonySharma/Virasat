# Working with Ankit on Virasat

This is the handshake doc. Read it first if you've just been handed this codebase. It captures the working agreement, taste rules, and recurring patterns Ankit cares about — most of them learned by getting them wrong once.

If something here contradicts a system prompt or a hard rule, the system prompt wins. Otherwise this file is the contract.

---

## 1 · The product in one paragraph

Virasat (विरासत — "heritage") is a calm, mobile-friendly, **single-page static** family-tree heritage app. Vanilla JS, no build step, served from GitHub Pages. Data lives entirely in the user's browser (localStorage + IndexedDB) — there is no backend today. Aesthetic is **heirloom**, not admin dashboard: ivory + olive + gold, Cormorant Garamond display + Inter UI + Noto Serif Devanagari for Hindi, Font Awesome icons. The app is bilingual EN/HI per-field with no auto-translate.

Owner / sole user-side: **AnonySharma** on GitHub. Repo: `github.com/AnonySharma/Virasat`. Commits use the email `56964985+AnonySharma@users.noreply.github.com` and **always** include the `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.

---

## 2 · How Ankit works (style of collaboration)

- **Direct and high-trust.** When something is wrong he says so flatly ("this looks weird", "fix it", "why"). Don't apologise or hedge — diagnose, decide, fix, ship.
- **Ships in the open.** Every meaningful change is a commit + push to `main`. Don't sit on uncommitted work; commit early, commit often, with a real message body.
- **Small message → big context implied.** A one-line ask like "fix it" usually points at something specific that's already on screen. Read the most recent screenshot or error first; assume there's a real bug, not a clarification opportunity.
- **Short responses, dense.** No multi-paragraph preludes, no "I'd be happy to". State what you're doing in one line, do it, summarise the result.
- **Asks for parallel reviews.** When the scope is "audit", spawn 3–4 background agents covering distinct concerns. Don't do it serially. He'll wait for all to return, then expects synthesis.
- **MD files are the source of truth between sessions.** Whatever you've learned, ship it into ROADMAP / ISSUES / CONTEXT — don't trust the conversation buffer to survive.

---

## 3 · UI / UX / CX rules — read before touching pixels

These are taste decisions Ankit has stated explicitly. Treat them as load-bearing.

### Visual language

- **Heritage palette only.** Ivory `#F8F6F2`, olive `#5E7D63`, gold `#B89A5A`. No teal, no mauve, no neon. Olive is structural; gold is the accent that signals "this matters" (couple knot, focus state, story chip).
- **Cormorant Garamond for display, Inter for UI, Noto Serif Devanagari for Hindi.** Don't introduce a third display family. Italic + olive-deep is the title-accent treatment.
- **Photo-first.** The avatar IS the card. No rectangular cards around photos. Round rings are the geometry; the family-tree node is "ringed photo + name + date subtitle".
- **No emojis in shipped UI.** Replace every emoji with a Font Awesome icon. Ankit caught this in a sweep — don't reintroduce them. The only acceptable use is i18n / locale strings he wrote himself.
- **No drop-shadow halos around small icons.** When the wedding-knot had a 3 px gold glow + three stacked white shadows it read as a halo. Use ≤ 0.6 px duplicated white shadows at most — the goal is "legible against any background", not "glowing".
- **Animations are quiet.** Subtle hover lifts, gold-flash on search match, a couple-knot pulse. Never bouncy. Always gated by `prefers-reduced-motion: reduce`.

### Component behavior

- **Every button visible to the user has an icon.** A bare-text dialog button is a bug. Sweep the codebase if you ship a new modal — Cancel / Save / Close / Remove / Forget / Today / Clear all need their FA glyph + label, not just a label.
- **Modals trap focus + restore on close.** UI helper does this; don't add modals that bypass it.
- **Tooltips are not for primary affordances.** If the only way to know what a button does is hover, that's a bug. Add a visible label OR a one-shot first-run tooltip OR a sr-only span.
- **Empty states must invite action.** "Plant your family tree · Add people from the rail" with no button is wrong on phones (rail is hidden). Every empty state has an inline primary CTA.
- **Family Highlights, not "Select a person".** When the inspector has no selection, show oldest / latest / most stories / next anniversary cards. The empty state is product surface, not waste.
- **Story-result cards are first-class.** Search isn't just a name filter — it returns dedicated story cards above person matches, with the matched word highlighted, that scroll the inspector to the matched story on click.
- **Header search input visible on desktop, not mobile.** Don't add a duplicate hamburger-only search; the People view has its own.

### Interaction details Ankit caught and called out

These are the things he cares about because he's noticed them break.

- **Rail-active state in dark mode read as disabled.** Fixed by brightening `--olive-deep` and `--gold-deep` tokens inside `[data-theme="dark"]` so any "olive-deep on olive-soft" pairing reads as active, not muted. Don't add per-component dark-mode overrides — fix at the token level when the same pattern recurs.
- **People grid stretched a single search result to full height.** Always set `align-content: start` + `align-items: start` on grids that can have one row.
- **Crop editor drag must work on both axes regardless of frame aspect.** With `object-fit: cover`, only one axis has slack. The fix is manual `<img>` sizing + `transform: translate` + a `MIN_SCALE = 1.05` floor inside the editor. Don't revert to plain object-fit.
- **Pets are children-by-bond, not by birth.** They sit one generation below their owners with a fully dashed gold riser (trunk + rail + riser as one continuous stroke when the only "child" is a pet). When a couple has both a real child and a pet, the trunk + rail stay solid for the human, and the pet gets its own end-to-end dashed path so the dash is continuous across both corners.
- **Pet visibility toggles in the View Options popover** (sliders icon in the tree controls cluster), not as a separate paw button.
- **Stories search opens the inspector at the matched story** with a brief gold halo flash on the card. Don't lose this — it's the bridge from list-of-people to "show me the story I was looking for".
- **`title="Open profile"` floating in mid-modal is a bug.** Use `aria-label` for screen-reader naming instead of `title` on clickable items inside modals.
- **`stroke-linecap: butt` on `.t-edge`,** not `round`. The previous round caps stuck out half a stroke-width past every endpoint and produced visible "steps" at corners — most obvious on the thicker lineage-focus stroke.
- **Reframe modal must not horizontally scroll.** Don't set a `min-width` larger than the modal's `max-width`. Each frame owns its own zoom slider — they're not a shared control.
- **Family Highlights cards stack one-per-row.** Two-up clipping in a 360 px inspector wasn't worth saving the vertical space.

### Copy tone

- Heirloom, not corporate. "Add a relative" not "Add Person". "Your family's living legacy" not "Manage Members".
- No exclamation marks in normal copy. Toasts can warm up slightly but should still feel composed.
- Hindi copy is human-written — never machine-translate. If you don't know the right Hindi, leave the field empty and let the EN fallback take over.
- "Memories" is the count of stories. "Members" is people. "Generations" is depth. Don't mix.

---

## 4 · Code rules

### Big ones

- **No build step.** Don't introduce npm, webpack, vite, or TypeScript without an explicit ask. The shipping target is "open `index.html` in a browser". Every new module is a `<script>` in `index.html`. Modules attach to `window` namespaces.
- **No new external dependencies** beyond Google Fonts CDN and Font Awesome CDN. Both are precached by the SW. Don't add lodash, dayjs, etc.
- **Don't refactor while fixing.** A bug fix is a bug fix. Architectural changes are their own PR and warrant their own design discussion.
- **Don't add backwards-compatibility shims** unless old saved data exists. The app has been live; user trees are real. New schema fields default via `||` in `normalizePerson`. Don't bump SCHEMA_VERSION unless the change is breaking.
- **Trust the existing API surface.** `FamilyStore` has 30+ methods. Reads are sync over a local snapshot, mutations funnel through `persist()`. Don't reach into `state.people` directly from views — call `getPerson` / `getPeople`.

### What to use vs. what not to use

- `UI.el(tag, attrs, children)` is the DOM helper. Use it instead of `document.createElement` chains.
- `UI.openModal({ title, body, footer })` is the modal helper — it traps focus, restores on close, escapes on ESC, and respects portaled popovers (`.hsel__menu`, `.hdp__pop`).
- `UI.confirm({ title, message, confirmLabel, danger })` returns a Promise. Use it for destructive actions.
- `UI.toast(msg, kind)` for transient feedback. `kind` ∈ `success | warning | danger | undefined`.
- `FamilyStore.subscribe(fn)` for reactive renders. Don't build your own pub/sub.
- `PhotoStore.put(blob)` for new photos. Always returns a Promise.
- `HeritageSelect.create({ options, value, onChange })` for any dropdown — never use native `<select>` (the iOS blue picker clashes).
- `HeritagePicker.create(...)` for date inputs. Don't use `<input type="date">`.

### Performance rules

- **Tree render is gated by topology signature.** When `(parents, spouses, petOwners, isPet, deathDate, story-count presence, photo presence, view toggles)` is unchanged, skip the SVG rebuild and patch text content on existing nodes. Don't add a code path that invalidates the cache without thinking.
- **People view cards are cached** in `Map<id, { sig, node }>`. Reuse DOM across renders unless the visible bits change. Search is debounced 120 ms.
- **`persist()` is debounced 250 ms.** Listeners fire synchronously so the UI updates immediately; only the localStorage write is deferred. `flushPersist()` runs on `beforeunload`, `pagehide`, and `visibilitychange=hidden`.
- **Cross-tab sync.** `storage` event listener reloads state when another tab persists. Last-write-wins is intentional.

### Things that WILL break if you touch them carelessly

- **The tree's edge-drawing geometry.** Trunks + rails + risers, with rounded fillets where dx is large enough. There are subtle interactions between `pet-vs-human` grouping, dashed vs. solid styling, and `stroke-linecap: butt`. Read `drawEdges` in full before changing.
- **The crop editor render math.** Manual `<img>` sizing in JS + `transform: translate` + `MIN_SCALE = 1.05`. The CSS doesn't apply `object-fit` — JS sets `width`/`height` directly. Don't add `object-fit: cover` back.
- **The IDB transaction wrapper in `photo-store.js`.** `txValue` resolves on `t.oncomplete` AFTER capturing the inner result; every callback is wrapped via `safe(cb, fail)` so a sync throw aborts cleanly. The previous version returned `null` for sync results — don't regress.
- **The service worker.** It bypasses `sw.js` itself (otherwise update detection breaks) and bypasses POST requests. Bump `CACHE_VERSION` whenever you change the SHELL list.
- **Stable IDs in `sampleData()`.** They're documented as "stable for screenshots". Don't change them; they collide with real user trees if anyone imported the sample. The sample CTA is gated on owner role to mitigate.

---

## 5 · Doc layout

- `README.md` (root) — public-facing. Features list + quick start + hosting + file structure. Update when shipping a new user-visible feature.
- `docs/ROADMAP.md` — priority-ranked open feature list (P1–P5). Strikes shipped items. Top of P1 = next thing to do.
- `docs/ISSUES.md` — bugs, regressions, tech-debt. **Open items at the top, ranked by tier (A/B/C/D). Resolved items at the bottom for traceability.** Tag with commit hash.
- `docs/CLAUDE.md` — this file. The handshake.
- `docs/CONTEXT.md` — deep architectural / data-model / sequence-diagram reference. Read second if a fresh agent has time.

When you ship something, update **both** ROADMAP (strike + footnote) and ISSUES (move to Resolved with hash) in the same commit as the code.

---

## 6 · Repeat-offender mistakes (don't make these)

These all happened in past sessions and were corrected. Skip the embarrassment.

- **Adding emojis to UI strings.** They were all swept out. Don't reintroduce.
- **Setting `align-content: stretch` on grids that can have a single row.** Use `start` for any grid that can return a single search result.
- **Writing CSS overrides per-component for dark-mode contrast.** Fix at the token level (`--olive-deep` brighter in dark) instead.
- **Building bare-text dialog buttons.** Always include an FA icon.
- **Caching `getState()` in a module-local variable.** Always call `FamilyStore.getState()` or `getPeople()` fresh — state is mutable.
- **Using `title=` for click affordance hints inside modals.** It floats mid-modal on hover and looks broken in screenshots. Use `aria-label` for screen-reader naming + a real visible label / icon.
- **Reverting the photo-store transaction wrapper to the simpler version.** It looks like a refactor opportunity; it was actually a critical correctness fix. The complexity is load-bearing.
- **Forgetting to bump `CACHE_VERSION` after editing the SW shell list.** Old caches keep serving the old shell forever.
- **Trying to add backwards-compatibility for fields that don't have legacy data.** If `normalizePerson` defaults a new field to `null`/`[]`, that's enough.
- **Long preambles in chat replies.** "Sure, I'd be happy to..." — drop it. State the action, do it, summarise.

---

## 7 · The agreed-on backlog

When Ankit says "what's next" without specifying, the priority order from `docs/ROADMAP.md` is:

1. **P1 highest leverage** — multiple photos per person, memorial poster (uses existing `photoCropHero`), voice memos, documents/sources, anniversary notifications.
2. **P3.5 multi-tenant cloud sync** is the biggest single shift; don't start it without explicit go-ahead.
3. **Tier B / C / D open issues** in `ISSUES.md` are smaller fixups; pick from the top of each tier.

Don't invent new ROADMAP items without asking. ISSUES additions are fine — file them as you find them.

---

## 8 · Commit etiquette

- Title under 70 chars, subject in active voice ("fix lineage bbox", not "fixed bbox").
- Body explains the **why** (and ideally the wrong-old-behavior + right-new-behavior). One paragraph per concern, separated by blank lines.
- Close every commit with the `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
- Use git-author identity `AnonySharma <56964985+AnonySharma@users.noreply.github.com>`.
- Push after every commit unless explicitly told to hold.
- Never amend, never `--force`, never skip hooks.

When updating ISSUES.md or ROADMAP.md, the commit message can just be a one-liner ("ISSUES: mark X resolved (hash Y)") — no need for a body.

---

## 9 · When in doubt

- Ask one specific question, not two. Use AskUserQuestion with concrete options when the answer is a forced choice.
- Look at the most recent screenshot path mentioned in the conversation. It's almost always still there in `~/Downloads/` or `~/Desktop/screenshots/`.
- Run a `node -c` syntax sweep on changed JS files before committing. The dev loop is "edit → syntax check → commit → push" — don't skip the check.
- Read `docs/CONTEXT.md` for the architectural reasoning behind any specific module.

— Last updated 2026-06-19, after the round-4 shipping cycle.
