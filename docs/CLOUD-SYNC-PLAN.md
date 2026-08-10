# Cloud Sync — Multi-user platform plan (Supabase + GitHub Pages)

> **Status:** Approved, not yet implemented. This branch (`feat/cloud-sync`) is the
> tracking point for the work. The pre-migration state is tagged **`pre-cloud-sync`**
> (`git reset --hard pre-cloud-sync` to return to it). This doc is the source of truth;
> it refines `ROADMAP.md` §P3.5 against the confirmed product decisions below.

## Context

Virasat today is a single-device, no-login PWA: the entire tree is one JSON blob in
`localStorage` behind `window.FamilyStore`, photos are blobs in IndexedDB behind
`window.PhotoStore`, and the only way to move data between devices/people is manual
JSON export/import. The goal: (1) **log in** so data follows you across devices with
**no manual export**, and (2) **share a tree by email** with **view or edit** access.

This adds auth + a cloud backend **without a build step** (the app is 18 ordered classic
`<script>` IIFEs served as static files — a deliberate "30-year heirloom" property). The
architecture is unusually ready: reads are synchronous over an in-memory snapshot, all
writes funnel through one `persist()` hook, and an existing cross-tab reload+conflict seam
maps directly onto a realtime subscription. `docs/ROADMAP.md` §P3.5 already scoped this and
independently chose **Supabase + GitHub Pages**.

### Product decisions (confirmed)
1. **Backend = Supabase** (Postgres + Auth + Storage + Realtime). Postgres row-level
   security (RLS) expresses the whole owner/editor/viewer + share model as declarative SQL —
   zero server code. SDK loads as a UMD `<script>`, preserving no-build.
2. **Sign-in = all three**: email+password, Google OAuth, magic-link.
3. **Cloud-only** (must sign in to use the app) — simplifies boot vs dual local/cloud. BUT
   preserve: (a) one-time import of the user's existing localStorage tree on first sign-in;
   (b) offline tolerance *after* login (session persists, edits replay on reconnect).
4. **Concurrency = last-writer-wins** on the whole-tree JSONB blob, guarded by an optimistic
   version check; on conflict, reload latest + warn (+ offer backup). No CRDT.

### Known MVP limitation
With whole-blob LWW, RLS hands the **entire `data` JSONB to every member including viewers**,
so per-field/photo privacy for viewers is **UI-only** in v1 (a determined viewer could read
hidden fields via DevTools). Proper enforcement = a `SECURITY DEFINER` RPC returning a
redacted blob for viewer-role callers — a clean **fast-follow**, not MVP. "View access" in v1
means: cannot edit (enforced server-side by RLS), sees a read-only UI.

---

## Architecture: how the seams change

**Reads stay synchronous.** The in-memory `state` snapshot remains the single source of truth
for all ~14 sync readers and ~5 subscribe-render callers. Nothing in the view layer becomes async.

**`data-store.js` — hydrate-able snapshot + split `persist()`:**
- Parse-time boot reads a **per-tree** localStorage cache (`familyTree.<treeId>.v1`) for an
  instant offline paint; empty state on a cold device. Reads never see `undefined`.
- `persist()` splits into three concerns, still **notifying listeners synchronously**:
  debounced local-cache write (offline) + `markDirty()` (flags the cloud pusher) + sync notify.
  `data-store.js` never imports the SDK.
- New methods (the only public-API additions): `hydrateFromRemote(data, version)` (validates
  like `replaceAll`, sets state + version, writes cache, `notifyAll()`, and does **not**
  `markDirty` — prevents a push→echo→hydrate loop), `setActiveTree(treeId)`, `getVersion()`,
  `getActiveTreeId()`.

**`app.js` — boot gate:** DOM/listener wiring stays synchronous; the mount+activate+sample-offer
block moves behind `Auth.ready().then(session => session ? bootWithSession() : SignIn.show())`.
`bootWithSession` resolves the active tree, `await`s the cloud load (hydrate), reveals the app,
mounts views post-hydrate (so first paint is data-complete), then `activate()`. A splash owns
the viewport during the async gap.

