-- =====================================================================
-- PMS Phase 2 — RLS helper functions + policies
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helper: can the current user see this board?
--   admin                              → always
--   board owner / creator              → always
--   subscriber                         → always
--   main board + active workspace mem  → yes
--   else                               → no
-- Viewer role can only see boards they are subscribed to (so the main-
-- board branch only fires when the user's role is admin or manager).
-- ---------------------------------------------------------------------
create or replace function public.can_access_board(_board_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  with me as (
    select id, role, status, is_super_admin from public.users where id = auth.uid()
  ),
  b as (
    select id, workspace_id, owner_id, created_by, board_type
    from public.boards where id = _board_id and deleted_at is null
  )
  select
    coalesce((select status = 'active' from me), false)
    and exists(select 1 from b)
    and (
      (select role = 'admin' or is_super_admin from me)
      or exists (
        select 1 from public.board_subscribers
        where board_id = _board_id and user_id = (select id from me)
      )
      or (select owner_id from b) = (select id from me)
      or (select created_by from b) = (select id from me)
      or (
        (select board_type from b) = 'main'
        and (select role from me) in ('admin','manager')
        and exists (
          select 1 from public.workspace_members
          where workspace_id = (select workspace_id from b)
            and user_id = (select id from me)
        )
      )
    );
$$;

-- ---------------------------------------------------------------------
-- Helper: can the current user edit content on this board?
--   admin / super_admin                → yes
--   subscriber with role owner/member  → yes
--   board owner                        → yes
--   else                               → no
-- ---------------------------------------------------------------------
create or replace function public.can_edit_board(_board_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  with me as (
    select id, role, status, is_super_admin from public.users where id = auth.uid()
  )
  select
    coalesce((select status = 'active' from me), false)
    and exists (
      select 1 from public.boards where id = _board_id and deleted_at is null
    )
    and (
      (select role = 'admin' or is_super_admin from me)
      or exists (
        select 1 from public.boards
        where id = _board_id and owner_id = (select id from me)
      )
      or exists (
        select 1 from public.board_subscribers
        where board_id = _board_id and user_id = (select id from me)
          and role in ('owner','member')
      )
    );
$$;

-- ---------------------------------------------------------------------
-- Helper: can the current user *manage* the board (archive / delete /
-- rename / change type)?  Owner or admin only.
-- ---------------------------------------------------------------------
create or replace function public.can_manage_board(_board_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  with me as (
    select id, role, status, is_super_admin from public.users where id = auth.uid()
  )
  select
    coalesce((select status = 'active' from me), false)
    and (
      (select role = 'admin' or is_super_admin from me)
      or exists (
        select 1 from public.boards
        where id = _board_id and owner_id = (select id from me)
      )
    );
$$;

revoke all on function public.can_access_board(uuid) from public;
revoke all on function public.can_edit_board(uuid)   from public;
revoke all on function public.can_manage_board(uuid) from public;
grant execute on function public.can_access_board(uuid) to authenticated;
grant execute on function public.can_edit_board(uuid)   to authenticated;
grant execute on function public.can_manage_board(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------
alter table public.boards            enable row level security;
alter table public.board_subscribers enable row level security;
alter table public.board_favorites   enable row level security;
alter table public.board_last_viewed enable row level security;
alter table public.groups            enable row level security;
alter table public.columns           enable row level security;
alter table public.column_labels     enable row level security;

-- ---------------------------------------------------------------------
-- Reset existing policies (idempotent re-run)
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in (
        'boards','board_subscribers','board_favorites','board_last_viewed',
        'groups','columns','column_labels'
      )
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- boards
-- ---------------------------------------------------------------------
create policy boards_select_accessible on public.boards for select
  to authenticated
  using (deleted_at is null and public.can_access_board(id));

-- Admins or managers can create boards; viewers cannot.
create policy boards_insert_admin_manager on public.boards for insert
  to authenticated
  with check (
    public.is_active_user()
    and public.current_user_role() in ('admin','manager')
    and created_by = auth.uid()
  );

-- Admins or owners can update boards (rename, change icon, etc.).
-- The can_manage_board helper covers archive/delete/type changes too.
create policy boards_update_manager on public.boards for update
  to authenticated
  using (public.can_manage_board(id))
  with check (public.can_manage_board(id));

create policy boards_delete_manager on public.boards for delete
  to authenticated
  using (public.can_manage_board(id));

-- ---------------------------------------------------------------------
-- board_subscribers
-- ---------------------------------------------------------------------
create policy board_subscribers_select on public.board_subscribers for select
  to authenticated
  using (public.can_access_board(board_id));

create policy board_subscribers_insert on public.board_subscribers for insert
  to authenticated
  with check (public.can_manage_board(board_id));

create policy board_subscribers_update on public.board_subscribers for update
  to authenticated
  using (public.can_manage_board(board_id))
  with check (public.can_manage_board(board_id));

create policy board_subscribers_delete on public.board_subscribers for delete
  to authenticated
  using (public.can_manage_board(board_id));

-- ---------------------------------------------------------------------
-- board_favorites (each user manages their own row)
-- ---------------------------------------------------------------------
create policy board_favorites_select_own on public.board_favorites for select
  to authenticated
  using (user_id = auth.uid());

create policy board_favorites_insert_own on public.board_favorites for insert
  to authenticated
  with check (user_id = auth.uid() and public.can_access_board(board_id));

create policy board_favorites_delete_own on public.board_favorites for delete
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- board_last_viewed (each user manages their own row)
-- ---------------------------------------------------------------------
create policy board_last_viewed_select_own on public.board_last_viewed for select
  to authenticated
  using (user_id = auth.uid());

create policy board_last_viewed_upsert_own on public.board_last_viewed for insert
  to authenticated
  with check (user_id = auth.uid() and public.can_access_board(board_id));

create policy board_last_viewed_update_own on public.board_last_viewed for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy board_last_viewed_delete_own on public.board_last_viewed for delete
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- groups
-- ---------------------------------------------------------------------
create policy groups_select on public.groups for select
  to authenticated
  using (public.can_access_board(board_id));

create policy groups_insert on public.groups for insert
  to authenticated
  with check (public.can_edit_board(board_id));

create policy groups_update on public.groups for update
  to authenticated
  using (public.can_edit_board(board_id))
  with check (public.can_edit_board(board_id));

create policy groups_delete on public.groups for delete
  to authenticated
  using (public.can_edit_board(board_id));

-- ---------------------------------------------------------------------
-- columns
-- ---------------------------------------------------------------------
create policy columns_select on public.columns for select
  to authenticated
  using (public.can_access_board(board_id));

create policy columns_insert on public.columns for insert
  to authenticated
  with check (public.can_edit_board(board_id));

create policy columns_update on public.columns for update
  to authenticated
  using (public.can_edit_board(board_id))
  with check (public.can_edit_board(board_id));

create policy columns_delete on public.columns for delete
  to authenticated
  using (public.can_edit_board(board_id));

-- ---------------------------------------------------------------------
-- column_labels — gated through the parent column's board
-- ---------------------------------------------------------------------
create policy column_labels_select on public.column_labels for select
  to authenticated
  using (
    exists (
      select 1 from public.columns c
      where c.id = column_id and public.can_access_board(c.board_id)
    )
  );

create policy column_labels_insert on public.column_labels for insert
  to authenticated
  with check (
    exists (
      select 1 from public.columns c
      where c.id = column_id and public.can_edit_board(c.board_id)
    )
  );

create policy column_labels_update on public.column_labels for update
  to authenticated
  using (
    exists (
      select 1 from public.columns c
      where c.id = column_id and public.can_edit_board(c.board_id)
    )
  )
  with check (
    exists (
      select 1 from public.columns c
      where c.id = column_id and public.can_edit_board(c.board_id)
    )
  );

create policy column_labels_delete on public.column_labels for delete
  to authenticated
  using (
    exists (
      select 1 from public.columns c
      where c.id = column_id and public.can_edit_board(c.board_id)
    )
  );
