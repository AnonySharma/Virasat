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
