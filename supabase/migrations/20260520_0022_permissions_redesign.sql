-- =====================================================================
-- Permissions redesign — TWO roles only (admin + manager).
--
-- New model:
--   * Admin: unrestricted.
--   * Manager: read-only on boards they're subscribed to; the ONLY write
--     they can do on the table is updating the Status cell value, and
--     they can post comments (updates) + react.
--
-- All previous "main-board fallback" access for managers is removed.
-- Managers MUST be explicitly subscribed (via board_subscribers) to see
-- any board, even a "main"-type one.
--
-- Scoped assignment: board_subscribers gains an optional group_id. When
-- NULL = full board access. When set = manager only sees that one
-- group's items on that board (everything else hidden by RLS).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. board_subscribers — add optional group_id scope.
-- ---------------------------------------------------------------------
alter table public.board_subscribers
  add column if not exists group_id uuid;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'board_subscribers_group_fk'
  ) then
    alter table public.board_subscribers
      add constraint board_subscribers_group_fk
      foreign key (group_id) references public.groups(id) on delete cascade;
  end if;
end $$;

create index if not exists board_subscribers_group_idx
  on public.board_subscribers (group_id) where group_id is not null;

-- ---------------------------------------------------------------------
-- 2. invites — also gain group_id so an invite link can be scoped to a
--    single group within a board.
-- ---------------------------------------------------------------------
alter table public.invites
  add column if not exists group_id uuid;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'invites_group_fk'
  ) then
    alter table public.invites
      add constraint invites_group_fk
      foreign key (group_id) references public.groups(id) on delete cascade;
  end if;
end $$;

create index if not exists invites_group_idx
  on public.invites (group_id) where group_id is not null;

