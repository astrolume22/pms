-- =====================================================================
-- PMS Phase 2 — Boards / Subscribers / Favorites / Last-viewed / Groups
--              / Columns / Column labels
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- boards
-- ---------------------------------------------------------------------
create table if not exists public.boards (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null,
  name text not null,
  description text,
  icon_emoji text not null default '📋',
  board_type text not null default 'main' check (board_type in ('main','private')),
  owner_id uuid not null,
  created_by uuid not null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  constraint boards_workspace_fk
    foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint boards_owner_fk
    foreign key (owner_id) references public.users(id) on delete restrict,
  constraint boards_created_by_fk
    foreign key (created_by) references public.users(id) on delete restrict
);

create index if not exists boards_workspace_idx       on public.boards (workspace_id);
create index if not exists boards_owner_idx           on public.boards (owner_id);
create index if not exists boards_created_by_idx      on public.boards (created_by);
create index if not exists boards_active_idx          on public.boards (workspace_id) where archived_at is null and deleted_at is null;
create index if not exists boards_updated_at_desc_idx on public.boards (updated_at desc);

-- ---------------------------------------------------------------------
-- board_subscribers
-- ---------------------------------------------------------------------
create table if not exists public.board_subscribers (
  board_id uuid not null,
  user_id uuid not null,
  role text not null default 'member' check (role in ('owner','member','viewer')),
  notification_level text not null default 'everything' check (notification_level in ('everything','replies_mentions','nothing')),
  subscribed_at timestamptz not null default now(),
  primary key (board_id, user_id),
  constraint board_subscribers_board_fk
    foreign key (board_id) references public.boards(id) on delete cascade,
  constraint board_subscribers_user_fk
    foreign key (user_id) references public.users(id) on delete cascade
);

create index if not exists board_subscribers_user_idx on public.board_subscribers (user_id);

-- ---------------------------------------------------------------------
-- board_favorites
-- ---------------------------------------------------------------------
create table if not exists public.board_favorites (
  user_id uuid not null,
  board_id uuid not null,
  favorited_at timestamptz not null default now(),
  primary key (user_id, board_id),
  constraint board_favorites_user_fk
    foreign key (user_id) references public.users(id) on delete cascade,
  constraint board_favorites_board_fk
    foreign key (board_id) references public.boards(id) on delete cascade
);

create index if not exists board_favorites_board_idx on public.board_favorites (board_id);

-- ---------------------------------------------------------------------
-- board_last_viewed
-- ---------------------------------------------------------------------
create table if not exists public.board_last_viewed (
  board_id uuid not null,
  user_id uuid not null,
  last_viewed_at timestamptz not null default now(),
  primary key (board_id, user_id),
  constraint board_last_viewed_board_fk
    foreign key (board_id) references public.boards(id) on delete cascade,
  constraint board_last_viewed_user_fk
    foreign key (user_id) references public.users(id) on delete cascade
);

create index if not exists board_last_viewed_user_idx on public.board_last_viewed (user_id, last_viewed_at desc);

-- ---------------------------------------------------------------------
-- groups
-- ---------------------------------------------------------------------
create table if not exists public.groups (
  id uuid primary key default uuid_generate_v4(),
  board_id uuid not null,
  name text not null,
  color text not null default '#579BFC',
  sort_order int not null default 0,
  is_collapsed_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  constraint groups_board_fk
    foreign key (board_id) references public.boards(id) on delete cascade
);

create index if not exists groups_board_sort_idx on public.groups (board_id, sort_order);

-- ---------------------------------------------------------------------
-- columns
-- ---------------------------------------------------------------------
-- column_type is constrained to the 10 V1 column types from the spec.
create table if not exists public.columns (
  id uuid primary key default uuid_generate_v4(),
  board_id uuid not null,
  name text not null,
  column_type text not null check (column_type in (
    'task_name','text','status','people','date','priority',
    'numbers','checkbox','dropdown','link'
  )),
  sort_order int not null default 0,
  width int not null default 180,
  is_required boolean not null default false,
  is_pinned_left boolean not null default false,
  is_pinned_right boolean not null default false,
  default_value jsonb,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint columns_board_fk
    foreign key (board_id) references public.boards(id) on delete cascade
);

-- Exactly one task_name column per board (enforced as a partial unique index).
create unique index if not exists columns_one_task_name_per_board
  on public.columns (board_id) where column_type = 'task_name' and archived_at is null;

create index if not exists columns_board_sort_idx on public.columns (board_id, sort_order);

-- ---------------------------------------------------------------------
-- column_labels (used by status / priority / dropdown columns)
-- ---------------------------------------------------------------------
create table if not exists public.column_labels (
  id uuid primary key default uuid_generate_v4(),
  column_id uuid not null,
  name text not null,
  color text not null default '#C4C4C4',
  sort_order int not null default 0,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  constraint column_labels_column_fk
    foreign key (column_id) references public.columns(id) on delete cascade
);

create index if not exists column_labels_column_sort_idx on public.column_labels (column_id, sort_order);

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'boards_updated_at') then
    create trigger boards_updated_at before update on public.boards
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'groups_updated_at') then
    create trigger groups_updated_at before update on public.groups
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'columns_updated_at') then
    create trigger columns_updated_at before update on public.columns
      for each row execute function public.set_updated_at();
  end if;
end $$;