**Realtime repoints the existing cross-tab seam.** A Supabase channel on the active tree's row
replaces the `storage` event: on a remote UPDATE with a higher version, if we're clean →
`hydrateFromRemote`; if we're dirty → dispatch the **existing** `virasat:cross-tab-conflict`
event (reuses the app.js conflict banner verbatim). 60s polling fallback if the WebSocket is blocked.

**`photo-store.js` — cloud adapter, contract preserved:**
- `fileToPhotoId` keeps the IDB put (so `getUrlSync` works instantly + offline) **and** uploads
  to a private bucket at `<treeId>/<photoId>.jpg`.
- `getUrl` gains a middle step: IDB miss → `storage.download()` (bytes, RLS-checked via JWT) →
  repopulate IDB + urlCache → objectURL. All 8 render sites already do
  `getUrlSync()→null→getUrl()`, so remote trees paint initials first, then swap in photos —
  transparent. (**Fix `print-book.js`**: it uses `.then` not `await` before `window.print()` →
  prints blank photos on a cold remote tree. `image-export.js` already awaits.)
- IDB keyed by compound `<treeId>|<photoId>` (blobs stay isolated per tree; `person.photoId` in
  JSONB stays bare + portable). **On tree switch: revoke all urlCache objectURLs + clear**, and
  scope `clearAll` to the active tree's prefix.
- Extend the fire-and-forget delete idiom to also `storage.remove()` (best-effort, RLS-guarded).

**SDK loading (no build):** load the **UMD** `@supabase/supabase-js@2.x` from `cdn.jsdelivr.net`
as a classic `<script>` with SRI (`window.supabase.createClient`). Do **not** convert to
`type=module` (would defer + reorder all 18 scripts — large, risky, orthogonal). `flowType: 'pkce'`
so OAuth/magic-link return `?code=` in the query (not `#access_token` in the hash), leaving the
app's `#tree/#people/#timeline` hash router untouched.

**`sw.js`** (bump `CACHE_VERSION "v11"→"v12"`): add `cdn.jsdelivr.net` to `isCdnHost()` + the
pinned SDK URL to `CDN_SHELL` (so offline boot has the SDK — this is the real missing piece, not
a `.supabase.co` branch, which the cross-origin bail at line 120 already covers); add a defensive
explicit `.supabase.co` early-return; add the 6 new `lib/auth/*.js` files to `SHELL` (atomic
`addAll` — a typo fails install).

---

## New files (`lib/auth/`, ~1,200 LOC)
- `config.js` (~10) — `window.VirasatConfig = { supabaseUrl, supabaseAnonKey, bucket }` (anon key
  is public-safe; RLS is the enforcement point). App's first config object.
- `auth-store.js` (~250) — creates the client, `Auth.ready()`, sign-in (all 3 methods), sign-out,
  `onAuthChange`, calls `claim_invites` on every login.
- `cloud-store.js` (~350) — tree list/create/load, version-guarded push (debounced ~1.5s),
  Realtime channel + 60s polling fallback, offline dirty-flag + reconnect replay, local→cloud migration.
- `sign-in.js` (~200) — splash gate, sign-in screen, account/sign-out menu (built on `UI.el`/`openModal`).
- `tree-list.js` (~200) — tree switcher + create.
- `sharing.js` (~200) — invite-by-email dialog + member/role list.

## Existing edits (~200 LOC)
- `lib/core/data-store.js` (~60) — per-tree cache; split `persist()`; add `hydrateFromRemote`/
  `setActiveTree`/`getVersion`/`getActiveTreeId` + export them.
- `lib/core/photo-store.js` (~70) — upload in `fileToPhotoId`; download fallback in `getUrl`;
  remote delete; revoke cache on switch. **Flat IDB keys** (bare `photoId`), not compound
  `<treeId>|<photoId>` — see the Phase 3 note for why.
- `lib/app.js` (~50) — boot gate; move + gate `offerSampleData`/initial `activate` post-hydrate;
  `Inspector.clear()` on tree switch; account/share/tree entry points in header + phone kebab.
- `index.html` (~12) — SDK UMD + `config.js` + `auth/*.js` script tags (correct order); account/
  share buttons; `<meta name="robots" content="noindex">` (no public trees in MVP).
- `sw.js` (~15) — as above.
- `lib/core/i18n.js` (~40) — new `auth.*`, `share.*`, `tree.*`, `sync.*` keys (EN required, HI falls back).

