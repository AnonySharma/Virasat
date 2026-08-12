# Feature ideas — exploratory backlog

This is a brainstorm, not a plan. Everything here sits one level more speculative
than [`ROADMAP.md`](ROADMAP.md): ideas worth thinking about, not yet scoped,
sequenced, or committed to. When one of these matures — gets scoped, weighed
against the rest of the backlog, and greenlit — it graduates into `ROADMAP.md`.
Until then it lives here so it isn't lost.

Same ground rules as every other doc in this repo:

- **No build step, no new runtime dependencies.** Everything below is achievable
  as another `<script>` IIFE on `window.*`, using only what the browser already
  gives us (Web Speech API, Web Crypto API, SVG, `<canvas>`) or what's already
  vendored (Google Fonts, Font Awesome, Supabase). Where an idea would need a
  library, that's called out as a risk, not waved past.
- **Heirloom, not social network.** No feeds, no likes, no streaks, no engagement
  metrics. A short "considered and rejected" section at the bottom names the ideas
  that crossed this line and why they didn't make the cut.
- **Checked against the current codebase**, not just the README pitch — every
  idea below was verified as *not* already shipped and *not* already sitting in
  `ROADMAP.md`'s P1–P5. A few extend an existing ROADMAP item; those say so
  explicitly instead of quietly duplicating it.

Tiers mirror urgency, roughly analogous to ROADMAP's P1–P5 but one step earlier
in the pipeline: **Now** (cheap, high-value, could jump straight to P1 with light
scoping) → **Next** → **Later** → **Someday** (valuable but genuinely big, or
needs a product decision before any code).

---

## Now

Small, self-contained, high value-per-hour. Most of these could be folded
straight into `ROADMAP.md` P1/P2 with a day of scoping.

#### 1. Structured interview prompts
*A picker of gentle, specific questions that feeds straight into the existing Notes / Stories flow.*

- **What it does:** A small "Need an idea?" affordance beside the Stories editor
  and the (planned) voice-memo button, offering rotating prompts — *"What did a
  Sunday look like in your childhood home?"*, *"What's a phrase your grandfather
  always said?"* — that drop straight into the story title/body fields.
- **Value:** Solves the blank-page problem for the person being interviewed
  (usually the oldest relative), not the tree-builder. Most people don't know
  what to say when handed an open "tell a story" field; a prompt turns a
  30-second memory into something committed to the record.
- **Fit:** Purely additive to an existing feature, no new data shape, no
  notifications, no pressure — it's a suggestion, never required.
- **Effort:** S. Content is copywriting (needs EN+HI, human-written per the
  Hindi-copy rule) plus a small dropdown/carousel component. **Directly
  amplifies ROADMAP P1's "voice memos as a primary form CTA"** — ship this
  alongside it, not instead of it.
- **Tier: Now.**

#### 2. Unknown / unspecified parent marker
*An explicit "parent not known" state, distinct from "field left blank."*

- **What it does:** A third option beside the Father/Mother pickers —
  *Unknown* — that renders as a soft placeholder node ("Unknown father") in the
  tree instead of just... nothing. Distinct from ROADMAP P2's relationship tags
  (adoption/step/half/divorced), which describe a *known* relationship's
  *nature*; this describes the case where the relationship is real but the
  person's identity was never recorded — common in adoption records, foundling
  histories, and pre-20th-century genealogies.
- **Value:** For a tree-builder documenting an adoption or an ancestor with a
  lost paternal line, "blank" and "actively unknown" are different facts. Blank
  reads as "haven't gotten to this yet"; Unknown reads as "we looked, we don't
  know, and that itself is worth recording."
- **Fit:** Quietly on-theme — genealogy has always had to represent absence
  gracefully. No visual noise for the 95% of trees that don't need it.
  Should ship as a **required companion to ROADMAP P2's relationship tags**,
  same PR ideally.
- **Effort:** S. One new sentinel value + a small tree-rendering treatment
  (dashed placeholder ring, similar visual language to the pet dashed-riser
  already in `tree-view.js`).
- **Tier: Now.**

#### 3. Disconnected-person finder
*A "Needs attention" sibling that flags people floating with zero links.*

