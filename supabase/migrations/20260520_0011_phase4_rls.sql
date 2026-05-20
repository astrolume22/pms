-- =====================================================================
-- PMS Phase 4 — RLS for updates, reactions, mentions, files, notifications
-- =====================================================================

alter table public.updates          enable row level security;
alter table public.update_reactions enable row level security;
alter table public.update_mentions  enable row level security;
alter table public.files            enable row level security;
alter table public.notifications    enable row level security;

-- Reset existing policies (idempotent)
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('updates','update_reactions','update_mentions','files','notifications')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- updates — read if can_access_board (via item→board), write if can_edit,
-- edit/delete own or admin
-- ---------------------------------------------------------------------
create policy updates_select on public.updates for select
  to authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from public.items i
      where i.id = item_id and public.can_access_board(i.board_id)
    )
  );

create policy updates_insert on public.updates for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.items i
      where i.id = item_id and public.can_edit_board(i.board_id)
    )
  );

create policy updates_update_own on public.updates for update
  to authenticated
  using (
    author_id = auth.uid()
    or public.is_admin()
  )
  with check (
    author_id = auth.uid()
    or public.is_admin()
  );

create policy updates_delete_own on public.updates for delete
  to authenticated
  using (author_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------
-- update_reactions — read with board access, write/delete own
-- ---------------------------------------------------------------------
create policy reactions_select on public.update_reactions for select
  to authenticated
  using (
    exists (
      select 1 from public.updates u
      join public.items i on i.id = u.item_id
      where u.id = update_id and public.can_access_board(i.board_id)
    )
  );

create policy reactions_insert on public.update_reactions for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.updates u
      join public.items i on i.id = u.item_id
      where u.id = update_id and public.can_access_board(i.board_id)
    )
  );

create policy reactions_delete on public.update_reactions for delete
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- update_mentions — read with board access, insert by update author
-- ---------------------------------------------------------------------
create policy mentions_select on public.update_mentions for select
  to authenticated
  using (
    exists (
      select 1 from public.updates u
      join public.items i on i.id = u.item_id
      where u.id = update_id and public.can_access_board(i.board_id)
    )
  );

create policy mentions_insert on public.update_mentions for insert
  to authenticated
  with check (
    exists (
      select 1 from public.updates u
      where u.id = update_id and u.author_id = auth.uid()
    )
  );

create policy mentions_delete on public.update_mentions for delete
  to authenticated
  using (
    exists (
      select 1 from public.updates u
      where u.id = update_id and u.author_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- files — read if can_access_board via item or update, write if can_edit
-- ---------------------------------------------------------------------
create policy files_select on public.files for select
  to authenticated
  using (
    deleted_at is null
    and (
      (item_id is not null and exists (select 1 from public.items i where i.id = item_id and public.can_access_board(i.board_id)))
      or
      (update_id is not null and exists (
        select 1 from public.updates u
        join public.items i on i.id = u.item_id
        where u.id = update_id and public.can_access_board(i.board_id)
      ))
    )
  );

create policy files_insert on public.files for insert
  to authenticated
  with check (
    uploader_id = auth.uid()
    and (
      (item_id is not null and exists (select 1 from public.items i where i.id = item_id and public.can_edit_board(i.board_id)))
      or
      (update_id is not null and exists (
        select 1 from public.updates u
        join public.items i on i.id = u.item_id
        where u.id = update_id and public.can_edit_board(i.board_id)
      ))
    )
  );

create policy files_update_own on public.files for update
  to authenticated
  using (uploader_id = auth.uid() or public.is_admin())
  with check (uploader_id = auth.uid() or public.is_admin());

create policy files_delete_own on public.files for delete
  to authenticated
  using (uploader_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------
-- notifications — each user reads only their own; writes happen via
-- security-definer triggers; users can mark read.
-- ---------------------------------------------------------------------
create policy notifications_select_own on public.notifications for select
  to authenticated
  using (recipient_id = auth.uid());

create policy notifications_update_own on public.notifications for update
  to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

create policy notifications_delete_own on public.notifications for delete
  to authenticated
  using (recipient_id = auth.uid());

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
grant select, insert, update, delete on public.updates          to authenticated;
grant select, insert,         delete on public.update_reactions to authenticated;
grant select, insert,         delete on public.update_mentions  to authenticated;
grant select, insert, update, delete on public.files            to authenticated;
grant select,         update, delete on public.notifications    to authenticated;
