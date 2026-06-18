# Roadmap

Items already shipped are struck through and listed in [`README.md`](README.md). The rest are open ideas — not commitments. Wording is kept neutral and inclusive.

If any of these resonate, open an issue or just hack on it. The whole app is vanilla JS with no build step, so it's easy to extend a single file at a time.

The list is **ranked by priority**, not grouped by audit round. Top of each tier is the next thing worth doing; bottom is the most speculative.

---

## P1 — Highest leverage

These move the heritage product forward the most for the effort.

- **Multiple photos per person.** One *primary* avatar + a small gallery (childhood, wedding, late portrait, etc.). Crop editor already handles two frames from one source; extending to N+ is a natural step. Pairs with the Family Map and PDF book features below.
- **Memorial poster** using `photoCropHero`. The hero crop is rendered on the profile-page hero band but ignored by the share poster. A dedicated *Memorial print* template (A4 landscape, hero photo at the top, lifespan + key dates underneath) is straightforward — the data is already there.
- **Voice memos as a primary form CTA.** Make the affordance load-bearing — a *Record a 30-second memory* button beside the Notes field, with a waveform preview. Without surface area, users won't discover the feature.
- **Documents / sources.** Attach scans of letters, certificates, articles. Cite them on dates and achievements so future generations can verify.
- **Per-anniversary notification opt-in.** With the *Coming up* data already computed (see `FamilyStore.upcomingAnniversaries`), wire `Notification.requestPermission()` on first run and fire a local notification on the day of each event when the PWA is installed. Calendar export (`.ics`) is a free secondary outcome.

---

## P2 — Worthwhile, smaller scope

- **Detailed vs compact tree views.** A toggle on the Tree view:
  - *Compact* — only direct lineage (default focus on whoever is set as "self"), good at-a-glance.
  - *Detailed* — shows every person who married into the family + their parents, children, and grandchildren as long as the chain stays connected.
- **Pin a "self" person.** All views can then highlight relationship paths and label everyone with how they relate to you ("paternal grandmother", "spouse's brother"). Pairs naturally with the path-finder that already exists.
- **Auto-tag who's in a group photo** by clicking faces and assigning a person — useful for old family albums.
- **Date precision: BCE / month-only.** Today `parseDate` accepts `YYYY[-MM[-DD]]` only. Negative years and "March (year unknown)" are real for ancient genealogies. Defer until someone needs it.
- **Calendar systems** — record dates in Vikram Samvat / Hijri / etc. alongside Gregorian, with a per-tree default.
- **Beyond two languages** — each field can have any number of language variants (`name`, `name_hi`, `name_pa`, `name_te`...). Keep the rule: only show what the user wrote.
- **Right-to-left** support for Urdu / Arabic alongside Hindi.
- **Relationship tags.** Mark adoption, step-, half-, partner (unmarried), divorced, deceased-in-infancy. The tree should render these visually (dashed couple line for divorced, etc.).
- **Detailed-view branches for "married-out" lineages.** When a relative marries someone from outside the family, optionally show their parents and siblings too (one generation up, one wide).

---

## P3 — Big features (high cost, real value)

- **Family Map view.** A new top-nav tab. Birthplace, migration, current residence, connected through generations. Powerful for genealogy. Needs a tile provider + clustering — non-trivial.
- **GEDCOM import / export.** Interop with Ancestry / FamilySearch and other family-tree apps.
- **QR-code share** — generate a QR that opens a read-only view of one person's profile, useful at family gatherings.

  *(Multi-user editing, public links, and per-record privacy flags are now folded into the **Multi-tenant cloud sync** section below — they need an auth model to work end-to-end, not a flag.)*

---

## P3.5 — Multi-tenant cloud sync (auth + sharing)

A separate tier because it's the single biggest product shift: turning Virasat from a single-device personal artifact into a family-shared archive. Big enough that I had four parallel review agents read the codebase + scrape vendor pricing pages before writing this. Verdict: **medium-hard, ~2.5 weeks of focused work**, on Supabase + GitHub Pages, with the architecture mostly already set up well for it.

### What it actually is

- **Sign in once**, see your trees on any device.
- Each user owns one or more trees. Each tree has **owner + members**, where each member is `viewer / editor / owner`.
- **Optional public/unlisted link** per tree (Google-Docs-style: *Anyone with the link can view*, or *Anyone can find via search*).
- Existing offline-first behaviour is preserved — when the network's down, edits queue locally and replay on reconnect.