---

## Phased plan (ordered so something demos early; ~13.5 dev days)

| Phase | Scope | Demo milestone | Days |
|---|---|---|---|
| **0. Supabase setup** | ✅ Project live (ref `kogchpccsphiecitwaav`); schema applied; email+password enabled | — | 0.5 |
| **1. Auth + gate** ✅ | UMD SDK (lazy, SRI) + `config.js` + `auth-store.js` + `sign-in.js`; app.js gate; SW SDK caching + v12; jali sign-in backdrop | Sign in 3 ways → gated empty app | 2 |
| **2. Cloud tree CRUD** ✅ | `cloud-store.js` load/push/version-guard; FamilyStore hydrate/version methods; persist() split; per-tree cache; account menu (avatar/email + sign-out) in header + phone kebab | Edits round-trip to a 2nd device; user can see who they are + sign out | 2 |
| **3. Photo cloud adapter** ✅ | upload on `fileToPhotoId`; download fallback in `getUrl`; flat keys + switch-revoke; remote delete; print `await` fix | Photos sync across devices | 1.5 |
| **4. Local→cloud migration** ✅ | satisfied by existing Import JSON: it `replaceAll`s the local tree into the active cloud tree, which then pushes. No dedicated migration script (per user: "no need to add migration scripts") | Returning local user keeps their tree | 1 |
| **5. Tree list + switcher** ✅ | `tree-list.js` (switch/create/rename/delete); `CloudStore.listTrees/createTree/switchTree/renameTree/deleteTree`; last-active tree persisted (`virasat.activeTreeId`); `Inspector.clear()` on switch; entry points in account menu + phone kebab; sample-CTA already cloud-gated | Multiple trees | 1.5 |
| **6. Sharing + roles** ✅ | `sharing.js` invite-by-email + member list; owner-checked `invite_to_tree`/`revoke_access` RPCs (double as role change); `claim_invites` on login (Phase 1); viewer role → `FamilyStore.setReadOnly` guard + `body.is-viewer` hides all `.js-edit-only` affordances. RLS is the server-side boundary | Share to 2nd account; viewer can't edit | 2 |
| **7. Realtime + offline** | channel → conflict seam; polling fallback; reconnect push | Near-live updates + offline replay | 1.5 |
| **8. Edges + polish** | PKCE redirect handling; conflict-backup UX; i18n; keep-alive verification; robots noindex | — | 1.5 |

Deferred from the roadmap's 17-day estimate (all post-MVP): public/unlisted share links, audit
log, server-side viewer redaction. First real demo lands end of Phase 1 (~day 2.5).

**Phase 1 shipped (commits `882a38b`, `dbb1a56`, `f04fbbd`), with two deliberate deferrals:**
- **Account menu / sign-out UI** — Phase 1 is auth+gate only; there is currently no in-app way
  to see who you're signed in as or sign out (only DevTools clears the session). `Auth.signOut()`
  and `Auth.getUser()` already exist; the header UI that calls them lands in **Phase 2**.
- **SDK loads lazily** (not a static UMD `<script>`) so a local-only user fetches zero bytes of
  it; cloud-off stays truly zero-network. Verified by `tests/auth-gate.mjs`.

**Phase 2 shipped (commits `11a19ea`, `7bb8c9f`, `d01d422`, `90acec8`):** cloud tree round-trip +
account menu.
- **What works:** on sign-in, `cloud-store.js` resolves the user's tree (owned → shared →
  create-empty), hydrates `FamilyStore` before first paint, and pushes every edit back with a
  debounced (~1.5 s) **version-guarded** UPDATE. A stale push (someone else advanced the row) hits
  the 0-row guard → fires the existing `virasat:cross-tab-conflict` banner → re-hydrates the server
  copy (last-writer-wins). `data-store.js` gained `hydrateFromRemote`/`setActiveTree`/`getVersion`/
  `setVersion`/`onDirty` + a per-tree cache key (`familyTree.<treeId>.v1`); **local-only mode is
  byte-identical to before** (all new state inert until `setActiveTree`/`onDirty` fire). Account
  chip (desktop) + kebab row (phone) show the signed-in email and sign out (flush → stop → signOut
  → reload).
