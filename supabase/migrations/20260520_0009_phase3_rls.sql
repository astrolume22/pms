-- =====================================================================
-- PMS Phase 3 — RLS for items / item_column_values / item_subscribers /
--               board_counters + grants
-- =====================================================================

alter table public.items              enable row level security;
alter table public.item_column_values enable row level security;
alter table public.item_subscribers   enable row level security;
alter table public.board_counters     enable row level security;

-- Reset existing policies (idempotent)
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('items','item_column_values','item_subscribers','board_counters')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- items
-- ---------------------------------------------------------------------
create policy items_select on public.items for select
  to authenticated
  using (deleted_at is null and public.can_access_board(board_id));

create policy items_insert on public.items for insert
  to authenticated
  with check (public.can_edit_board(board_id) and created_by = auth.uid());

create policy items_update on public.items for update
  to authenticated
  using (public.can_edit_board(board_id))
  with check (public.can_edit_board(board_id));

create policy items_delete on public.items for delete
  to authenticated
  using (public.can_edit_board(board_id));

-- ---------------------------------------------------------------------
-- item_column_values — gate through the parent item's board
-- ---------------------------------------------------------------------
create policy values_select on public.item_column_values for select
  to authenticated
  using (
    exists (
      select 1 from public.items i
      where i.id = item_id and public.can_access_board(i.board_id)
    )
  );

create policy values_insert on public.item_column_values for insert
  to authenticated
  with check (
    exists (
      select 1 from public.items i
      where i.id = item_id and public.can_edit_board(i.board_id)
    )
  );

create policy values_update on public.item_column_values for update
  to authenticated
  using (
    exists (
      select 1 from public.items i
      where i.id = item_id and public.can_edit_board(i.board_id)
    )
  )
  with check (
    exists (
      select 1 from public.items i
      where i.id = item_id and public.can_edit_board(i.board_id)
    )
  );

create policy values_delete on public.item_column_values for delete
  to authenticated
  using (
    exists (
      select 1 from public.items i
      where i.id = item_id and public.can_edit_board(i.board_id)
    )
  );

-- ---------------------------------------------------------------------
-- item_subscribers — each user manages their own row; readable to
-- anyone who can access the board (for the watchers list in Phase 4)
-- ---------------------------------------------------------------------
create policy item_subs_select on public.item_subscribers for select
  to authenticated
  using (
    exists (
      select 1 from public.items i
      where i.id = item_id and public.can_access_board(i.board_id)
    )
  );

create policy item_subs_insert on public.item_subscribers for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.items i
      where i.id = item_id and public.can_access_board(i.board_id)
    )
  );

create policy item_subs_delete on public.item_subscribers for delete
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- board_counters — read-only for users with board access; writes
-- happen only via the generate_task_code() function (security definer)
-- ---------------------------------------------------------------------
create policy counters_select on public.board_counters for select
  to authenticated
  using (public.can_access_board(board_id));
-- No insert/update/delete policies: function bypasses RLS.

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
grant select, insert, update, delete on public.items              to authenticated;
grant select, insert, update, delete on public.item_column_values to authenticated;
grant select, insert,         delete on public.item_subscribers   to authenticated;
grant select                          on public.board_counters    to authenticated;
