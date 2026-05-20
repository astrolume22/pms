-- =====================================================================
-- PMS Phase 5 — Views (Main table / Kanban / Calendar) + AI runs log.
-- The "Main table" view comes for free with every board: every board
-- page falls back to a default table view if no `views` row exists.
-- =====================================================================

-- ---------------------------------------------------------------------
-- views — per-board named views
-- ---------------------------------------------------------------------
create table if not exists public.views (
  id uuid primary key default uuid_generate_v4(),
  board_id uuid not null,
  name text not null,
  type text not null check (type in ('table','kanban','calendar')),
  sort_order int not null default 0,
  is_default boolean not null default false,
  created_by uuid not null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint views_board_fk     foreign key (board_id)   references public.boards(id) on delete cascade,
  constraint views_created_by_fk foreign key (created_by) references public.users(id) on delete restrict
);

create index if not exists views_board_sort_idx
  on public.views (board_id, sort_order)
  where archived_at is null;

-- Exactly one default view per board (partial unique index).
create unique index if not exists views_one_default_per_board
  on public.views (board_id)
  where is_default = true and archived_at is null;

-- updated_at trigger reuses the shared set_updated_at function from Phase 1.
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'views_updated_at') then
    create trigger views_updated_at before update on public.views
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- ---------------------------------------------------------------------
-- ai_runs — every Gemini call gets logged
-- ---------------------------------------------------------------------
create table if not exists public.ai_runs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null,
  feature text not null check (feature in ('create_board','create_tasks','chat','suggest')),
  prompt text,
  response text,
  model text,
  tokens_input int,
  tokens_output int,
  target_type text,
  target_id uuid,
  status text not null default 'success' check (status in ('success','error','not_configured')),
  error_message text,
  ran_at timestamptz not null default now(),
  constraint ai_runs_user_fk foreign key (user_id) references public.users(id) on delete cascade
);

create index if not exists ai_runs_user_ran_idx on public.ai_runs (user_id, ran_at desc);

-- ---------------------------------------------------------------------
-- RLS — views
-- ---------------------------------------------------------------------
alter table public.views   enable row level security;
alter table public.ai_runs enable row level security;

do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in ('views', 'ai_runs')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Reads: anyone who can see the board can see its views.
create policy views_select on public.views for select
  to authenticated
  using (public.can_access_board(board_id));

-- Writes: board editors can add/update/delete views.  created_by is the
-- caller for accountability.
create policy views_insert on public.views for insert
  to authenticated
  with check (
    public.can_edit_board(board_id)
    and created_by = auth.uid()
  );

create policy views_update on public.views for update
  to authenticated
  using (public.can_edit_board(board_id))
  with check (public.can_edit_board(board_id));

create policy views_delete on public.views for delete
  to authenticated
  using (public.can_edit_board(board_id));

-- ai_runs — each user reads/writes only their own.
create policy ai_runs_select_own on public.ai_runs for select
  to authenticated
  using (user_id = auth.uid());

create policy ai_runs_insert_self on public.ai_runs for insert
  to authenticated
  with check (user_id = auth.uid() and public.is_active_user());

-- Grants
grant select, insert, update, delete on public.views   to authenticated;
grant select, insert                  on public.ai_runs to authenticated;