- **Verified by** `tests/cloud-sync.mjs` (per-tree cache, dirty-under-mute, no-dirty-on-hydrate,
  sync cache write, throw-leaves-state-intact) + `tests/cloud-store.mjs` (resolve/hydrate against a
  mock Supabase client, clean push bumps version, stale push → conflict + re-hydrate without
  clobbering, stop() halts pushes). smoke now 22 scripts/22 globals.
- **Not yet verified in a live browser:** the Playwright/CDP path is blocked by a system-admin
  policy on this dev machine ("DevTools remote debugging is disallowed"), so the real device-to-
  device round-trip is covered by the mock-backed test + a manual localhost checklist, not an
  automated browser run. Needs the user (or a machine without that policy) to confirm.
- **Deliberate deferrals (later phases, not regressions):**
  - **Local→cloud migration** — a brand-new account gets an *empty* cloud tree; an existing
    `familyTree.v1` is **not** auto-uploaded yet. That's **Phase 4** (offer "Upload as new cloud
    tree"). Until then a returning local user who signs in starts fresh in the cloud (their local
    blob is untouched under `familyTree.v1`).
  - **Photos don't sync** — the JSONB blob carries `photoId` refs but the bytes still live only in
    this device's IndexedDB. That's **Phase 3** (upload on `fileToPhotoId` + download fallback).
  - **Realtime** — sync is load-on-boot + push-on-edit; a second device sees changes on its next
    load, not live. Realtime channel + polling fallback are **Phase 7**.
  - **Conflict backup UX** — on conflict we warn + reload (LWW); the "save my version as a backup
    JSON first" flow is **Phase 8** (`ExportImport` has no public one-call backup trigger yet).
  - **Sample-data auto-offer** is suppressed when a cloud tree is active (accepting it would push
    the fixed-id sample onto a possibly-shared tree); the manual rail tool is unaffected. Role-based
    gating is **Phase 6**.

**Phase 3 shipped:** photos sync across devices.
- **What works:** `fileToPhotoId` still stores the downscaled, EXIF-stripped JPEG in IndexedDB
  (instant + offline) **and** now uploads it in the background to the private bucket at
  `<treeId>/<photoId>.jpg` (`upsert:true`, fire-and-forget so the Save UX never waits on the
  network). `getUrl` gained a middle step: on an IDB miss it `storage.download()`s the bytes,
  repopulates IDB under the same id, then hands back an object URL — so a cold device that has the
  tree JSON but not its photos paints initials first, then swaps in the real photo, and every later
  read (and `getUrlSync`) is instant + offline. `delete` fires a best-effort `storage.remove()`
  alongside the local delete (covers person-delete + the edit-close reconcilers that clean up
  superseded/speculative blobs). On a cloud tree switch / sign-out, `CloudStore` calls
  `PhotoStore.resetCache()` to revoke the old tree's object URLs. `print-book.js` now `await`s all
  `getUrl()`s before `window.print()` (was `.then`, which snapshotted blank photos on a cold remote
  tree); `image-export.js` already awaited.
- **Flat IDB keys, NOT compound `<treeId>|<photoId>` (deliberate divergence from the plan):**
  `newPhotoId()` mints globally-unique ids, so cross-tree key collision is impossible and the
  compound key would guard nothing. Flat keys buy two real wins: (a) switching back to an
  already-visited tree repaints from the IDB cache **offline**, no re-download; (b) Phase 4
  migration keeps `photoId`s verbatim — no blob re-keying. The `treeId` lives only in the Storage
  object path (resolved fresh per call via `FamilyStore.getActiveTreeId()`), so `person.photoId` in
  the JSONB stays bare + portable. Cost: blobs from visited trees linger in IDB (~30 KB each) —
  storage hygiene, not a privacy or correctness issue (you already viewed them as a member);
  `clearAll()` still wipes everything, and `resetCache()` frees the in-memory URLs on switch.
- **All cloud calls are inert in local-only mode:** `cloudCtx()` returns null unless
  `Auth.isCloud()` **and** an active tree, so an offline PWA does zero uploads/downloads — the
  photo pipeline is byte-identical to before.