### Effort & shape

| Phase | Days |
|---|---|
| Supabase project + schema + RLS policies | 1 |
| Auth flow (magic-link + Google + Apple OAuth) | 1 |
| `cloud-store.js` adapter + tree CRUD | 2 |
| Photo storage adapter (IDB cache + Supabase Storage) | 2 |
| Tree-list UI + tree switcher | 1 |
| Share dialog + member roles UI | 2 |
| Public / unlisted token-based read path | 1 |
| Migration UI for existing local data | 1 |
| Conflict handling (optimistic locking + refresh prompt) | 1 |
| Offline queue + reconnect replay | 2 |
| Privacy stripping function (server-side redact for viewer role) | 1 |
| Edge cases, audit log, polish | 2 |
| **Total** | **~17 dev days, ~2.5 weeks calendar** |

**New code:** ~1,500 lines across `lib/auth/auth-store.js`, `lib/auth/cloud-store.js`, `lib/auth/tree-list.js`, `lib/auth/sharing.js`, `lib/auth/sign-in.js`. **Existing code touched:** ~200 lines (mostly in `data-store.js` to add a backend hook + scope localStorage keys per tree). **View modules unchanged** — they keep calling `FamilyStore.getPeople()` etc.

### Backend: Supabase

Comparison agent ran the numbers on Supabase / Cloudflare Workers + D1 + R2 / Firebase / Pocketbase / Appwrite. **Supabase wins for this app**:
- **Postgres RLS** expresses the entire owner / editor / viewer + share-token model in declarative SQL — no app-level permission checks.
- **Free tier** covers 50k MAU, 500 MB Postgres, 1 GB Storage. A family-tree of ~50 people is ~30 KB JSON, so 500 MB ≈ 15k trees. 1 GB Storage ≈ 30k 30 KB JPEGs. Comfortable for thousands of users.
- **At 10k MAU + 100 GB photos**: ~$25–50/mo on Pro plan.
- **Vendor lock-in**: low. Data is plain Postgres + S3-protocol storage. Migrating later to Cloudflare Workers + D1 + R2 is ~3 days of plumbing, not a rewrite.
- **SDK** works as a `<script type="module">` import — no build step required, fits the no-build promise.

**Runner-up: Cloudflare Workers + D1 + R2** if you grow past Supabase Pro and hate the bill — R2 has zero egress fees. Requires you to write the auth and authorisation yourself (~500 LOC). Pocketbase / Appwrite (self-hosted) skipped because they require operating a server, which kills the "static site, no backend to run" property.

### How realistic is "swap one module"

Backend-swap-surface agent verified the claim **partially true**. The audit:
- `FamilyStore`'s 30-method API has 13 pure helpers + derivations that need zero changes (`parseDate`, `calcAge`, `buildGenerations`, `findRelationPath`, etc.).
- 8 mutation methods (`addPerson`, `updatePerson`, `deletePerson`, `replaceAll`, `clearAll`, `addStory`, `updateStory`, `deleteStory`) cleanly funnel through one `persist()` hook.
- Reads stay synchronous over a locally-cached state snapshot — every `getPerson(id)` call across the codebase (path-finder, timeline-view, tree-view, people-view, profile-view, inspector) keeps its current sync contract.
- All `FamilyStore.subscribe()` callers (5 of them) are read-only renders — none assume the change was local. Cross-user updates from Realtime drop into the same path as a local edit.
- All direct `getState()` calls (5 of them, for export and PNG rendering) treat the returned object as an immutable snapshot. No hidden writes.
- Photo flow is already async-first (`put`/`get`/`getUrl` return Promises, `getUrlSync` is best-effort cached) so the IDB-cache + cloud-origin model is a near-direct swap.

The **real work** is in the cache/sync layer behind `FamilyStore`, not in rewriting views.

### Schema

JSONB blob, not normalised tables:

```
trees(id, owner_id, title, family_name, schema_version, share_token,
      visibility enum('private', 'unlisted', 'public'),
      data jsonb, created_at, updated_at)
tree_members(tree_id, user_id, role enum('owner','editor','viewer'),
             invited_by, invited_at)
tree_photos(id, tree_id, person_id, storage_path, crop_avatar jsonb,
            crop_hero jsonb, uploaded_by, uploaded_at)
```