- **What it does:** `FamilyStore.maintenanceStats()` already counts people
  missing a birth date / photo / description (`data-store.js`, surfaced via the
  rail's "Needs attention" card). This adds a fourth count: people with no
  parents, no spouses, and no children — nodes that exist in the data but are
  invisible relationship-wise, often the result of an aborted add or a botched
  CSV import.
- **Value:** For the tree-builder maintaining data quality across 50–200
  people, an orphaned record is easy to create (cancel a form mid-way, or a CSV
  row with a name-matching miss) and hard to notice — it just sits in the People
  list, disconnected, never appearing in the Tree view's generations at all
  once `buildGenerations()` can't place it.
- **Fit:** Same "soul of the tree" spirit as the existing Family Highlights /
  Archive-completion panel — a health signal, not a nag.
- **Effort:** S. One more O(N) walk alongside the existing `maintenanceStats`
  pass, one more rail row, reusing the exact click-to-filter pattern
  `peopleMissing()` already has.
- **Tier: Now.**

#### 4. In Memoriam mode
*A tasteful, distinct treatment for records once a death date is set — not just a rust-colored chip.*

- **What it does:** When `deathDate` is set, the profile gets a quiet visual
  marker (a small gold-outlined candle or leaf glyph beside the name — not a
  banner, not a color change to the whole page) and destructive actions get one
  extra confirm step: *"[Name] is recorded as passed. Delete their memorial
  record anyway?"* Today `deletePerson` treats a deceased grandparent exactly
  like a duplicate test entry.
- **Value:** For a family archive specifically, the record of someone who has
  died is the highest-stakes data in the tree — the person can't be
  re-interviewed, re-photographed, or corrected by asking them. An accidental
  delete of a living person is annoying; an accidental delete of the only
  digitized record of a deceased great-grandmother is a real loss.
- **Fit:** This is exactly the kind of feature a heritage app should have and a
  generic CRM never would — treating death as a data event worth handling with
  care is the whole premise of Virasat.
- **Effort:** S/M. Reuses the existing `--rust` token and `isDeceased()` helper;
  the extra confirm step is a copy/config change to the existing
  `UI.confirm({ danger: true })` call in `deletePerson`'s caller.
- **Tier: Now.**

#### 5. Read-aloud narration
*A speaker-icon button that reads a profile's About/Stories aloud via the browser's built-in voice.*

- **What it does:** Adds a small "Read aloud" toggle beside the About section
  and each story card, using the native `SpeechSynthesis` API (`window.speechSynthesis`,
  zero dependencies, supported in every modern browser) to narrate the text.
  Respects the current language toggle — reads the Hindi text with a Hindi
  voice when available, falling back to English.
- **Value:** Solves a real problem for the "older relative browsing the
  archive" persona explicitly called out in this product's audience — vision
  that makes even Cormorant Garamond at comfortable size hard to read for long
  stretches, especially for stories that run several paragraphs.
- **Fit:** Pure accessibility, no new data, no third-party service (some
  competitors would reach for a paid TTS API — the point here is that the
  browser already has one, so it costs nothing and adds no dependency).
- **Effort:** S. `SpeechSynthesis.speak()` is a handful of lines; the main work
  is the icon/button treatment and pause/stop state, both existing UI patterns.
- **Tier: Now.**

---

## Next

Meaningful UI or logic work, no backend risk, no open product questions.

#### 6. Duplicate-person detector
*Flags likely-duplicate records after a CSV import or a manual add.*

- **What it does:** After `ExportImport`'s CSV import or a manual person-add,
  a lightweight fuzzy check (same normalized name + birth year within ±1, or
  same name + shared parent) surfaces a non-blocking toast: *"This looks similar
  to an existing person — [View] [Ignore]."* Never auto-merges; always a
  suggestion the tree-builder acts on.
- **Value:** The CSV-import flow (`collect-form.js`) is exactly the path where
  duplicates happen — a relative fills the Google Form for themselves *and*
  their parent independently describes them in a separate submission, or two
  branches of an extended family both list the same shared great-aunt with
  slightly different spellings.
- **Fit:** A data-quality guardrail, not a feature that changes how the app
  feels — invisible until it's needed.
- **Effort:** M. The matching heuristic itself is simple string/date comparison
  (no external library — Levenshtein distance is ~15 lines to hand-roll); the
  UI is the bigger piece (a review list, not just a toast, once there are
  several candidates from one import batch).
- **Tier: Next.**

#### 7. Faceted search
*Search by place, occupation, or decade — not just name and story text.*

- **What it does:** Extends the existing header/People search (currently name +
  Hindi name + story body/tags via `searchStories`) with optional facet chips:
  *Born in [place]*, *Occupation contains [x]*, *Born in the [decade]*. Chips
  combine with the existing Living/Deceased soft filter rather than replacing it.
- **Value:** For a tree past ~100 people, "everyone born in Jaipur" or
  "everyone who was a teacher" is a genuinely useful genealogical query that
  free-text name search can't answer — and it's the kind of question a curious
  descendant actually asks when exploring, not just looking someone specific up.
- **Fit:** Extends an existing, already-loved feature (search) rather than
  bolting on a new one; no visual weight added when unused (chips collapse
  behind a "Filter" affordance).
- **Effort:** M. All data is already on the person record — this is UI + a
  filter-composition function, no schema change.
- **Tier: Next.**

#### 8. On-canvas relationship-path highlighting
*Select two tree nodes directly on the canvas and see the connecting path drawn as a route overlay, without opening the Find-a-relation modal.*

- **What it does:** A lightweight alternate interaction for the existing
  path-finder (`path-finder.js`, BFS over parent/child/spouse edges): shift-click
  (desktop) or a "Compare" mode toggle (touch) selects a second person on the
  tree itself, and the shortest path between the two lights up as a highlighted
  stroke along the actual SVG edges — the same visual language as lineage focus,
  but between two arbitrary people instead of one root's descendants.
- **Value:** The existing PathFinder modal is great when you already know both
  names; this variant is for the moment you're *looking at the tree* and
  wondering "how is she related to him?" without leaving the canvas to open a
  dialog and type two names into pickers.
- **Fit:** A second front door onto logic that already exists
  (`findRelationPath`) — no new relationship data, just a new way to trigger and
  render the same BFS result.
- **Effort:** M. The BFS and relation-label logic are already there; the new
  work is the on-canvas selection-mode UI and mapping the returned id chain onto
  `.t-edge` elements (the lineage-focus code already does exactly this kind of
  edge-id-set-to-class-toggle work in `applyHighlightClasses()`).
- **Tier: Next.**

#### 9. "On this day" browsing feed
*A calm, passive page of what happened on today's date across the tree's history — browse when you want, not pushed to you.*

- **What it does:** A simple view (or an inspector empty-state card, alongside
  the existing Family Highlights) listing everyone whose birthday or death
  anniversary falls on today's calendar date, across all years — *"On this day:
  Grandfather Ram was born in 1942 · Great-aunt Sita passed in 1998."* Distinct
  from ROADMAP P1's anniversary **notifications**, which are proactive,
  permission-gated, and push-based; this is a passive page with zero
  permissions, zero setup, available the moment there's any tree data.
- **Value:** For anyone opening the app on a quiet afternoon with no specific
  task, this gives the archive something to *say* rather than waiting to be
  interrogated. It's the calm, contemplative equivalent of a "what happened
  today in history" page, scoped to one's own family.
- **Fit:** Zero notification permission, zero opt-in friction, and it's exactly
  the kind of gentle daily ritual that fits a heritage app (contrast with a
  "streak" mechanic, explicitly rejected below).
- **Effort:** S/M. Reuses the date-matching logic already written for
  `upcomingAnniversaries()` (just match month+day against today with a 0-day
  window instead of a 30-day forward window) — mostly a new small view/card.
  **Worth sequencing before the P1 push-notification version** — it delivers
  most of the emotional value with none of the `Notification.requestPermission()`
  complexity, and can ship as a stepping stone toward it.
- **Tier: Next.**

#### 10. Generational statistics
*A small, factual dashboard: average lifespan, name trends, gender ratio, generation depth — derived entirely from data already on file.*

- **What it does:** A "Family in numbers" panel (Tools menu, or a People-view
  tab) showing things like: average lifespan across generations, most common
  first names (and how they recur across generations — a real genealogical
  pattern, naming a child after a grandparent), gender ratio, birthplace
  diversity, and oldest/youngest living member. Distinct from the existing
  Family Archive completion bar, which measures *data completeness* (%
  fields filled), not *demographic* facts about the people themselves.
- **Value:** Purely delightful, zero-setup insight for anyone exploring the
  tree — the kind of "huh, I didn't know that" moment that makes a family
  archive feel alive rather than administrative.
- **Fit:** Careful line to walk — this must read as *quiet observations*, not a
  scoreboard or achievement system. Framing matters: "3 generations have lived
  past 80" reads as heritage; a progress-bar-style "life expectancy score"
  would not. Keep it prose-and-numbers, no badges.
- **Effort:** M. All derived from existing fields (`birthDate`, `deathDate`,
  `name`, `gender`, `birthPlace`) with no new schema — this is aggregation logic
  plus a new (small) view.
- **Tier: Next.**

#### 11. Password-protected export
*An optional extra encryption layer on JSON exports, for the most sensitive trees.*

- **What it does:** A checkbox in the existing Export modal — *"Protect this
  file with a password"* — that runs the redacted JSON through
  `crypto.subtle` (Web Crypto API, AES-GCM, native to every modern browser) with
  a user-supplied passphrase before download. Import detects an encrypted file
  and prompts for the passphrase before parsing.
- **Value:** For a tree-builder emailing a backup to themselves, or handing a
  USB drive to a sibling, plaintext JSON with every relative's phone number,
  address, and (soon) private contact fields is a real exposure if the file
  ends up somewhere unintended (a shared Downloads folder, a cloud-synced
  email attachment). A password means the export file is safe even if the
  *delivery channel* isn't.
- **Fit:** Directly extends the existing privacy-flag system (`privatePhone` /
  `privateEmail` / `privateAddress`) with a second, complementary layer —
  "redact some fields" and "encrypt the whole file" solve different threats and
  compose well together.
- **Effort:** M. `crypto.subtle.encrypt`/`decrypt` with `PBKDF2` key derivation
  from the passphrase is well-trodden, dependency-free code (~60 lines). No
  new UI surface beyond one checkbox + one password prompt on import.
- **Tier: Next.**

#### 12. Privacy checkup wizard
*A guided, one-time sweep before sharing or exporting, instead of relying on the tree-builder to remember every per-field toggle.*

- **What it does:** Before a first Share invite, a first public PNG export, or
  printing the family book, an optional one-screen checklist: *"You have 4
  living relatives with phone numbers on file. Mark them private before
  sharing?"* with a bulk-apply action. Not a gate — dismissible, and remembers
  "don't ask again for this tree."
- **Value:** The per-field `privatePhone`/`privateEmail`/`privateAddress`
  toggles (and the cloud plan's proposed `story.private` / `notesPrivate` /
  `birthDatePrivacy`) are powerful but opt-in *per field, per person* — easy to
  forget on person #37 of 50 when inviting a distant cousin as a viewer for the
  first time.
- **Fit:** A safety net that respects the user's time rather than a mandatory
  interruption — the "calm, trustworthy" ethos applied to the moment where a
  mistake would actually matter (oversharing a living relative's phone number).
- **Effort:** M. No new privacy primitives — this is a UI flow that reads
  existing flags in bulk and offers a batch-set action. Naturally sequenced
  *after* the cloud plan's viewer-privacy fields land, since it should surface
  all of them, not just contact info.
- **Tier: Next.**

---

## Later

Real feature work — new visualizations or flows, non-trivial effort, no open
product-decision blocker.

#### 13. Tree merge tool
*Combine two independently-built family trees (or branches) into one.*

- **What it does:** A guided flow to import a second JSON export (or a second
  cloud tree) and merge it into the current one — matching likely-same people
  across the two files (reusing the fuzzy logic from idea #6), presenting
  conflicts side-by-side (*"Their tree says born 1954, yours says 1956 —
  keep which?"*), and producing one combined tree. Distinct from cloud sync's
  sharing model, which is one tree with multiple editors; this is two
  *separately created* trees becoming one.
- **Value:** A very real genealogy moment: two branches of an extended family
  each digitize their own side over the years, then a wedding, reunion, or this
  app's own growing popularity in the family surfaces both — and right now
  there's no way to combine them short of manual re-entry.
- **Fit:** Squarely a "preservation" feature — the alternative today is asking
  someone to throw away the work they already did.
- **Effort:** L. The matching/conflict UI is genuinely hard to get right (this
  is the crux of every real genealogy-merge product) and touches the same
  identity-resolution problem as GEDCOM import (ROADMAP P3) — worth scoping
  the two together, since a merge tool and a GEDCOM importer share most of
  their "is this the same person" logic.
- **Tier: Later.**

#### 14. Fan chart / pedigree view
*A radial ancestors-only chart — the other classic genealogy visualization, alongside the descendant-tree Virasat already has.*

- **What it does:** A new chart type (not a new top-nav tab necessarily — could
  live as a Tree-view mode toggle) centered on one person, with parents,
  grandparents, and further ancestors arranged in expanding rings/wedges
  outward. Distinct from ROADMAP P2's "detailed vs. compact tree" toggle, which
  prunes how much of the *existing descendant-tree shape* is shown — a fan chart
  is a fundamentally different layout (ancestors-only, radial, not
  generation-rows-top-to-bottom).
- **Value:** For the genealogically-minded tree-builder, a fan chart answers a
  different question than the main tree — "where did I come from" (ancestors
  converging on one person) rather than "who's in the family" (everyone,
  arranged by generation). It's one of the two charts every serious genealogy
  tool ships (alongside the standard descendant tree Virasat already has).
- **Fit:** A visualization variant, not a new feature category — same
  photo-first heritage node styling would carry over directly.
- **Effort:** L. The layout math (angle-per-generation, wedge sizing) is
  nontrivial but self-contained SVG geometry — same hand-rolled-no-library
  approach as the existing tree, **not** a reason to reach for D3 or a charting
  library. Real cost is in getting the radial label-placement and photo-ring
  sizing to feel as considered as the existing tree, not the math itself.
- **Tier: Later.**

#### 15. Low-bandwidth / data-saver mode
*Skip photo preloading and serve smaller thumbnails for relatives on slow or metered connections.*

- **What it does:** A toggle (auto-detected via `navigator.connection.saveData`
  where available, always manually overridable) that renders tree/people/timeline
  with initials instead of eagerly loading every photo, loading a given photo
  only on tap/click, and requesting a smaller cached size from
  `PhotoStore`/Supabase Storage where the original is large.
- **Value:** A different persona than the ones most features target: a distant
  cousin or elderly relative accessing a shared tree over rural mobile data,
  for whom a 50-person tree's worth of photos loading eagerly is genuinely slow
  and can burn through a limited data plan.
- **Fit:** Directly serves the "accessible to relatives everywhere, not just
  the tech-comfortable tree-builder" goal — arguably more inclusive than a
  purely cosmetic accessibility feature, since it's about *reach*, not just
  usability.
- **Effort:** M/L. The image pipeline already resizes to 512px on upload, so
  the win here is in *when* images load, not re-encoding — mostly a rendering
  strategy change (lazy `getUrl()` calls instead of eager ones) plus a settings
  toggle. Larger if it also means generating a second, smaller derivative per
  photo server-side.
- **Tier: Later.**

---

## Someday

Genuinely valuable, but either big enough to need its own design pass or close
enough to a product-values line that it needs an explicit decision first.

#### 16. Legacy contact / digital executor
*A designated trusted person who can inherit ownership of a tree if the original owner becomes unreachable.*

- **What it does:** Mirroring Apple's Legacy Contact / Google's Inactive
  Account Manager: the tree owner names one or more trusted people (by email,
  reusing the existing invite mechanism) as a **legacy contact**. If the owner's
  account goes inactive for a long, configurable period (a year+) *and* doesn't
  respond to periodic check-in emails, the legacy contact can request — and
  after a waiting period, receive — owner-level access, so the archive doesn't
  become permanently frozen (or effectively lost) if something happens to the
  person who was maintaining it.
- **Value:** This is *the* problem a family archive uniquely has and a normal
  SaaS app doesn't: the person most likely to have built and maintained the
  tree is, generationally, often among the older members of the family. A
  heritage app that can't survive its own maintainer isn't really a heritage
  app.
- **Fit:** As on-theme as it gets — directly named as a priority lens in this
  brainstorm's brief, and nothing about it smells like engagement-bait; it's
  the opposite, a feature that only matters in someone's absence.
- **Effort:** L, and **touches the live Supabase backend + email delivery + a
  delicate real-world edge case (proving/handling an owner's death or
  incapacity) — do not action without explicit user direction**, per this
  repo's standing convention for backend-touching items. Technically it's an
  inactivity timer (a scheduled check similar to the existing
  `keep-alive.yml` cron) plus an escalation email flow and a new RLS-safe
  ownership-transfer RPC — all buildable on the current Supabase setup, but the
  *policy* decisions (how long is "inactive," what counts as a valid claim,
  whether the original owner can be notified/reverse it) need product
  judgment before any schema work starts.
- **Tier: Someday.**

#### 17. Family Voices — story comments
*A narrow, opt-in way for other tree members to add their own memory of a story someone else wrote — deliberately not a comment section in the social-media sense.*

- **What it does:** Under an existing story ("Grandpa's Partition crossing"),
  a tree member with view/edit access can add a short, dated note of their own
  — *"He told me this the same way, but always added that they lost the family
  dog on the way. — Aunt Meera"* — appended below the original, attributed,
  never editable by anyone but its author. Explicitly **not** included: like
  buttons, reaction emoji, comment counts, "N people commented" badges, or any
  notification that nudges someone back to the app. It's an additive memory,
  not an engagement surface.
- **Value:** For a shared, multi-editor tree (the whole point of the cloud-sync
  work), a story is often incomplete from one person's memory alone — a
  sibling, spouse, or cousin frequently remembers a different detail. Today the
  only way to add that is editing the original story's body, which erases
  attribution of who remembered what.
- **Fit:** This is the one idea in this whole document that sits closest to
  "social feature" territory, which is exactly why it's tiered Someday and
  written with explicit guardrails rather than left implicit. It should ship
  **only** as an owner-controlled, per-tree opt-in setting, defaulting off, and
  the UI should read as "add to this memory" rather than "comment" — the label
  matters as much as the mechanism.
- **Effort:** M, but **needs an explicit product decision before any schema
  work**: this adds a new sub-record (comments on a story) to the cloud-sync
  data model that the `CLOUD-SYNC-PLAN.md` schema doesn't currently account
  for, and interacts with the still-deferred viewer-redaction question (should
  a viewer's comment be visible to other viewers, or only to editors?). Flag
  for the owner to decide the shape before scoping.
- **Tier: Someday.**

---

## Considered and deliberately rejected

Ideas that came up while brainstorming across the "collaboration" and
"discovery" lenses but were dropped for conflicting with Virasat's stated
ethos (calm, private, heritage-first — not a social network, not
engagement-farmed). Recorded here so they aren't re-proposed without this
context:

- **Activity feed / "recent updates" wall.** A scrolling feed of every edit
  across a shared tree reads as a social timeline, not an archive. The existing
  sync pip ("Saved" / "Saving…" / "Offline") already gives the *only* activity
  signal this app needs — that a sync happened, not a stream of what changed.
- **Likes / reactions on stories or photos.** Vanity metrics on family memories
  cheapen exactly the thing this app is trying to make feel weighty. Rejected
  outright, no exception.
- **Streaks / "come back and add a memory" nudges.** Gamified return-visit
  mechanics are the definition of engagement-bait. Contrast with the *On this
  day* idea above (#9) and ROADMAP P1's anniversary notifications — both are
  single-purpose, non-repeating, and opt-in; a streak counter is a different
  thing entirely and was rejected.
- **Public researcher-discovery / "connect with others researching this
  surname."** Genealogy sites like Ancestry build entire businesses on
  cross-tree discovery networks. Virasat's public/unlisted share link (ROADMAP
  P3) is a deliberately narrow, opt-in, read-only door for people the owner
  already chose — not a discovery mechanism for strangers. Keeping that
  distinction sharp was more important than the reach a discovery network
  might add.
- **In-app upsells for paid genealogy/DNA services.** Directly conflicts with
  the stated "no ads, no data-selling" value. Rejected outright.
- **AI chatbot personas / simulated conversations "as" a deceased relative.**
  Ethically fraught for a memorial context in a way the already-roadmapped,
  more modest "AI story generator" (P5 — drafts from real recorded facts,
  always opt-in, always user-edited before saving) isn't. The line is: AI may
  help organize or phrase what's *already true and recorded*; it shouldn't
  invent what a deceased person might have said.

---

## How this relates to `ROADMAP.md`

`ROADMAP.md` is the curated, priority-ranked plan — items there have been
through enough thinking to be sequenced (P1–P5) and are considered fair game to
just start building. This file is one step earlier: a wider net, not yet
weighed against each other or against the current backlog's capacity.

A few ideas above extend a ROADMAP item rather than duplicate it — each one says
so explicitly (Structured interview prompts → P1 voice memos; Unknown parent
marker → P2 relationship tags; "On this day" → P1 anniversary notifications;
Password-protected export → the existing per-field privacy flags; Privacy
checkup wizard → the cloud plan's proposed viewer-privacy fields; Tree merge →
P3's GEDCOM import). Where that's the case, scope them together rather than as
separate efforts.

Nothing here should be started without moving it into `ROADMAP.md` first (or at
minimum, flagging it to the owner) — per the standing rule, new ROADMAP items
aren't invented unilaterally.