- **Verified by** `tests/photo-cloud.mjs` (cloud-off no-op; no-active-tree no-op; upload path +
  `upsert`/jpeg; download-fallback repopulates IDB + warms the sync cache; repeat read hits cache;
  double-miss → null → initials; `resetCache` revokes+clears; `delete` fires remote delete) against
  a mock Storage bucket + photo-store's built-in in-memory IDB fallback. smoke unchanged (22/22).
- **Deliberate deferrals:**
  - **LWW delete/edit race:** device A deletes a person (photo removed from bucket) while device B
    was offline-editing that person; B's later push re-surfaces the person, but the blob is gone →
    `getUrl` returns null → **initials**, never a broken `<img>`. Accepted LWW loss class.
  - **A failed background upload** leaves the photo in IDB (visible on this device) + referenced by
    the JSON, but not in the bucket; a later re-save of that person retries. No automatic
    upload-retry queue yet (would ride on the Phase 7 reconnect-replay work).
  - **No live-browser round-trip yet** — same CDP/system-policy block as Phase 2; covered by the
    mock-backed test + the manual localhost checklist, pending the user's end-to-end pass.

---

## Full SQL (paste-ready into Supabase SQL editor)

```sql
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists citext;     -- case-insensitive email

create table public.trees (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled family tree',
  family_name text not null default 'Family',
  schema_version int not null default 2,
  data jsonb not null default '{"version":2,"people":[],"marriages":{},"meta":{}}'::jsonb,
  version bigint not null default 1,          -- optimistic-lock counter
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.tree_members (
  tree_id uuid not null references public.trees(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','editor','viewer')),
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (tree_id, user_id)
);
create index tree_members_user_idx on public.tree_members(user_id);
create table public.tree_invites (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid not null references public.trees(id) on delete cascade,
  email citext not null,
  role text not null check (role in ('editor','viewer')),
  invited_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  unique (tree_id, email)
);
create index tree_invites_open_idx on public.tree_invites(email) where claimed_at is null;

-- SECURITY DEFINER helpers break the trees<->tree_members RLS recursion:
create or replace function public.is_tree_member(t uuid) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.tree_members m where m.tree_id=t and m.user_id=auth.uid()); $$;
create or replace function public.can_edit_tree(t uuid) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.tree_members m where m.tree_id=t and m.user_id=auth.uid()
                and m.role in ('owner','editor')); $$;
create or replace function public.is_tree_owner(t uuid) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.trees tr where tr.id=t and tr.owner_id=auth.uid()); $$;

alter table public.trees enable row level security;
alter table public.tree_members enable row level security;
alter table public.tree_invites enable row level security;

create policy trees_select on public.trees for select
  using (owner_id=auth.uid() or public.is_tree_member(id));
create policy trees_insert on public.trees for insert with check (owner_id=auth.uid());
create policy trees_update on public.trees for update
  using (public.can_edit_tree(id)) with check (public.can_edit_tree(id));
create policy trees_delete on public.trees for delete using (owner_id=auth.uid());

create policy members_select on public.tree_members for select using (public.is_tree_member(tree_id));
create policy members_write on public.tree_members for all
  using (public.is_tree_owner(tree_id)) with check (public.is_tree_owner(tree_id));

create policy invites_select on public.tree_invites for select
  using (public.is_tree_owner(tree_id) or email=auth.email());
create policy invites_write on public.tree_invites for all
  using (public.is_tree_owner(tree_id)) with check (public.is_tree_owner(tree_id));

-- Owner auto-added as member on tree create:
create or replace function public.on_tree_created() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.tree_members(tree_id,user_id,role,invited_by)
  values (new.id,new.owner_id,'owner',new.owner_id) on conflict do nothing;
  return new; end; $$;
create trigger trg_tree_created after insert on public.trees
  for each row execute function public.on_tree_created();

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end; $$;
create trigger trg_trees_touch before update on public.trees
  for each row execute function public.touch_updated_at();

-- The whole invite mechanism: called client-side on every login. Handles both
-- invited-before-signup and invited-after-signup with one atomic, idempotent path.
create or replace function public.claim_invites() returns int
  language plpgsql security definer set search_path = public as $$
declare claimed int;
begin
  with taken as (
    update public.tree_invites i set claimed_at=now()
    where i.email=auth.email() and i.claimed_at is null      -- citext ⇒ case-insensitive
    returning i.tree_id, i.role, i.invited_by)
  insert into public.tree_members(tree_id,user_id,role,invited_by)
  select t.tree_id, auth.uid(), t.role, t.invited_by from taken
  on conflict (tree_id,user_id) do nothing;
  get diagnostics claimed = row_count; return claimed; end; $$;

-- Owner-only sharing RPCs (Phase 6). SECURITY DEFINER so they can look a user
-- up by email in auth.users (the client can't) and write tree_members without
-- exposing user_ids. Both re-check ownership so a non-owner call is a no-op error.
-- invite_to_tree doubles as the role-change path: re-inviting an existing member
-- with a new role updates both the invite row and their live membership.
create or replace function public.invite_to_tree(p_tree uuid, p_email citext, p_role text)
  returns void language plpgsql security definer set search_path = public as $$
declare target uuid;
begin
  if not public.is_tree_owner(p_tree) then raise exception 'not tree owner'; end if;
  if p_role not in ('editor','viewer') then raise exception 'bad role'; end if;
  if lower(p_email) = lower(auth.email()) then raise exception 'cannot invite yourself'; end if;

  -- Record / update the invitation (the owner-readable member directory).
  insert into public.tree_invites(tree_id,email,role,invited_by)
  values (p_tree,p_email,p_role,auth.uid())
  on conflict (tree_id,email) do update set role=excluded.role;

  -- If that email already has an account, apply the role live. Mark the invite
  -- claimed so the directory shows them as active, not pending.
  select id into target from auth.users where lower(email)=lower(p_email) limit 1;
  if target is not null then
    insert into public.tree_members(tree_id,user_id,role,invited_by)
    values (p_tree,target,p_role,auth.uid())
    on conflict (tree_id,user_id) do update set role=excluded.role;
    update public.tree_invites set claimed_at=coalesce(claimed_at,now())
      where tree_id=p_tree and email=p_email;
  end if;
end; $$;

create or replace function public.revoke_access(p_tree uuid, p_email citext)
  returns void language plpgsql security definer set search_path = public as $$
declare target uuid;
begin
  if not public.is_tree_owner(p_tree) then raise exception 'not tree owner'; end if;
  delete from public.tree_invites where tree_id=p_tree and email=p_email;
  select id into target from auth.users where lower(email)=lower(p_email) limit 1;
  if target is not null then
    -- Never remove the owner's own membership via this path.
    delete from public.tree_members m
      where m.tree_id=p_tree and m.user_id=target and m.role <> 'owner';
  end if;
end; $$;

-- Private photo bucket; object key = <tree_id>/<photo_id>.jpg
insert into storage.buckets (id,name,public) values ('tree-photos','tree-photos',false)
  on conflict (id) do nothing;
create policy photos_read on storage.objects for select
  using (bucket_id='tree-photos' and public.is_tree_member((split_part(name,'/',1))::uuid));
create policy photos_insert on storage.objects for insert
  with check (bucket_id='tree-photos' and public.can_edit_tree((split_part(name,'/',1))::uuid));
create policy photos_update on storage.objects for update
  using (bucket_id='tree-photos' and public.can_edit_tree((split_part(name,'/',1))::uuid));
create policy photos_delete on storage.objects for delete
  using (bucket_id='tree-photos' and public.can_edit_tree((split_part(name,'/',1))::uuid));
```