Why blob: family trees are document-shaped, read-heavy, and small (≤ 1 MB even at 500 people). Single-query reads beat multi-table joins. Conflict story is acceptable — two people editing simultaneously is rare; "refresh to see latest" is fine for this domain. Normalising later if needed is a weekend migration.

Photos stay in object storage with a metadata row pointing at them — never in the JSONB. Embedding 30 KB blobs would inflate every write to the whole-tree blob.

### RLS policies (sketch — full SQL ready to paste)

- **`SELECT trees`**: owner OR listed member OR (visibility ≠ private AND share_token matches header).
- **`UPDATE trees`**: owner OR member with role = 'editor'.
- **`DELETE trees`**: owner only.
- **`tree_members`**: only the owner can invite / change roles / remove.
- **`tree_photos`**: anyone who can see the tree can read; owner + editors can write.

**Privacy stripping** for viewers (the per-field `privatePhone` / `privateEmail` / `privateAddress` flags from contacts) lives in a `security definer` Postgres function that returns a redacted `data` JSONB based on requester role. The viewer never receives the bytes — DevTools can't unmask them. Owner + editor calls bypass the redaction.

### What needs new privacy flags

The audit found gaps the existing schema doesn't cover for viewer mode:
- **`story.private`** — currently every story is owner-or-nothing. Some stories are personal even within a family.
- **`person.notesPrivate`** — notes have no flag; a viewer sees them all.
- **`person.birthDatePrivacy: 'full' | 'year-only' | 'hidden'`** — exact birthdate of a living relative leaks age. Year-only would be enough for most viewer cases.
- **`marriage.private`** — marriage records have a `story` field; "He proposed in the lecture hall" is shareable, "they separated twice before marrying" is not.

These fields don't change the schema migration cost — they're additive to the `data` JSONB.

### Offline + sync protocol

1. Local mutations append to a `mutation_queue` IndexedDB store (id, tree_id, type, payload, client_ts).
2. On reconnect, POST queue to `/sync`. Server compares `trees.updated_at` vs. `client_last_synced_at`.
3. **No conflict** → server applies mutations sequentially against the JSONB blob, returns `{ status: ok }`.
4. **Conflict** → server returns `{ status: conflict, server_data, conflicting_mutations }`. Client shows modal: "Someone else edited while you were offline. [Keep theirs] [Keep mine] [Merge]".
5. **Optimistic UI** → mutations apply immediately to local state with a "pending sync" badge; green check on confirmation, red on conflict.

Last-write-wins on the JSONB blob is acceptable for family trees (rare concurrent editing). True CRDT / OT is overkill.

### Realtime tier

Start with **60-second polling**, not WebSocket. Family trees rarely have >2 concurrent editors, a 60-second lag is fine ("Priya updated 30s ago — refresh?"), and it saves $120/yr. Upgrade to Supabase Realtime WebSocket only when `tree_members.length > 2` (hybrid mode: live badge appears when other editors are active).

### Migration for existing local users

Critical to get right — existing users have months of localStorage data that shouldn't disappear:

1. **Sign-in is opt-in.** First-time visitors keep using local-only mode by default. Add a soft "Save to cloud" CTA in the rail.
2. **First sign-in detects existing localStorage data** and asks: *"Upload this tree to your account as a new cloud tree?"* If yes, INSERT into `trees`, upload any base64-embedded photos to Storage as proper `photoId` rows, and start syncing. **Local data stays untouched as a fallback** — never destroyed by the migration.
3. **Tree switch** keeps the local tree as `?tree=local` and cloud trees as `?tree=<uuid>`. Same `FamilyStore` API, different backend per tree.
4. **Local + cloud coexistence** for users who want some trees private to one device.

### localStorage keys to scope per-tree

Currently global, will need scoping when multiple trees coexist:
- `familyTree.v1` → `familyTree.${treeId}.v1`
- `familyTree.inspector.sections` → per-tree
- `timeline.pxPerYear` → per-tree
- `tree.showPets` / `showStoryCount` / `showDates` → per-tree
- `virasat.filter` (sessionStorage) → per-tree

These stay global (user preferences, not tree-specific):
- `virasat.theme`
- `familyTree.lang`
- `virasat.persistWarned`

