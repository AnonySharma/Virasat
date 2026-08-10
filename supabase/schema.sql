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

-- — Private photo bucket (object key = <tree_id>/<photo_id>.jpg) ——————————
insert into storage.buckets (id,name,public) values ('tree-photos','tree-photos',false)
  on conflict (id) do nothing;
drop policy if exists photos_read on storage.objects;
create policy photos_read on storage.objects for select
  using (bucket_id='tree-photos' and public.is_tree_member((split_part(name,'/',1))::uuid));
drop policy if exists photos_insert on storage.objects;
create policy photos_insert on storage.objects for insert
  with check (bucket_id='tree-photos' and public.can_edit_tree((split_part(name,'/',1))::uuid));
drop policy if exists photos_update on storage.objects;
create policy photos_update on storage.objects for update
  using (bucket_id='tree-photos' and public.can_edit_tree((split_part(name,'/',1))::uuid));
drop policy if exists photos_delete on storage.objects;
create policy photos_delete on storage.objects for delete
  using (bucket_id='tree-photos' and public.can_edit_tree((split_part(name,'/',1))::uuid));