**Version-guarded push (client, LWW):**
```js
const { data } = await supabase.from('trees')
  .update({ data: state, version: loadedVersion + 1 })
  .eq('id', treeId).eq('version', loadedVersion).select().single();
if (!data) { /* CONFLICT: fetch latest → hydrateFromRemote → fire virasat:cross-tab-conflict → warn + offer backup */ }
else loadedVersion = data.version;
```

---

## Free deployment ($0)

- **Frontend:** GitHub Pages (already there) — free HTTPS, auto-deploy on push, 100 GB/mo
  bandwidth (unreachable). Optional: custom domain (~$12/yr) as a trust signal; Cloudflare Pages
  is a 5-min alternative if you want edge CDN / PR previews.
- **Backend:** Supabase free tier — 500 MB Postgres (~thousands of ~30 KB trees), 1 GB Storage
  (~30k 512px JPEGs), 2 GB egress, 50k MAU, 2 active projects. No server to run.
- **The one real gotcha:** free projects **pause after ~7 days of no API activity** → next
  visitor eats a multi-second cold start (the boot splash covers it, but it's slow).
  **Mitigation:** a GitHub Actions scheduled workflow (cron ~every 3 days) that curls a trivial
  anon REST read (`GET /rest/v1/trees?select=id&limit=1`) to keep it warm. (pg_cron does *not*
  help — the pause is driven by external request inactivity.)

**Setup steps** — a filled-in, project-specific runbook lives in
[`docs/SUPABASE-SETUP.md`](./SUPABASE-SETUP.md). Summary:
1. ✅ Done — Project URL + anon key are in `lib/auth/config.js`
   (ref `kogchpccsphiecitwaav`).
2. SQL editor → run [`supabase/schema.sql`](../supabase/schema.sql). Confirm the
   `tree-photos` bucket is **private**.
3. Auth → Providers: enable Email (password), Email OTP/magic-link, Google. For Google: create an
   OAuth client in Google Cloud, authorized redirect URI
   `https://kogchpccsphiecitwaav.supabase.co/auth/v1/callback`, paste id/secret into Supabase.
4. Auth → URL Configuration: **Site URL** `https://anonysharma.github.io/Virasat/`;
   **Redirect URLs** `https://anonysharma.github.io/Virasat/**` + `http://localhost:8000/**` for dev.
5. Client uses `flowType:'pkce'`, `persistSession:true`, `autoRefreshToken:true` (already set in `auth-store.js`).
6. Add the GitHub Actions keep-alive cron (later).

---

## Risks / edge cases (with mitigations)
- **OAuth/magic-link hash collision** with the app's hash router → **`flowType:'pkce'`** (returns
  `?code=`, gets stripped; hash untouched). Boot auth before app.js reads the hash.