The IDB photo store also needs tree-scoping — currently one bucket for all photos; with multiple trees that's a leak vector. Either one IDB database per tree (`familyTree.photos.${treeId}`) or compound keys (`${treeId}|${photoId}`).

### Sharing model edge cases

Caught by the auth-UX audit, worth fixing alongside the cloud work:

- **Sample-data + public link collision.** If a viewer of a public tree clicks "Try sample family", current code calls `replaceAll(sampleData())` and overwrites the tree (sample uses fixed ids that collide with anything that ever held them). Fix: gate the sample-data CTA on `role === 'owner'`.
- **Lineage-focus state in shared URL.** If the owner shares the tree mid-focus, the viewer sees one branch and thinks the tree is broken. Add `?focus=personId` to share URLs and a "Show full tree" banner.
- **Role-based UI hiding.** Hide Add / Edit / Delete buttons for `viewer` role. Server still enforces — never trust the client.
- **Tree-switching + inspector selection.** `Inspector.clear()` on tree switch so the previous tree's selection doesn't show "person not found".
- **Search-engine indexing of public trees.** Add `<meta name="robots" content="noindex">` unless the user explicitly opts in to "List in search engines" (separate flag from the share-token public mode).
- **Per-row tombstones.** `deletePerson` and `deleteMarriage` currently leave no trace. With multi-user editing, "who deleted Grandma?" is a real question. Add `state.deletedPeople[id] = { deletedBy, deletedAt }` plus an audit log table.
- **Conflict UX must be specific.** Two editors changing different fields on the same person → silent overwrite under naive last-write-wins. Use optimistic locking on `person.updatedAt` and surface the diff modal: *"Person X was edited by [User B] 3 seconds ago. Your changes: [diff]. Their changes: [diff]. [Keep mine] [Take theirs] [Merge]."*

### Hosting

- **Frontend:** stays static. GitHub Pages or Cloudflare Pages. **No change** to the no-build pipeline.
- **Backend:** one Supabase project (free tier). No server to operate.
- **CORS:** configure Supabase to accept the Pages origin (one click).
- **Service worker:** add a Supabase-bypass conditional (`url.hostname.endsWith(".supabase.co")` → pass through to network, no caching). POST/PUT requests with bearer tokens must never hit the cache.
- **Custom domain:** unchanged. SDK calls go to `<project>.supabase.co`; the user's domain stays on Pages.

### When to do this

After the current product is stable and we have at least one real-world user feedback cycle from the local-only version. Cloud sync adds two failure modes (network, account) the app doesn't have today — it's worth shipping the heirloom-quality single-device experience first, getting that loved, *then* turning it into a shared archive.

---

### Stack & security review — should we move off vanilla JS for production?

The owner asked, before going public: is vanilla JS + localStorage actually safe? Should we move to a "better" stack that handles state more rigorously? Four parallel audit agents looked at this from distinct angles — security/data-leakage, framework comparison, state-management correctness, production-readiness checklist. Their consolidated findings:

#### Headline answer

**Stay vanilla. Harden security at the source. Don't rewrite.**

Three independently-arrived-at conclusions:

1. **The vanilla code is not the security problem.** `UI.el(tag, attrs, children)` routes children through `createTextNode(String(c))` — security-equivalent to React's JSX auto-escaping. Every user-text field in the codebase (`person.name`, `description`, `story.body`, `notes`, `achievements[]`, etc.) was traced and confirmed rendered as text nodes, not innerHTML. There are six `innerHTML = ""` calls (all clearings, all safe) and one **dangerous** `html` attribute on `UI.el` that's currently unused but is a future-bug trap. **Action: remove the `html` attribute. Five-minute fix.**
2. **localStorage isn't worse than IndexedDB for this threat model.** Both are same-origin plaintext, both readable by any script that runs on the origin. The defence isn't "move to IDB" — it's "no malicious script ever reaches the origin", which means CSP + SRI + careful dependency hygiene. Encryption in either store works the same way. *Migrating from localStorage to IDB is security theatre.*
3. **Framework migrations don't solve any of the actual gaps.** React/Next/Svelte don't give you CSP, SRI, EXIF stripping, deletion flows, or audit logs by default. They add ~200 KB and a build step in exchange for a rendering model the app doesn't need (no per-field reactivity bottleneck — the SVG layout is the cost, and that's imperative either way).

#### What's actually load-bearing in `FamilyStore`

