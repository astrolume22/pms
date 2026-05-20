-- =====================================================================
-- Bug fix: soft-delete UPDATE rejected with "new row violates RLS"
--
-- PostgreSQL applies the SELECT policy's USING clause to the *new row*
-- of an UPDATE (to ensure the user can still see the row after the
-- update completes).  The SELECT policies on items / boards / updates /
-- files all had `deleted_at IS NULL` as part of their USING clause, so
-- setting `deleted_at = now()` flipped the predicate to FALSE for the
-- new row, and the UPDATE was rejected — even though the actual
-- UPDATE-policy WITH CHECK passed.
--
-- The fix removes `deleted_at IS NULL` from these SELECT policies.
-- The application layer already filters soft-deleted rows in every
-- `useBoardItems` / `useItemUpdates` / etc. query via `.is('deleted_at',
-- null)`, so removing the predicate from RLS doesn't expand access —
-- it just stops the SELECT policy from breaking soft-delete writes.
--
-- Idempotent: drop + recreate each affected policy.
-- =====================================================================

-- ---------------------------------------------------------------------
-- items
-- ---------------------------------------------------------------------
drop policy if exists items_select on public.items;
create policy items_select on public.items for select
  to authenticated
  using (public.can_access_board(board_id));

-- ---------------------------------------------------------------------
-- boards (rewritten earlier to use inline column checks; same root cause
-- affects soft-deleting a board.  Re-emit the policy without the
-- `deleted_at is null` filter; the JS `useBoards` hook already filters
-- by `.is('deleted_at', null)`.)
-- ---------------------------------------------------------------------
drop policy if exists boards_select_accessible on public.boards;
create policy boards_select_accessible on public.boards for select
  to authenticated
  using (
    public.is_active_user()
    and (
      public.is_admin()
      or owner_id = auth.uid()
      or created_by = auth.uid()
      or exists (
        select 1 from public.board_subscribers bs
        where bs.board_id = boards.id and bs.user_id = auth.uid()
      )
      or (
        board_type = 'main'
        and public.current_user_role() in ('admin','manager')
        and exists (
          select 1 from public.workspace_members wm
          where wm.workspace_id = boards.workspace_id and wm.user_id = auth.uid()
        )
      )
    )
  );

-- ---------------------------------------------------------------------
-- updates
-- ---------------------------------------------------------------------
drop policy if exists updates_select on public.updates;
create policy updates_select on public.updates for select
  to authenticated
  using (
    exists (
      select 1 from public.items i
      where i.id = item_id and public.can_access_board(i.board_id)
    )
  );

-- ---------------------------------------------------------------------
-- files (had `deleted_at is null` at the top of an OR-chain; rewrite
-- without it)
-- ---------------------------------------------------------------------
drop policy if exists files_select on public.files;
create policy files_select on public.files for select
  to authenticated
  using (
    (item_id is not null and exists (
      select 1 from public.items i
      where i.id = item_id and public.can_access_board(i.board_id)
    ))
    or
    (update_id is not null and exists (
      select 1 from public.updates u
      join public.items i on i.id = u.item_id
      where u.id = update_id and public.can_access_board(i.board_id)
    ))
  );
