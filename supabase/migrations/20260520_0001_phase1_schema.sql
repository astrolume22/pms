-- =====================================================================
-- PMS Phase 1 — Schema (account, users, workspaces, workspace_members, activity_log)
-- Idempotent: safe to re-run.
-- =====================================================================

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- account (single-row tenant metadata)
-- ---------------------------------------------------------------------
create table if not exists public.account (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  gemini_api_key_encrypted text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- users — extends auth.users
-- The id MUST equal auth.users.id (FK enforced).
-- ---------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key,
  email text not null unique,
  username text not null unique,
  full_name text,
  avatar_url text,
  role text not null default 'manager' check (role in ('admin','manager','viewer')),
  status text not null default 'active' check (status in ('active','deactivated')),
  is_super_admin boolean not null default false,
  theme text not null default 'light' check (theme in ('light','dark')),
  timezone text not null default 'UTC',
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_id_fk_auth foreign key (id) references auth.users(id) on delete cascade
);

create index if not exists users_username_idx on public.users (username);
create index if not exists users_role_idx on public.users (role);
create index if not exists users_status_idx on public.users (status);

-- ---------------------------------------------------------------------
-- workspaces
-- ---------------------------------------------------------------------
create table if not exists public.workspaces (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  icon_emoji text not null default '🏠',
  icon_color text not null default '#0073EA',
  is_main boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ensure only one main workspace exists.
create unique index if not exists workspaces_only_one_main
  on public.workspaces ((is_main)) where is_main = true;

-- ---------------------------------------------------------------------
-- workspace_members
-- ---------------------------------------------------------------------
create table if not exists public.workspace_members (
  workspace_id uuid not null,
  user_id uuid not null,
  role text not null default 'member' check (role in ('owner','member','viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  constraint workspace_members_workspace_fk
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint workspace_members_user_fk
    foreign key (user_id) references public.users(id) on delete cascade
);

create index if not exists workspace_members_user_idx on public.workspace_members (user_id);

-- ---------------------------------------------------------------------
-- activity_log
-- ---------------------------------------------------------------------
create table if not exists public.activity_log (
  id uuid primary key default uuid_generate_v4(),
  actor_id uuid not null,
  action_type text not null,
  target_type text not null,
  target_id uuid,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now(),
  constraint activity_log_actor_fk
    foreign key (actor_id) references public.users(id) on delete cascade
);

create index if not exists activity_log_actor_idx on public.activity_log (actor_id);
create index if not exists activity_log_created_idx on public.activity_log (created_at desc);
create index if not exists activity_log_target_idx on public.activity_log (target_type, target_id);

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'account_updated_at') then
    create trigger account_updated_at before update on public.account
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'users_updated_at') then
    create trigger users_updated_at before update on public.users
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'workspaces_updated_at') then
    create trigger workspaces_updated_at before update on public.workspaces
      for each row execute function public.set_updated_at();
  end if;
end $$;