The state-management audit found the existing model is **sneaky-good**:
- Single source of truth (closure-scoped `state`), public API only via getters / mutation methods.
- Mutations are atomic per-call.
- 250 ms persist debounce + flush on `beforeunload` / `pagehide` / `visibilitychange=hidden` is the correct pattern for localStorage's constraints.
- Cross-tab sync via the `storage` event is implemented (most local-first apps skip this).
- Topology-signature gating in tree-view delivers React-like partial re-renders without React — name edits on a 100-person tree cost ~1 ms (textContent updates) instead of 50 ms (full SVG rebuild).

What it's **missing** from the industry-standard scorecard: immutable updates, time-travel/undo, selectors/memoisation, devtools, type safety. None of these are required for a single-user document editor at 50–500 people scale.

What it's **fragile** about (fixable in ~100 lines without changing the model):
- Cross-tab silent overwrite — Tab A persisting silently discards Tab B's pending debounced write. Should surface a "Another tab updated this tree — reload?" banner.
- One-tab corrupt JSON wipes the other tab's view via the cross-tab `storage` listener — should validate before reloading.
- `syncSpouses` is non-transactional — mid-mutation crash could leave spouse arrays asymmetric. Batch in one mutation.
- Birth-year edits that shift generations don't bust the topology signature (rare; year would have to cross a generation boundary). Add `getYear(birthDate)` to the signature.

#### Framework comparison — what we'd lose by migrating

The framework-comparison agent ran nine candidates (Vanilla / Vanilla+Vite / Svelte 5 / Solid.js / Preact+Signals / React+Zustand / Next.js+Postgres / Remix / Astro) against eleven criteria specific to this app. The matrix conclusions:

- **No framework preserves the no-build deploy property.** That's a real cost — the app is hand-edited and pushed; "open `index.html` in a browser" works for any future maintainer who picks the project up.
- **Server-first frameworks (Next, Remix) are wrong for this app.** Virasat is a client-only document editor with offline-first as its raison d'être. Server-side rendering + DB-backed state inverts the model.
- **Astro is wrong** — it's a static-site generator; you'd recreate the whole SPA inside an Astro island (20–30 days fighting the framework).
- **Solid.js / Svelte 5** would each need 15–25 days for a full rewrite, with no clear win for a 500-person-max single-user document editor.
- **Preact + Signals** is the only candidate worth considering long-term — 5 KB bundle, JSX auto-escaping (genuine security win for *new* code, doesn't fix existing safety which is already good), signals fit read-heavy rendering. 15–20 day rewrite. **Not yet justified.**

The TL;DR from that agent's report: *"Stay vanilla + harden security now (1–2 days). Revisit the framework question in 2027 if vanilla state management becomes tangled — and only then consider Preact."*

#### Production-readiness gate

The production-checklist agent gave the current stack a **38 % readiness score** for "public web app exposed to the internet", with three categorical blockers:

| Tier | Blocker | Fix time |
|---|---|---|
| **Legal / data protection** | No Privacy Policy. No right-to-erasure flow. No consent flow for shared trees. | ~1 day |
| **Data security** | EXIF stripping unverified (canvas.toBlob *should* strip it but no test confirms). `UI.el`'s `html` attribute is an XSS trap. CSP / SRI / X-Frame-Options can't be set on GitHub Pages. | ~1 day (move to Cloudflare Pages for headers) |
| **Operational** | No backups. No monitoring. No incident-response plan. | ~1 day |

When the P3.5 cloud-sync work lands, the same agent gave a **63 %** readiness score with one extra blocker (rate limiting / abuse prevention) and warned that multi-tenant scoping bugs could leak user data across trees if the per-tree localStorage / IDB scoping (already documented above in this section) isn't done meticulously.

**Total time-to-launch:**
- Single-device public alpha: ~4 days of hardening on top of current state.
- Full P3.5 multi-tenant production: P3.5 dev (~17 days) + 1 week security hardening = ~6 weeks total.

#### The hardening checklist (do these regardless of stack choice)

In priority order, all doable on the existing vanilla codebase without migrating to a framework:

1. **Remove the `html` attribute from `UI.el`** (5 min). It's unused and an XSS trap.
2. **Add CSP via `<meta http-equiv="Content-Security-Policy">`** (15 min). Restrict `script-src 'self'`, whitelist Google Fonts + Font Awesome + Supabase origins, deny inline scripts, deny `frame-ancestors`. Meta-tag CSP is weaker than HTTP-header CSP but functional.
3. **Add SRI hashes to the two CDN `<link>` tags** (15 min). `<link integrity="sha384-..." crossorigin="anonymous">`. Protects against Google Fonts / Font Awesome supply-chain compromise.
4. **Verify EXIF stripping in `photo-store.js`** (2 hr). Write a test: upload a photo with known GPS coordinates → verify the IDB blob is stripped. If any browser leaks, add `piexifjs` (3 KB) defensively.
5. **Migrate hosting from GitHub Pages to Cloudflare Pages** (1 hr, no code changes). Same static-site model, but Cloudflare Workers transforms can set real HTTP headers — CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy, X-Content-Type-Options.
6. **Add cross-tab conflict banner** (1 hr). When the `storage` event fires while the user is mid-edit, show a non-blocking "Another tab updated this tree — your last edit was discarded. [Reload]" instead of silently swallowing.
7. **Make `syncSpouses` transactional** (30 min). Batch all updates into a single `state.people = next` assignment to avoid mid-mutation crash leaving arrays asymmetric.
8. **Privacy Policy + right-to-erasure flow** (1 day). Mandatory for any GDPR/CCPA-relevant launch. The "Reset everything" button can be re-purposed as the deletion path; needs clearer copy + email confirmation.
9. **Pre-launch privacy audit on every user-text rendering site** (30 min). Document each one as "renders via `UI.el → createTextNode`" or "is `textContent`/`.value` assignment". Lock in the convention.

That's ~3 calendar days of work to take the current vanilla codebase from "good enough for friends-and-family beta" to "good enough for a public soft-launch with a privacy policy". A rewrite would take 15–25 days minimum and not improve the security score by anything close to what those 3 days achieve.

#### When to revisit the framework question

Three triggers — any one of them justifies a re-evaluation, none of them are urgent today:

1. **Inspector or tree complexity exceeds ~10 sections per panel** with cross-section dependencies. Current count is 8 inspector sections; any further growth and the manual subscribe + render dance starts looking like home-grown reactivity.
2. **External contributors join.** Vanilla is the lowest-barrier baseline for "anyone with HTML knowledge", but a popular open-source project will find more contributors via React / Preact than vanilla. Migration time becomes the price of admission to a larger contributor pool.
3. **A second view or feature needs the same SVG-layout-style imperative rendering with reactive state.** Today the tree is the only place doing this, and the topology-signature gate handles it. A second imperative-render island would benefit from a framework's escape hatch (Preact's `useEffect`, Svelte's actions, etc.).

When any of these trigger fires, **Preact + Signals** is the destination — 5 KB bundle, JSX auto-escaping, signals model fits read-heavy doc-editor workload, ESM CDN import means the no-build property survives if you're disciplined about avoiding JSX (use `h(...)` calls in plain JS).

#### Bottom line

Vanilla JS + localStorage + GitHub Pages is **fine for production** with three days of hardening (CSP, SRI, EXIF verification, Cloudflare Pages migration, Privacy Policy, deletion flow, cross-tab conflict banner). Moving to a framework now would burn 15–25 days for ~5 % security improvement that can be achieved in 3 days at the source. The state-management model is sneaky-good for this workload — a framework would *replace* it with something that's not obviously better and likely worse for the SVG-layout work that dominates the cost.

The single biggest win to actually unlock public production is **moving hosting to Cloudflare Pages so we can set real HTTP security headers**. That's an afternoon's work and worth more than any rewrite.

---

## P4 — Nice polish, no rush

- **Layered canvas background.** Subtle paper texture + faded family motifs (letters, stamps, seals, temple carvings) at 3–5% opacity + faint generation rings emanating from the oldest ancestor. The current ivory + olive radial is fine but generic.
- **Photo / video / document counts** on tree nodes (alongside the story-count chip already there).
- **Custom background or motif** (a family crest, a regional pattern) per tree.
- **Per-person colour accent** — assign a small accent colour per branch to make multi-generation trees easier to follow.
- **High-contrast theme.** Light/dark already exists; a third pass for low-vision contrast wouldn't hurt.
- **Larger text mode** for older relatives.
- **Undo / redo** for edits, including delete.
- **Timeline minimap** — for trees that span 5+ generations and 200+ years, a small overview strip below the timeline so you can jump quickly.

---

## P5 — AI / generative

These need an opt-in / API key path. None of them block on each other.

- **AI story generator.** Given a person's facts (dates, places, occupation, relations), draft a short paragraph the user can edit. Local-only by default; opt-in API.
- **Photo restoration / colourisation.** Optional service to clean up old scans.
- **Voice transcription** — auto-transcribe voice memos into searchable text (pairs with voice memos in P1).

---

## Shipped (highlights)

A short list. The fuller picture lives in [`README.md`](README.md) under *Features*.

- ~~Three-pane workspace (rail / canvas / inspector) with the heritage palette (ivory + olive + gold), Cormorant Garamond + Inter typography.~~
- ~~Tree, People, Timeline views with shared filter, lineage focus, and a unified `view-head` header rhythm.~~
- ~~Photo-first tree nodes with a gold knot between partner photos. Right-click a node for Add child / Add spouse / Add parent. Click the knot for a Marriage modal (date / place / story / photo).~~
- ~~Heritage date picker (year-only mode, today/clear chips with FA icons).~~
- ~~Heritage custom dropdown replacing native selects, with `aria-activedescendant` for screen-reader keyboard nav.~~
- ~~Father / Mother / Spouse(s) as separate pickers.~~
- ~~Soft filter — Living / Deceased dim non-matching members in the active view, no view switch.~~
- ~~Hindi UI + per-field Hindi text companions, no auto-translate.~~
- ~~Google Form template + CSV import flow.~~
- ~~PNG export with quality presets (Sketch / Standard / Great / Heirloom). Lineage-only export when a person is in focus.~~
- ~~JSON export/import with photos inlined as base64; round-trip lossless. Marriages included; per-field privacy flags strip flagged values.~~
- ~~Reset everything — wipes localStorage state, IndexedDB photos, the inspector selection, and the filter.~~
- ~~Mobile responsive: hamburger rail, slide-in inspector, touch pan/zoom, iOS safe-area for the zoom cluster + toasts.~~
- ~~Date precision flags (`exact|about|before|after`) rendered in profile chips, tree compact form, and as a faded edge gradient on the timeline.~~
- ~~Stories — long-form memories with tags. Header search returns dedicated story-result cards (snippet, highlighted match, tag chips); clicking opens the inspector at the matched story with a brief gold halo.~~
- ~~Two-frame photo cropping (avatar + 16:9 hero). Drag-with-slack math + per-frame zoom slider so both axes work regardless of frame aspect.~~
- ~~Lineage banner ("Viewing as: Name · Reset view") + lineage-only PNG export. Pets whose owner is in lineage stay bright too.~~
- ~~Full-profile share poster (hero, lifeline chips, About, Achievements, Education, Family, Stories, Notes).~~
- ~~Editable tree title (any free-form string) with eyebrow "Established c. NNNN" + memory count in the subtitle.~~
- ~~Offline-capable PWA via service worker + web app manifest. Family-archive completion bar and "Family highlights" empty-inspector card.~~
- ~~Anniversaries surfaced in the inspector empty state (oldest ancestor / latest addition / most stories / next birthday).~~
- ~~"Needs attention" rail card with deep-links into a People view filtered by missing-field.~~
- ~~Per-person contact info (phone / email / address) with per-field privacy flags. Inspector renders rows that link via tel: / mailto: / Maps.~~
- ~~Pets / companion animals — `isPet` + `petOwners[]`. Pets sit one generation below their humans, connected with a dashed gold riser. View Options popover toggles them on/off.~~
- ~~Lineage path-finder (BFS over parent / child / spouse edges). Modal renders the chain as avatars + relation chips.~~
- ~~PDF family book — `PrintBook.open()` builds a hidden DOM with one A4 page per relative + cover, then calls `window.print()`.~~
- ~~Dark-mode toggle (sun / moon header pill). Active rail item gets gold-soft + bright text in dark theme so it doesn't read as disabled.~~
- ~~Try-sample-family rail action (gated by destructive confirm).~~
- ~~Story-density chip on each tree node (top-left of photo ring) showing story count.~~
- ~~Icon sweep across visible buttons — every dialog button (Cancel / Save / Close / Remove / Forget / Today / Clear / etc.) carries a Font Awesome icon.~~