-- ---------------------------------------------------------------------
-- 3. Replace the access helpers with the two-role model.
--
-- can_access_board: admin OR any subscriber row for this board.
--   (No more "main board fallback for managers".)
-- can_access_item:  admin OR a subscriber whose row either has no
--   group restriction OR whose group_id matches the item's group_id.
-- can_edit_board / can_manage_board: admin-only now (used by the
--   structural-write policies).
-- is_status_column: helper for the "manager can only edit Status cells"
--   policy on item_column_values.
-- ---------------------------------------------------------------------
create or replace function public.can_access_board(_board_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  with me as (
    select id, role, status, is_super_admin from public.users where id = auth.uid()
  )
  select
    coalesce((select status='active' from me), false)
    and exists (select 1 from public.boards where id = _board_id and deleted_at is null)
    and (
      (select role='admin' or is_super_admin from me)
      or exists (
        select 1 from public.board_subscribers
        where board_id = _board_id and user_id = (select id from me)
      )
    );
$$;

create or replace function public.can_edit_board(_board_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  -- Admin / super-admin only — managers never edit board structure.
  select coalesce(public.is_admin(), false)
     and exists (select 1 from public.boards where id = _board_id and deleted_at is null);
$$;

create or replace function public.can_manage_board(_board_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.is_admin(), false);
$$;

create or replace function public.can_access_item(_item_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  with me as (select id, role, status, is_super_admin from public.users where id = auth.uid()),
       it as (select board_id, group_id from public.items where id = _item_id and deleted_at is null)
  select
    coalesce((select status='active' from me), false)
    and exists (select 1 from it)
    and (
      (select role='admin' or is_super_admin from me)
      or exists (
        select 1 from public.board_subscribers bs
        where bs.board_id = (select board_id from it)
          and bs.user_id  = (select id from me)
          and (bs.group_id is null or bs.group_id = (select group_id from it))
      )
    );
$$;

create or replace function public.is_status_column(_column_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.columns
    where id = _column_id and column_type = 'status' and archived_at is null
  );
$$;

revoke all on function public.can_access_item(uuid) from public;
revoke all on function public.is_status_column(uuid) from public;
grant execute on function public.can_access_item(uuid) to authenticated;
grant execute on function public.is_status_column(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. groups — managers with a group-scoped subscription see ONLY their
--    group. Without scope, they see all groups on the board.
-- ---------------------------------------------------------------------
drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups for select to authenticated using (
  public.can_access_board(board_id)
  and (
    public.is_admin()
    or exists (
      select 1 from public.board_subscribers bs
      where bs.board_id = groups.board_id
        and bs.user_id  = auth.uid()
        and (bs.group_id is null or bs.group_id = groups.id)
    )
  )
);

-- ---------------------------------------------------------------------
-- 5. items — read uses can_access_item (handles group scope);
--    insert / update / delete are ADMIN ONLY now.
-- ---------------------------------------------------------------------
drop policy if exists items_select on public.items;
drop policy if exists items_insert on public.items;
drop policy if exists items_update on public.items;
drop policy if exists items_delete on public.items;

create policy items_select on public.items for select to authenticated using (
  deleted_at is null and public.can_access_item(id)
);

create policy items_insert on public.items for insert to authenticated with check (
  public.is_admin() and created_by = auth.uid()
);

create policy items_update on public.items for update to authenticated using (
  public.is_admin()
) with check (
  public.is_admin()
);

create policy items_delete on public.items for delete to authenticated using (
  public.is_admin()
);

-- ---------------------------------------------------------------------
-- 6. item_column_values — the linchpin.
--    Read:  any user who can access the parent item.
--    Write: admin always; managers ONLY when the column is the Status
--    column (column_type='status'). All other cell edits blocked.
-- ---------------------------------------------------------------------
drop policy if exists values_select on public.item_column_values;
drop policy if exists values_insert on public.item_column_values;
drop policy if exists values_update on public.item_column_values;
drop policy if exists values_delete on public.item_column_values;

create policy values_select on public.item_column_values for select to authenticated using (
  public.can_access_item(item_id)
);

create policy values_insert on public.item_column_values for insert to authenticated with check (
  public.can_access_item(item_id)
  and (public.is_admin() or public.is_status_column(column_id))
);

create policy values_update on public.item_column_values for update to authenticated using (
  public.can_access_item(item_id)
  and (public.is_admin() or public.is_status_column(column_id))
) with check (
  public.can_access_item(item_id)
  and (public.is_admin() or public.is_status_column(column_id))
);

create policy values_delete on public.item_column_values for delete to authenticated using (
  public.can_access_item(item_id)
  and (public.is_admin() or public.is_status_column(column_id))
);

-- ---------------------------------------------------------------------
-- 7. updates (comments) — managers MAY post on items they can access.
--    Previously required can_edit_board which is now admin-only.
-- ---------------------------------------------------------------------
drop policy if exists updates_insert on public.updates;
create policy updates_insert on public.updates for insert to authenticated with check (
  author_id = auth.uid()
  and public.can_access_item(item_id)
);

-- Reactions: same — anyone with item access can react.
-- (The existing reactions_insert already uses can_access_board which now
-- correctly excludes non-subscribed users; we widen the join to use
-- can_access_item so group-scoped subscribers can still react on their
-- assigned items.)
drop policy if exists reactions_insert on public.update_reactions;
create policy reactions_insert on public.update_reactions for insert to authenticated with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.updates u
    where u.id = update_id and public.can_access_item(u.item_id)
  )
);

-- ---------------------------------------------------------------------
-- 8. files — uploads remain admin-only (managers don't upload).
--    Old policy hinged on can_edit_board which is now admin-only, so
--    the existing policy is already correct — but rebuild it via
--    is_admin() for clarity.
-- ---------------------------------------------------------------------
drop policy if exists files_insert on public.files;
create policy files_insert on public.files for insert to authenticated with check (
  public.is_admin()
  and uploader_id = auth.uid()
  and (
    item_id is not null
    or update_id is not null
  )
);

-- ---------------------------------------------------------------------
-- 9. boards / board_subscribers / column_labels — structural writes are
--    admin-only via can_manage_board / can_edit_board which we already
--    rewrote to admin-only above. Drop+recreate boards_insert to make
--    explicit that managers can no longer create boards.
-- ---------------------------------------------------------------------
drop policy if exists boards_insert_admin_manager on public.boards;
create policy boards_insert_admin_only on public.boards for insert to authenticated with check (
  public.is_admin() and created_by = auth.uid()
);

-- =====================================================================
-- Migration complete. Run verify-fks after to confirm the two new FKs
-- (board_subscribers.group_id, invites.group_id) are physically present.
-- =====================================================================
