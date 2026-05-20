-- =====================================================================
-- Bug fix: 403 on board create.
--
-- Root cause: the SELECT policy on public.boards calls
-- `public.can_access_board(id)`, a STABLE SECURITY DEFINER function that
-- looks up the board row to evaluate access.  When an `INSERT ... RETURNING *`
-- runs (sent by the JS client when you chain `.select('*')`), the SELECT
-- USING clause is applied to the just-inserted row, but the STABLE
-- function's MVCC snapshot doesn't include that row yet, so the lookup
-- returns empty and the function returns false.  PostgREST sees 0
-- returned rows and surfaces a misleading "new row violates row-level
-- security policy" 403, even though the INSERT and all AFTER triggers
-- completed successfully.
--
-- The fix: rewrite the SELECT policy to reference the row's columns
-- directly instead of calling a helper that re-queries the table.
-- Direct column references are evaluated against the row being filtered,
-- not via a snapshot lookup, so they always see the just-inserted row.
--
-- Idempotent: drops and recreates the single policy.
-- =====================================================================

drop policy if exists boards_select_accessible on public.boards;

create policy boards_select_accessible on public.boards for select
  to authenticated
  using (
    deleted_at is null
    and public.is_active_user()
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