- **Two devices edit offline, both reconnect** → later push wins the whole blob; earlier push's
  version guard fails. **Mitigation:** on conflict, before reloading, offer "Save my version as
  backup JSON" (reuse `ExportImport.buildBackupState`) so offline work is never lost.
- **Sample-data CTA over a real/shared tree** — `offerSampleData` + `#tool-sample` both
  `replaceAll(SampleData.build())` with fixed ids. **Gate both** on `role==='owner' &&
  getPeople().length===0`; never on a tree you don't own.
- **Print/export blank photos on cold remote trees** → `await` all `getUrl()` before rendering.
- **IDB photo leak across trees** → compound `<treeId>|<photoId>` keys + revoke-on-switch; scope
  `clearAll` to active tree prefix.
- **Viewer privacy is UI-only in MVP** (whole-blob delivery) — documented; redaction RPC is fast-follow.
- **localStorage scoping** — MVP scopes only the state blob + `virasat.activeTreeId`; view prefs
  stay global (low harm), scoped per-tree as fast-follow. Theme/lang stay global.

---

## Verification (per phase, end-to-end)
- **Every JS-touching commit:** `node -c <file>` + `node tests/smoke.mjs` (must stay green:
  "smoke ok — 18 scripts…"; will need +6 for the new files) + `CACHE_VERSION` bump.
- **Phase 1 (auth):** sign in via each of the 3 methods in a real browser; confirm gated app +
  session survives reload + PWA relaunch; confirm PKCE leaves the hash router working.
- **Phase 2 (sync):** edit on device A → appears on device B (or two browser profiles); force a
  version conflict (edit both offline, reconnect) → conflict banner + backup offer.
- **Phase 3 (photos):** upload on A → renders on B after download; offline repaint from IDB;
  verify EXIF still stripped.
- **Phase 6 (sharing):** owner invites email of a 2nd account → that account sees the tree after
  login (test both invited-before-signup and after-signup); viewer's edit/add/delete are hidden
  AND a direct `update` is rejected by RLS (verify in the Supabase SQL logs / a manual
  `supabase.from('trees').update(...)` from the viewer's session returns 0 rows).
- **RLS smoke:** as a non-member, `select * from trees where id=<someone-elses>` returns 0 rows.
- **Deployment:** cold-start after >7 days idle (or pause the project manually) → confirm the
  keep-alive cron prevents it; confirm OAuth redirect works on the real `…/Virasat/` URL.
