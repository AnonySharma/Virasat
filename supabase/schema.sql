-- Virasat cloud schema — run once in the Supabase SQL editor.
--
--   Dashboard → SQL Editor → New query → paste this whole file → Run.
--
-- Creates: trees / tree_members / tree_invites tables, the RLS policies that
-- express the owner/editor/viewer share model, the SECURITY DEFINER helpers
-- that break RLS recursion, the owner-auto-member + updated_at triggers, the
-- claim_invites() RPC (share-by-email), and the private tree-photos bucket.
--
-- This file is hardened to be RE-RUNNABLE: every object uses
-- `if not exists` / `create or replace` / `drop ... if exists` so a partial
-- failure followed by a re-run is safe. It is functionally identical to the
-- canonical SQL in docs/CLOUD-SYNC-PLAN.md.
--
-- Anon key is public-safe (RLS is the boundary). NEVER expose service_role.

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists citext;     -- case-insensitive email

-- — Tables ————————————————————————————————————————————————————————————————
create table if not exists public.trees (
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
create table if not exists public.tree_members (
  tree_id uuid not null references public.trees(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','editor','viewer')),
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (tree_id, user_id)
);
create index if not exists tree_members_user_idx on public.tree_members(user_id);
create table if not exists public.tree_invites (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid not null references public.trees(id) on delete cascade,
  email citext not null,
  role text not null check (role in ('editor','viewer')),
  invited_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  unique (tree_id, email)
);
create index if not exists tree_invites_open_idx on public.tree_invites(email) where claimed_at is null;

-- — SECURITY DEFINER helpers (break the trees<->tree_members RLS recursion) —
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

-- — Row-level security ————————————————————————————————————————————————————
alter table public.trees enable row level security;
alter table public.tree_members enable row level security;
alter table public.tree_invites enable row level security;

drop policy if exists trees_select on public.trees;
create policy trees_select on public.trees for select
  using (owner_id=auth.uid() or public.is_tree_member(id));
drop policy if exists trees_insert on public.trees;
create policy trees_insert on public.trees for insert with check (owner_id=auth.uid());
drop policy if exists trees_update on public.trees;
create policy trees_update on public.trees for update
  using (public.can_edit_tree(id)) with check (public.can_edit_tree(id));
drop policy if exists trees_delete on public.trees;
create policy trees_delete on public.trees for delete using (owner_id=auth.uid());

drop policy if exists members_select on public.tree_members;
create policy members_select on public.tree_members for select using (public.is_tree_member(tree_id));
drop policy if exists members_write on public.tree_members;
create policy members_write on public.tree_members for all
  using (public.is_tree_owner(tree_id)) with check (public.is_tree_owner(tree_id));

drop policy if exists invites_select on public.tree_invites;
create policy invites_select on public.tree_invites for select
  using (public.is_tree_owner(tree_id) or email=auth.email());
drop policy if exists invites_write on public.tree_invites;
create policy invites_write on public.tree_invites for all
  using (public.is_tree_owner(tree_id)) with check (public.is_tree_owner(tree_id));

-- — Triggers ——————————————————————————————————————————————————————————————
-- Owner auto-added as member on tree create:
create or replace function public.on_tree_created() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.tree_members(tree_id,user_id,role,invited_by)
  values (new.id,new.owner_id,'owner',new.owner_id) on conflict do nothing;
  return new; end; $$;
drop trigger if exists trg_tree_created on public.trees;
create trigger trg_tree_created after insert on public.trees
  for each row execute function public.on_tree_created();

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end; $$;
drop trigger if exists trg_trees_touch on public.trees;
create trigger trg_trees_touch before update on public.trees
  for each row execute function public.touch_updated_at();

-- — Share-by-email RPC ————————————————————————————————————————————————————
-- Called client-side on every login. Handles both invited-before-signup and
-- invited-after-signup with one atomic, idempotent path.
create or replace function public.claim_invites() returns int
  language plpgsql security definer set search_path = public as $$
declare claimed int;
begin
  with taken as (
    update public.tree_invites i set claimed_at=now()
    where i.email=auth.email() and i.claimed_at is null      -- citext => case-insensitive
    returning i.tree_id, i.role, i.invited_by)
  insert into public.tree_members(tree_id,user_id,role,invited_by)
  select t.tree_id, auth.uid(), t.role, t.invited_by from taken
  on conflict (tree_id,user_id) do nothing;
  get diagnostics claimed = row_count; return claimed; end; $$;

-- — Owner-only sharing RPCs ————————————————————————————————————————————————
-- SECURITY DEFINER so they can look a user up by email in auth.users (the
-- client can't) and write tree_members without exposing user_ids. Both
-- re-check ownership so a non-owner call is a no-op error. invite_to_tree
-- doubles as the role-change path: re-inviting an existing member with a new
-- role updates both the invite row and their live membership.
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

-- — Self-service leave (owner-independent) ————————————————————————————————
-- The counterpart to the owner's revoke_access: lets a shared-in member remove
-- THEMSELVES. Caller-scoped (auth.uid()/auth.email()), so no ownership check —
-- but an owner is refused (they must delete or transfer the tree, not orphan
-- it). Also clears any lingering invite row for their email so leaving sticks
-- (the directory won't show them as pending) until the owner re-invites.
-- Idempotent: leaving a tree you're not in simply deletes zero rows.
create or replace function public.leave_tree(p_tree uuid)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if public.is_tree_owner(p_tree) then raise exception 'owner cannot leave own tree'; end if;
  delete from public.tree_members m where m.tree_id=p_tree and m.user_id=auth.uid();
  delete from public.tree_invites i where i.tree_id=p_tree and i.email=auth.email();
end; $$;

-- — Viewer field redaction (fast-follow; defined now, NOT yet wired) ————————
-- The app lets an owner mark a person's phone / email / address "private". In
-- the UI those fields are already hidden from view-only members (inspector.js
-- renders a locked placeholder). But with whole-blob delivery the RAW data
-- jsonb still reaches a viewer's client via both the trees_select policy and
-- the realtime channel, so a determined viewer can read the value in DevTools.
--
-- get_tree() is the server-side enforcement: a SECURITY DEFINER RPC that hands
-- editors the full blob but strips private contact fields for viewers, so the
-- value never leaves Postgres. It's defined here so the SQL is ready, but it is
-- deliberately NOT wired client-side yet: closing the leak fully also means
-- routing the viewer's INITIAL load AND the realtime updates through this RPC
-- (a raw row must never hit a viewer), which is the realtime/boot-gate rework
-- the cloud plan scoped as one coherent fast-follow. Defining it now is inert
-- (nothing calls it) and idempotent.
create or replace function public.redact_contact(c jsonb) returns jsonb
  language plpgsql immutable set search_path = public as $$
begin
  if c is null then return c; end if;
  if coalesce((c->>'privatePhone')::boolean, false)   then c := c - 'phone';   end if;
  if coalesce((c->>'privateEmail')::boolean, false)   then c := c - 'email';   end if;
  if coalesce((c->>'privateAddress')::boolean, false) then c := c - 'address'; end if;
  return c;
end; $$;

create or replace function public.redact_person(p jsonb) returns jsonb
  language sql immutable set search_path = public as $$
  select case when p ? 'contact'
    then jsonb_set(p, '{contact}', public.redact_contact(p->'contact'))
    else p end; $$;

create or replace function public.get_tree(p_tree uuid) returns jsonb
  language plpgsql security definer stable set search_path = public as $$
declare d jsonb; ppl jsonb;
begin
  if not public.is_tree_member(p_tree) then raise exception 'not a tree member'; end if;
  select data into d from public.trees where id = p_tree;
  if d is null then return null; end if;
  if public.can_edit_tree(p_tree) then return d; end if;   -- owner/editor: full blob
  -- viewer: strip private contact fields on every person before returning.
  -- WITH ORDINALITY + ORDER BY keeps the people array in its original order.
  select jsonb_agg(public.redact_person(elem) order by ord) into ppl
    from jsonb_array_elements(coalesce(d->'people', '[]'::jsonb)) with ordinality as t(elem, ord);
  return jsonb_set(d, '{people}', coalesce(ppl, '[]'::jsonb));
end; $$;

-- — Unlisted share links (anyone-with-the-link, no sign-in) ————————————————
-- A tree can be shared read-only via an unguessable link that needs no account.
-- Two new columns on trees:
--   visibility   'private' (default) | 'unlisted'. Deliberately NO 'public':
--                the app promises "no public pages", so a shared tree is
--                unlisted (noindex, unguessable), never listed/indexed.
--   share_token  a random uuid that is the link's secret. The tree id alone is
--                NOT enough to read the data — the token must match.
-- Idempotent: add-column-if-not-exists guards a re-run.
alter table public.trees
  add column if not exists visibility text not null default 'private';
-- Constraint added separately so a re-run on a table that already has the
-- column still installs it (add-column's inline check is skipped on re-run).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'trees_visibility_chk'
  ) then
    alter table public.trees
      add constraint trees_visibility_chk check (visibility in ('private','unlisted'));
  end if;
end $$;
alter table public.trees
  add column if not exists share_token uuid;

-- The ANON read path: callable with just the public anon key (RLS/ownership is
-- NOT the gate here — the token is). Returns null on any miss (unknown tree,
-- not shared, or wrong token) so it never reveals whether a tree exists. On a
-- hit it returns the REDACTED blob (private phone/email/address stripped via the
-- same redact_person the viewer branch of get_tree uses — so a link viewer sees
-- exactly what a signed-in viewer would, enforced in Postgres, not the client)
-- plus the title/family_name/version the client needs to hydrate + label.
create or replace function public.get_shared_tree(p_tree uuid, p_token uuid)
  returns jsonb language plpgsql security definer stable set search_path = public as $$
declare tr public.trees; ppl jsonb;
begin
  select * into tr from public.trees where id = p_tree;
  if tr.id is null then return null; end if;                 -- unknown tree
  if tr.visibility <> 'unlisted' then return null; end if;   -- not shared
  if tr.share_token is null or p_token is null or tr.share_token <> p_token then
    return null;                                             -- wrong / absent token
  end if;
  select jsonb_agg(public.redact_person(elem) order by ord) into ppl
    from jsonb_array_elements(coalesce(tr.data->'people','[]'::jsonb)) with ordinality as t(elem, ord);
  return jsonb_build_object(
    'data',        jsonb_set(tr.data, '{people}', coalesce(ppl, '[]'::jsonb)),
    'version',     tr.version,
    'title',       tr.title,
    'family_name', tr.family_name
  );
end; $$;
grant execute on function public.get_shared_tree(uuid, uuid) to anon, authenticated;

-- Owner-only: turn the link on/off. On → visibility 'unlisted' and mint a token
-- if there isn't one (so toggling off then on again keeps the SAME link). Off →
-- visibility 'private' (the read RPC + the shared-photo policy both gate on
-- 'unlisted', so the link — and photo access — die immediately). Returns the
-- resulting { visibility, share_token } so the client can build the URL without
-- a follow-up read.
create or replace function public.set_tree_share(p_tree uuid, p_on boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare tok uuid; vis text;
begin
  if not public.is_tree_owner(p_tree) then raise exception 'not tree owner'; end if;
  if p_on then
    update public.trees
      set visibility = 'unlisted',
          share_token = coalesce(share_token, gen_random_uuid())
      where id = p_tree returning share_token, visibility into tok, vis;
  else
    update public.trees set visibility = 'private'
      where id = p_tree returning share_token, visibility into tok, vis;
  end if;
  return jsonb_build_object('visibility', vis, 'share_token', tok);
end; $$;

-- Owner-only: mint a fresh token (invalidates the old link immediately) and
-- ensure the tree is shared. The "I leaked the link — kill it" escape hatch.
create or replace function public.rotate_share_token(p_tree uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare tok uuid; vis text;
begin
  if not public.is_tree_owner(p_tree) then raise exception 'not tree owner'; end if;
  update public.trees
    set share_token = gen_random_uuid(), visibility = 'unlisted'
    where id = p_tree returning share_token, visibility into tok, vis;
  return jsonb_build_object('visibility', vis, 'share_token', tok);
end; $$;

-- — Private photo bucket (object key = <tree_id>/<photo_id>.jpg) ——————————
insert into storage.buckets (id,name,public) values ('tree-photos','tree-photos',false)
  on conflict (id) do nothing;
drop policy if exists photos_read on storage.objects;
create policy photos_read on storage.objects for select
  using (bucket_id='tree-photos' and public.is_tree_member((split_part(name,'/',1))::uuid));
-- Anon read for photos of an UNLISTED tree. A Storage GET can't carry the share
-- token, so the secret here is the object path itself: both the tree id (first
-- segment) and the photo id are unguessable randoms, and access is gated on the
-- tree still being 'unlisted' — flip the link off and this policy stops matching
-- immediately. SECURITY DEFINER helper mirrors is_tree_member so the recursion
-- break is consistent. Additive (permissive) — it only widens read, members are
-- still covered by photos_read above.
create or replace function public.is_tree_shared(t uuid) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.trees tr where tr.id=t and tr.visibility='unlisted'); $$;
drop policy if exists photos_read_shared on storage.objects;
create policy photos_read_shared on storage.objects for select
  using (bucket_id='tree-photos' and public.is_tree_shared((split_part(name,'/',1))::uuid));
drop policy if exists photos_insert on storage.objects;
create policy photos_insert on storage.objects for insert
  with check (bucket_id='tree-photos' and public.can_edit_tree((split_part(name,'/',1))::uuid));
drop policy if exists photos_update on storage.objects;
create policy photos_update on storage.objects for update
  using (bucket_id='tree-photos' and public.can_edit_tree((split_part(name,'/',1))::uuid));
drop policy if exists photos_delete on storage.objects;
create policy photos_delete on storage.objects for delete
  using (bucket_id='tree-photos' and public.can_edit_tree((split_part(name,'/',1))::uuid));

-- — Realtime ———————————————————————————————————————————————————————————————
-- cloud-store subscribes a channel to the active tree's row so another
-- device's push arrives near-live. postgres_changes only fires for tables in
-- the supabase_realtime publication. RLS still applies to realtime events, so
-- a client only receives changes for rows its SELECT policy lets it see — no
-- cross-tree leakage. (The client also runs a 60s poll fallback, so this is a
-- latency upgrade, not a correctness requirement.) Guarded so a re-run is safe:
-- `add table` errors if the table is already a publication member.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='trees'
  ) then
    alter publication supabase_realtime add table public.trees;
  end if;
end $$;
